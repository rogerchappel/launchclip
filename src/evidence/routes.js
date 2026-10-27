// Evidence capture: the page a request actually opens, when the URL it names
// is not the right page to film. Each route is a public page that needs no
// sign-in, and the sidecar records which route was used.
//
// - page: the URL as given (every request without a special case).
// - github-file: a PR's Files tab (or a commit) with request.file set. A
//   112-file PR puts one file's diff tens of thousands of px down, often
//   collapsed behind "Load diff". The route opens GitHub's own anchor for
//   that file (#diff-<sha256 of its path>), presses that file's "Load diff"
//   if it shows one (a display toggle, never a form), and scopes every target
//   without its own `within` to that file.
// - x-embed: an x.com / twitter.com post. X refuses headless browsers on the
//   post page, so the route opens the public embed page X's oEmbed widget
//   uses (platform.twitter.com/embed/Tweet.html, dnt=true), which X renders
//   itself, centres and enlarges the card, and fetches the oEmbed record
//   (publish.twitter.com) for the sidecar. Never signs in.
import { createHash } from "node:crypto";

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "mobile.x.com"]);
const GITHUB_DIFF = /^\/[\w.-]+\/[\w.-]+\/(pull\/\d+(\/(files|changes))?|commit\/[0-9a-f]{7,40})\/?$/i;

/** An x.com / twitter.com post URL → {user, id}, or null. */
export function xStatus(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (!X_HOSTS.has(url.hostname.toLowerCase())) return null;
  const m = /^\/([\w]{1,30})\/status(?:es)?\/(\d{5,25})/.exec(url.pathname);
  return m ? { user: m[1], id: m[2] } : null;
}

/** GitHub's anchor id for one file's diff: diff-<sha256 of the path>. */
export const githubDiffAnchor = (file) => `diff-${createHash("sha256").update(file).digest("hex")}`;

/** Whether a URL is a GitHub PR (Files tab) or commit page a `file` can point into. */
export function githubDiffPage(href) {
  try { const url = new URL(href); return url.hostname === "github.com" && GITHUB_DIFF.test(url.pathname); } catch { return false; }
}

/**
 * The route for a validated request: {name, url (the page to open), scope?
 * (the selector targets default to), file?, post?}.
 */
export function resolveRoute(request) {
  const post = xStatus(request.url);
  if (post) {
    const embed = new URL("https://platform.twitter.com/embed/Tweet.html");
    embed.search = new URLSearchParams({ id: post.id, theme: request.theme === "light" ? "light" : "dark", dnt: "true", lang: "en" }).toString();
    return { name: "x-embed", url: embed.href, post };
  }
  if (request.file) {
    if (!githubDiffPage(request.url)) throw new Error(`file "${request.file}" needs a GitHub pull request or commit URL; got ${request.url}`);
    const url = new URL(request.url);
    // The Files tab, not the conversation: a bare /pull/<n> has no diffs.
    if (/\/pull\/\d+\/?$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, "")}/files`;
    const anchor = githubDiffAnchor(request.file);
    url.hash = anchor;
    return { name: "github-file", url: url.href, scope: `[id="${anchor}"]`, file: request.file };
  }
  return { name: "page", url: request.url };
}

/**
 * A target as the route needs it: scoped to the route's file, and for an X
 * post without the page-title wrapper a research fetch sees ("Salio on X:
 * \"🚨 …"), which the embed never shows. → {target, note?}
 */
export function retarget(target, route) {
  if (!target) return { target };
  let out = target;
  if (route.scope && !out.within) out = { ...out, within: route.scope };
  if (route.name === "x-embed" && typeof out.text === "string") {
    const text = out.text.replace(/^(.{0,80}?\s)?on (X|Twitter): ["“]/u, "").replace(/["”]\s*(\/\s*X)?\s*$/u, "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
    if (text && text !== out.text) return { target: { ...out, text }, note: `"${out.text}" → "${text}"` };
  }
  return { target: out };
}

// The embed card centred on a dark ground and enlarged to fill the window's height.
const X_STAGE = `(bg) => {
  document.documentElement.style.setProperty("background", bg, "important");
  document.body.style.setProperty("background", bg, "important");
  document.body.style.setProperty("margin", "0", "important");
  const card = document.querySelector("article")?.closest("body > *") ?? document.body.firstElementChild;
  if (!card) return null;
  const h = card.getBoundingClientRect().height || 600;
  const zoom = Math.max(1.15, Math.min(1.7, (innerHeight - 56) / h));
  Object.assign(card.style, { zoom: String(zoom), margin: "28px auto 0", maxWidth: "550px" });
  return zoom;
}`;

/**
 * Get the opened page ready for the route: the X card staged, the GitHub
 * file expanded. → {notes: [string]} for the sidecar. Throws when the route's
 * page is not there (an unavailable post, a file not in the PR).
 */
export async function prepareRoute(page, route, { theme = "dark", log = () => {} } = {}) {
  const notes = [];
  if (route.name === "x-embed") {
    await page.locator("article").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText || "");
    if (!(await page.locator("article").count()) || /this post is unavailable|this tweet is unavailable|post was deleted/i.test(text)) {
      throw new Error(`the X embed for post ${route.post.id} shows no post${text.trim() ? ` ("${text.trim().slice(0, 80)}")` : ""}; it may be deleted, protected or age-restricted`);
    }
    const zoom = await page.evaluate(`(${X_STAGE})(${JSON.stringify(theme === "light" ? "#eef1f5" : "#0b0e13")})`);
    await page.waitForTimeout(300);
    notes.push(`staged the embed card at ${Math.round((zoom ?? 1) * 100)}%`);
  }
  if (route.name === "github-file") {
    const file = page.locator(route.scope);
    await file.first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
    if (!(await file.count())) throw new Error(`file "${route.file}" is not in this page's diff (no element #${route.scope.slice(5, -2)}); check the path against the PR's file list`);
    const load = file.locator("button.load-diff-button, button.js-diff-load, button:has-text('Load diff')").first();
    if (await load.count()) {
      await load.click({ timeout: 5000 });
      // The rows arrive by XHR; wait until the file has a diff table.
      await file.locator("table, [role='grid'], .blob-code").first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);
      notes.push(`pressed "Load diff" on ${route.file}`);
      log(`loaded the collapsed diff of ${route.file}`);
    }
  }
  return { notes };
}

/** The oEmbed record of an X post (author and text, from publish.twitter.com), or null when it can't be had. */
export async function fetchXOembed(href, { fetch: get = globalThis.fetch } = {}) {
  try {
    const url = `https://publish.twitter.com/oembed?${new URLSearchParams({ url: href, omit_script: "1", dnt: "true" })}`;
    const response = await get(url, { redirect: "follow", headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const data = await response.json();
    const quote = /<p[^>]*>([\s\S]*?)<\/p>/.exec(data.html ?? "")?.[1] ?? "";
    const text = quote.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    return { url: data.url ?? href, author_name: data.author_name ?? null, author_url: data.author_url ?? null, text };
  } catch {
    return null;
  }
}
