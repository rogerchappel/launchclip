// Evidence capture, step 2: open a real public page, check it is really there,
// and turn a capture request into a clip, a poster and a sidecar.
//
// Same browser setup as the demo recorder (src/demo/record.js: Playwright's
// chromium, an installed Chromium, the system ffmpeg), but a different job:
// the page is evidence, so nothing on it is faked or skipped.
//
// - Public pages only: http(s) on a public host; localhost and private
//   addresses are refused. A fresh context every run (no cookies, no
//   profile), no downloads, service workers blocked. Nothing is ever typed
//   and no form is submitted, so it never signs in.
// - Consent banners are answered with the most privacy-preserving choice:
//   "Reject all" / "Only necessary" / "Decline" when the banner offers it,
//   in the page or a consent iframe. A banner with no such button is hidden
//   (which consents to nothing); "Accept" is never pressed.
// - Blocks fail loudly: an HTTP error, a bot check, a sign-in wall or a
//   paywall stops the capture with the reason (EvidenceBlockedError), and
//   never produces a clip of the wall.
// - Every beat target must be found on the page; a missing one is an error.
//
// The page is then frozen (animations and transitions paused, carets
// hidden), scrolled through once so lazy content loads, measured, and shot
// once at deviceScaleFactor 2. The beats play over that shot as a
// frame-pure timeline (src/evidence/timeline.js, src/evidence/player.js), so
// a re-run of the same page draws the same frames. The sidecar records what
// was captured: provenance, the final URL, the sha256 of the HTML snapshot,
// the full-page screenshot, and every text span selected or highlighted.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyHost } from "../demo/guardrails.js";
import { recorderAvailability } from "../demo/record.js";
import { SIDECAR_SCHEMA, requestDuration, targetLabel, validateCaptureRequest } from "./request.js";
import { buildTimeline } from "./timeline.js";
import { chromeHeight, renderClip } from "./player.js";
import { fetchXOembed, prepareRoute, resolveRoute, retarget } from "./routes.js";

export class EvidenceBlockedError extends Error {
  constructor(reason, detail = {}) {
    super(`evidence capture blocked: ${reason}`);
    this.name = "EvidenceBlockedError";
    this.reason = reason;
    this.detail = detail;
  }
}

const SHOT_SCALE = 2;
const TILE = 4000;          // CSS px per screenshot tile: 2× stays inside Chromium's 16k texture limit
const MAX_REGION = 16000;   // CSS px of page one clip may cover (beats further apart belong in two captures)
const MAX_DEPTH = 120000;   // CSS px down the page a target may sit
const TOP_REACH = 9000;     // beats that all end above this play from the page top

/**
 * The slice of the page a clip needs, {y0, y1} in CSS px. Beats near the top
 * play from the top, as before. Deeper beats open just above the first target,
 * as if the reader had followed an anchor there, so a target 30,000 px down
 * needs no 30,000 px scroll. `start` forces "top" or "target".
 */
export function captureRegion(rects, { docHeight, win, start = "auto" }) {
  const tops = rects.map((r) => r.y), bottoms = rects.map((r) => r.y + r.height);
  const lowest = Math.max(0, ...bottoms), highest = tops.length ? Math.min(...tops) : 0;
  const fromTop = start === "top" || (start === "auto" && lowest + win.height * 1.2 <= TOP_REACH);
  const y0 = fromTop ? 0 : Math.max(0, Math.round(highest - win.height * 0.3));
  const y1 = Math.round(Math.min(docHeight, Math.max(y0 + win.height, lowest + win.height * 1.2)));
  return { y0, y1: Math.max(y1, Math.min(docHeight, y0 + win.height)) };
}

/** A region cut into screenshot tiles of at most TILE px: [{y, height}]. */
export function regionTiles({ y0, y1 }, tile = TILE) {
  const out = [];
  for (let y = y0; y < y1; y += tile) out.push({ y, height: Math.min(tile, y1 - y) });
  return out;
}

/** Throw unless `url` is a public http(s) page (evidence never points at a local or private host). */
export function assertPublicUrl(url) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`evidence URL ${url} must be http or https`);
  if (classifyHost(url) === "local") throw new Error(`evidence URL ${url} is a local or private address; evidence capture records public pages only`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Consent banners

// Button labels that refuse optional cookies, most privacy-preserving first.
export const REJECT_LABELS = [
  /^reject( all)?( cookies)?$/i, /^decline( all)?( cookies)?$/i, /^refuse( all)?$/i, /^deny( all)?$/i,
  /^(use |accept )?(only )?(strictly )?(necessary|essential|required)( cookies)?( only)?$/i,
  /^reject (non-essential|optional|additional)( cookies)?$/i, /^continue without (accepting|agreeing|consent)/i,
  /^do not (accept|consent)$/i, /^i do not accept$/i, /^disagree( and close)?$/i, /^no,? thanks$/i
];
// Known consent platforms: their reject button, and their container (hidden when nothing refuses).
const CMP_REJECT = ["#onetrust-reject-all-handler", "#CybotCookiebotDialogBodyButtonDecline", "#didomi-notice-disagree-button", ".fc-cta-do-not-consent", "[data-testid='uc-deny-all-button']", ".qc-cmp2-summary-buttons button[mode='secondary']", "#truste-consent-required"];
const CMP_CONTAINERS = ["#onetrust-consent-sdk", "#CybotCookiebotDialog", "#didomi-host", ".fc-consent-root", "#usercentrics-root", ".qc-cmp2-container", "[id^='sp_message_container']", "#truste-consent-track", ".truste_box_overlay", "#cookie-banner", "#cookie-consent", ".cookie-banner", ".cookie-consent", "[aria-label*='cookie' i][role='dialog']", "[aria-label*='consent' i][role='dialog']", "[class*='CookieBanner']", "[class*='cookie-notice']"];

/** Whether a button's label is a privacy-preserving refusal. */
export const isRejectLabel = (label) => REJECT_LABELS.some((pattern) => pattern.test(String(label).replace(/\s+/g, " ").trim()));

/**
 * Answer a consent banner with the most privacy-preserving choice.
 * → {action: "none" | "rejected" | "hidden", via?: label or selector, frame?: url}
 */
export async function dismissConsent(page, { log = () => {} } = {}) {
  for (const frame of page.frames()) {
    for (const selector of CMP_REJECT) {
      const button = frame.locator(selector).filter({ visible: true }).first();
      if (await button.count().catch(() => 0)) {
        await button.click({ timeout: 3000 }).catch(() => {});
        log(`consent: pressed ${selector}`);
        await page.waitForTimeout(600);
        return { action: "rejected", via: selector, frame: frame === page.mainFrame() ? null : frame.url() };
      }
    }
    const buttons = frame.locator("button, [role='button'], a[role='button'], input[type='button'], input[type='submit']").filter({ visible: true });
    const count = Math.min(await buttons.count().catch(() => 0), 400);
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const label = ((await button.innerText({ timeout: 500 }).catch(() => "")) || (await button.getAttribute("value").catch(() => "")) || (await button.getAttribute("aria-label").catch(() => "")) || "").trim();
      if (label && label.length < 60 && isRejectLabel(label)) {
        // Only inside something that is about cookies or consent: a page's own "Decline" buttons are left alone.
        const about = await button.evaluate((el) => { let node = el; for (let i = 0; i < 8 && node; i++, node = node.parentElement) { const text = (node.innerText || "").slice(0, 2000); if (/cookie|consent|privacy|tracking|gdpr/i.test(text + " " + (node.id || "") + " " + (node.className || ""))) return true; } return false; }).catch(() => false);
        if (!about) continue;
        await button.click({ timeout: 3000 }).catch(() => {});
        log(`consent: pressed "${label}"`);
        await page.waitForTimeout(600);
        return { action: "rejected", via: label, frame: frame === page.mainFrame() ? null : frame.url() };
      }
    }
  }
  const hidden = await page.evaluate((selectors) => {
    const found = [];
    for (const selector of selectors) for (const node of document.querySelectorAll(selector)) { const box = node.getBoundingClientRect(); if (box.width * box.height > 0) { node.style.setProperty("display", "none", "important"); found.push(selector); } }
    // A fixed bar about cookies or privacy that matched no known platform (and offered no refusal).
    for (const node of document.querySelectorAll("body *")) {
      const s = getComputedStyle(node);
      if (s.position !== "fixed" && s.position !== "sticky") continue;
      const box = node.getBoundingClientRect();
      if (box.width < innerWidth * 0.5 || box.height > innerHeight * 0.45 || box.height < 30) continue;
      if (box.top > 8 && box.bottom < innerHeight - 8) continue;
      if (!/cookie|consent|your privacy|privacy (rights|choices|policy)/i.test((node.innerText || "").slice(0, 1500))) continue;
      node.style.setProperty("display", "none", "important");
      found.push(`fixed bar "${(node.innerText || "").trim().split("\n")[0].slice(0, 40)}"`);
    }
    if (found.length) { document.documentElement.style.removeProperty("overflow"); document.body.style.removeProperty("overflow"); }
    return [...new Set(found)];
  }, CMP_CONTAINERS).catch(() => []);
  if (hidden.length) { log(`consent: no refuse button; hid ${hidden.join(", ")}`); return { action: "hidden", via: hidden.join(", ") }; }
  return { action: "none" };
}

/** Hide the request's page furniture (request.hide). → the selectors that matched something. */
export async function hideFurniture(page, selectors) {
  return page.evaluate((list) => list.filter((selector) => {
    let nodes = [];
    try { nodes = [...document.querySelectorAll(selector)]; } catch { return false; }
    for (const node of nodes) node.style.setProperty("display", "none", "important");
    return nodes.length > 0;
  }), selectors);
}

// ---------------------------------------------------------------------------
// Blocks, walls and paywalls

const BOT_CHECK = /(verify (that )?you are (a )?human|are you a robot|checking your browser|just a moment\.\.\.|attention required|enable javascript and cookies to continue|unusual traffic from your computer|press (and|&) hold|captcha|access denied|request blocked|you have been blocked)/i;
const SIGN_IN_WALL = /^(sign in|log in|login)( to (continue|github|your account))?\b/i;
const PAYWALL = /(subscribe (now )?to (continue|keep) reading|this (article|story|content) is (for|available to) (subscribers|members)( only)?|to continue reading,? (please )?(subscribe|sign in|log in)|you('ve| have) reached your (free )?(article )?limit|create a free account to (continue|read))/i;
const PAYWALL_SELECTORS = ["[class*='paywall' i]", "[id*='paywall' i]", ".tp-modal", ".tp-backdrop", "[data-testid*='paywall' i]", "#gateway-content", ".meteredContent", "[class*='regwall' i]"];

/**
 * Why a loaded page is not the evidence it claims to be, or null when it is.
 * Pure over a page summary: {status, requested, final, title, text, paywall: [selector]}.
 */
export function blockReason({ status, requested, final, title = "", text = "", paywall = [] }) {
  if (status && status >= 400) return `HTTP ${status} from ${final}`;
  const head = `${title}\n${text.slice(0, 3000)}`;
  if (BOT_CHECK.test(head) && text.length < 4000) return `a bot check or block page ("${(head.match(BOT_CHECK) ?? [""])[0]}")`;
  const req = new URL(requested), fin = new URL(final);
  if (fin.pathname !== req.pathname && /\/(login|signin|sign-in|sign_in|auth|session|account\/login|accounts\/login)\b/i.test(fin.pathname)) return `a sign-in wall (redirected to ${fin.origin}${fin.pathname})`;
  if (SIGN_IN_WALL.test(title.trim()) && text.length < 3000) return `a sign-in wall ("${title.trim()}")`;
  if (PAYWALL.test(text)) return `a paywall ("${(text.match(PAYWALL) ?? [""])[0]}")`;
  if (paywall.length) return `a paywall overlay (${paywall.join(", ")})`;
  if (text.replace(/\s+/g, "").length < 80) return "an empty page (under 80 characters of text)";
  return null;
}

async function pageSummary(page, { requested, status }) {
  const { title, text, paywall } = await page.evaluate((selectors) => ({
    title: document.title,
    text: document.body?.innerText ?? "",
    paywall: selectors.filter((selector) => [...document.querySelectorAll(selector)].some((node) => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return r.width * r.height > 40000 && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.1; }))
  }), PAYWALL_SELECTORS);
  return { status, requested, final: page.url(), title, text, paywall };
}

// ---------------------------------------------------------------------------
// Freeze and measure

const FREEZE_CSS = "*,*::before,*::after{animation-play-state:paused!important;animation-delay:-0.0001s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}::-webkit-scrollbar{display:none!important}";

/** Freeze the page (animations, transitions, carets, media) and scroll through from..to once so lazy content loads. */
async function freeze(page, to, from = 0) {
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
  await page.evaluate(async ([start, until]) => {
    for (const media of document.querySelectorAll("video, audio")) { try { media.pause(); } catch {} }
    const step = Math.max(400, innerHeight * 0.8);
    for (let y = start; y < until; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
    await document.fonts?.ready;
  }, [from, to]);
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
}

const docHeightOf = (page) => page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));

// In the page: a target → [{x, y, width, height}] in page CSS px (scroll 0),
// with the text a text target matched. Text search runs over the visible text
// nodes joined in order with whitespace collapsed, so a phrase split across
// <span>s (a highlighted diff line) still matches; exact case first, then any.
function measureInPage(target) {
  const scope = target.within ? document.querySelector(target.within) : document.body;
  if (!scope) return { error: `within ${target.within} matched nothing` };
  // near: of several matches, the one whose centre is closest to the first visible match of a phrase.
  let anchor = null;
  if (target.near) {
    const found = (() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const want = target.near.toLowerCase(); for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.nodeValue.toLowerCase().indexOf(want); if (i < 0 || !n.parentElement?.getClientRects().length) continue; const r = document.createRange(); r.setStart(n, i); r.setEnd(n, Math.min(n.nodeValue.length, i + want.length)); const b = r.getBoundingClientRect(); if (b.width && b.height) return b; } return null; })();
    if (!found) return { error: `near "${target.near}": that phrase is not on the page` };
    anchor = { x: found.left + found.width / 2, y: found.top + found.height / 2 };
  }
  const nearest = (items) => items.sort((a, b) => Math.hypot(a.r.left + a.r.width / 2 - anchor.x, a.r.top + a.r.height / 2 - anchor.y) - Math.hypot(b.r.left + b.r.width / 2 - anchor.x, b.r.top + b.r.height / 2 - anchor.y))[0];
  const px = (r) => ({ x: Math.round((r.left + scrollX) * 10) / 10, y: Math.round((r.top + scrollY) * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 });
  const visible = (node) => { const el = node.nodeType === 1 ? node : node.parentElement; if (!el) return false; const s = getComputedStyle(el); if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false; return el.getClientRects().length > 0; };
  // Whether a rect inside `el` is really on screen: not clipped away by an ancestor that hides its
  // overflow (a collapsed accordion answer, a 0-height disclosure, a truncated card). Half must show.
  const shown = (rect, el) => {
    let x0 = rect.left, y0 = rect.top, x1 = rect.right, y1 = rect.bottom;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (Number(s.opacity) === 0 || s.visibility === "hidden") return false;
      // Only overflow that hides content clips it; an auto or scroll box's content is reachable.
      const cx = /hidden|clip/.test(s.overflowX), cy = /hidden|clip/.test(s.overflowY);
      if (!cx && !cy) continue;
      const b = a.getBoundingClientRect();
      if (cx) { x0 = Math.max(x0, b.left); x1 = Math.min(x1, b.right); }
      if (cy) { y0 = Math.max(y0, b.top); y1 = Math.min(y1, b.bottom); }
      if (x1 <= x0 || y1 <= y0) return false;
    }
    return (x1 - x0) * (y1 - y0) >= 0.5 * rect.width * rect.height;
  };
  if (target.selector !== undefined) {
    let nodes;
    try { nodes = [...scope.querySelectorAll(target.selector)].filter(visible); } catch (error) { return { error: `invalid selector ${target.selector}: ${error.message}` }; }
    const node = target.near ? nearest(nodes.map((n) => ({ n, r: n.getBoundingClientRect() })).filter((c) => shown(c.r, c.n)))?.n : nodes[target.nth ?? 0];
    if (!node) return { error: `no visible element matches ${target.selector}${target.nth ? ` (nth ${target.nth} of ${nodes.length})` : ""}` };
    const r = node.getBoundingClientRect();
    if (!shown(r, node)) return { error: `${target.selector} is on the page but hidden (collapsed or clipped by an ancestor)` };
    return { rects: [px(r)], text: (node.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200) };
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes = [], starts = [];
  let joined = "", lastSpace = true;
  const map = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue || !visible(node)) continue;
    const tag = node.parentElement?.closest("script, style, noscript, template");
    if (tag) continue;
    nodes.push(node); starts.push(joined.length);
    const value = node.nodeValue;
    for (let i = 0; i < value.length; i++) {
      const space = /\s/.test(value[i]);
      if (space && lastSpace) continue;
      joined += space ? " " : value[i];
      map.push([nodes.length - 1, i]);
      lastSpace = space;
    }
  }
  const want = target.text.replace(/\s+/g, " ").trim();
  const limit = target.near ? 60 : (target.nth ?? 0);
  const find = (hay, needle) => { const hits = []; let at = hay.indexOf(needle); while (at >= 0 && hits.length <= limit) { hits.push(at); at = hay.indexOf(needle, at + 1); } return hits; };
  let hits = find(joined, want);
  if (!hits.length) hits = find(joined.toLowerCase(), want.toLowerCase());
  const rangeAt = (i) => { const [a, ao] = map[i], [b, bo] = map[i + want.length - 1]; const r = document.createRange(); r.setStart(nodes[a], ao); r.setEnd(nodes[b], bo + 1); return r; };
  const at = target.near && hits.length ? nearest(hits.map((i) => ({ i, r: rangeAt(i).getBoundingClientRect() })).filter((h) => h.r.width && h.r.height && shown(h.r, nodes[map[h.i][0]].parentElement)))?.i : hits[target.nth ?? 0];
  const renderedHint = () => {
    // Say what the page does render: the phrases round the target's numbers (or its longest words), so a
    // request written from fetched text can be pointed at the rendered element.
    // A price is tried as written ("$1.00/M") and bare ("$1.00"), as pages often split the unit off.
    const keys = [...new Set((want.match(/\$?\d[\d.,]*(?:\s*\/\s*M)?%?/g) ?? []).flatMap((k) => [k, k.replace(/\s*\/\s*M$/, "")]))].filter((k) => k.length >= 2);
    const money = keys.filter((k) => k.startsWith("$"));
    const words = money.length ? money : keys.length ? keys : want.split(/\s+/).filter((w) => w.length >= 6).sort((a, b) => b.length - a.length).slice(0, 2);
    const seen = new Set();
    for (const key of words) {
      let i = joined.indexOf(key);
      while (i >= 0 && seen.size < 4) {
        const r = document.createRange(); r.setStart(nodes[map[i][0]], map[i][1]); r.setEnd(nodes[map[i + key.length - 1][0]], map[i + key.length - 1][1] + 1);
        const b = r.getBoundingClientRect();
        if (b.width && b.height && shown(b, nodes[map[i][0]].parentElement)) seen.add(joined.slice(Math.max(0, i - 24), i + key.length + 24).trim());
        i = joined.indexOf(key, i + key.length);
      }
    }
    return seen.size ? `; the page renders ${[...seen].slice(0, 4).map((s) => `"…${s}…"`).join(", ")}: target one of those (by text, {text, near}, a selector, or {any: [...]})` : "";
  };
  if (at === undefined) {
    const hint = renderedHint();
    return { error: `text "${want}" is not on the page${target.nth ? ` (wanted match ${target.nth}, found ${hits.length})` : ""}${hint}` };
  }
  const [n0, o0] = map[at], [n1, o1] = map[at + want.length - 1];
  const range = document.createRange();
  range.setStart(nodes[n0], o0);
  range.setEnd(nodes[n1], o1 + 1);
  // One rect per line: merge the fragments a range returns for the same line.
  const lines = [];
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const line = lines.find((l) => Math.abs(l.top - r.top) < r.height * 0.5);
    if (line) { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom); }
    else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }
  if (!lines.length) return { error: `text "${want}" is on the page but not visible` };
  if (!lines.some((l) => shown({ left: l.left, top: l.top, right: l.right, bottom: l.bottom, width: l.right - l.left, height: l.bottom - l.top }, nodes[n0].parentElement))) {
    return { error: `text "${want}" is on the page but hidden (a collapsed section or clipped box, such as an accordion answer)${renderedHint() || "; target what the page shows instead"}` };
  }
  if (target.closest) {
    // The element round the phrase (a diff row, a table row, a card) instead of the phrase itself.
    const start = nodes[n0].parentElement?.closest(target.closest);
    if (!start) return { error: `text "${want}" has no ancestor matching ${target.closest}` };
    return { rects: [px(start.getBoundingClientRect())], text: joined.slice(at, at + want.length) };
  }
  return { rects: lines.map((l) => px({ left: l.left, top: l.top, width: l.right - l.left, height: l.bottom - l.top })), text: joined.slice(at, at + want.length) };
}

/** Measure a target on the page. Throws when it is missing. */
export async function measureTarget(page, target, where = "target") {
  await page.evaluate(() => scrollTo(0, 0));
  if (target.any) {
    // Alternatives in order; the first found wins, and a miss lists why each failed.
    const misses = [];
    for (const [i, alt] of target.any.entries()) {
      const result = await page.evaluate(measureInPage, { within: target.within, ...alt });
      if (!result.error) return { ...result, via: `any[${i}] ${targetLabel(alt)}` };
      misses.push(`any[${i}] ${targetLabel(alt)}: ${result.error}`);
    }
    throw new Error(`${where}: none of ${target.any.length} alternatives is on the page:\n  - ${misses.join("\n  - ")}`);
  }
  const result = await page.evaluate(measureInPage, target);
  if (result.error) throw new Error(`${where} ${targetLabel(target)}: ${result.error}`);
  return result;
}

// ---------------------------------------------------------------------------
// Open

async function launch(available) {
  return available.chromium.launch({ executablePath: available.executablePath, headless: true, args: ["--hide-scrollbars", "--disable-features=Translate,MediaRouter", "--no-first-run", "--no-default-browser-check", "--mute-audio"] });
}

/**
 * Open a request's page in a fresh context and get it ready to measure:
 * loaded, consent answered, checked for walls, frozen. → {context, page, status, consent}
 * Throws EvidenceBlockedError on a block, a wall or a paywall.
 */
export async function openEvidencePage(browser, request, { viewport, scale = SHOT_SCALE, log = () => {} } = {}) {
  assertPublicUrl(request.url);
  const route = resolveRoute(request);
  assertPublicUrl(route.url);
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: "en-US", timezoneId: "UTC", colorScheme: request.theme, reducedMotion: "reduce", acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: true });
  // Typing and form submission are never part of a capture: refuse any POST of a form the page might try.
  await context.route("**/*", (route) => (route.request().method() === "POST" && route.request().resourceType() === "document" ? route.abort("blockedbyclient") : route.continue()));
  const page = await context.newPage();
  try {
    log(`opening ${route.url}${route.name === "page" ? "" : ` (${route.name} route for ${request.url})`}`);
    const response = await page.goto(route.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const consent = await dismissConsent(page, { log });
    if (request.wait_for) await page.locator(request.wait_for).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => { throw new EvidenceBlockedError(`wait_for ${request.wait_for} never showed`, { url: page.url() }); });
    const hidden = request.hide?.length ? await hideFurniture(page, request.hide) : [];
    if (hidden.length) log(`hid ${hidden.join(", ")}`);
    const summary = await pageSummary(page, { requested: route.url, status: response?.status() ?? null });
    const reason = blockReason(summary);
    if (reason) throw new EvidenceBlockedError(reason, { url: summary.final, title: summary.title, status: summary.status });
    const { notes } = await prepareRoute(page, route, { theme: request.theme, log });
    return { context, page, status: summary.status, consent, title: summary.title, hidden, route: { ...route, notes } };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const rel = (from, file) => path.relative(from, file).split(path.sep).join("/");

/**
 * Run one capture request. → {video, poster, sidecar, fullpage, snapshot, record}
 * Files land next to `request.out` (resolved from `root`): <id>.mp4|webm,
 * <id>.poster.png, <id>.evidence.json, <id>.fullpage.png, <id>.snapshot.html.
 */
export async function captureEvidence(input, { root = process.cwd(), log = () => {}, availability = recorderAvailability } = {}) {
  const { errors, request } = validateCaptureRequest(input);
  if (errors.length) throw new Error(`capture request has errors:\n- ${errors.join("\n- ")}`);
  assertPublicUrl(request.url);
  const available = await availability();
  if (!available.ok) throw new Error(`cannot capture: ${available.reasons.join("; ")}`);
  const out = path.resolve(root, request.out);
  const dir = path.dirname(out);
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, request.id);
  const chrome = chromeHeight(request.viewport, request.chrome);
  const windowSize = { width: request.viewport.width, height: request.viewport.height - chrome };
  const duration = requestDuration(request);
  const workDir = await mkdtemp(path.join(os.tmpdir(), `launchclip-evidence-${request.id}-`));
  const browser = await launch(available);
  try {
    const oembed = resolveRoute(request).name === "x-embed" ? fetchXOembed(request.url) : null;
    const { context, page, status, consent, title, hidden, route } = await openEvidencePage(browser, request, { viewport: windowSize, log });
    const retargeted = [];
    let measured, pageSize, html, finalUrl, tiles, pageRegion;
    try {
      // Measure, load the slice the beats need, measure again (lazy content above a target can move it).
      await freeze(page, Math.min(await docHeightOf(page), TOP_REACH));
      const measureAll = async () => {
        const out = [];
        for (const beat of request.beats) {
          if (!beat.target) { out.push({ ...beat, rects: [] }); continue; }
          const { target, note } = retarget(beat.target, route);
          if (note && !retargeted.some((entry) => entry.beat === beat.index)) retargeted.push({ beat: beat.index, change: note });
          const result = await measureTarget(page, target, `beats[${beat.index}] (${beat.action})`);
          out.push({ ...beat, rects: result.rects, text: result.text, ...(result.via ? { via: result.via } : {}) });
        }
        return out;
      };
      measured = await measureAll().catch(async () => {
        // A target deeper than the first pass: load the rest of the page, then measure (and fail) for real.
        await freeze(page, Math.min(await docHeightOf(page), MAX_DEPTH), TOP_REACH);
        return measureAll();
      });
      const rectsOf = (list) => list.flatMap((beat) => beat.rects);
      const deepest = Math.max(0, ...rectsOf(measured).map((r) => r.y + r.height));
      if (deepest > MAX_DEPTH) throw new Error(`a beat target sits ${Math.round(deepest)} px down the page; evidence capture reaches ${MAX_DEPTH} px. Link to an anchor nearer the target`);
      let region = captureRegion(rectsOf(measured), { docHeight: await docHeightOf(page), win: windowSize, start: request.start });
      await freeze(page, region.y1, region.y0);
      measured = await measureAll();
      region = captureRegion(rectsOf(measured), { docHeight: await docHeightOf(page), win: windowSize, start: request.start });
      if (region.y1 - region.y0 > MAX_REGION) throw new Error(`the beats span ${region.y1 - region.y0} px of page; one clip covers ${MAX_REGION} px. Split them into two capture requests`);
      // The timeline works in region px: the region's top is the clip's page top.
      measured = measured.map((beat) => ({ ...beat, pageRects: beat.rects, rects: beat.rects.map((r) => ({ ...r, y: Math.round((r.y - region.y0) * 10) / 10 })) }));
      pageSize = { width: windowSize.width, height: region.y1 - region.y0 };
      html = await page.content();
      tiles = regionTiles(region);
      for (const [i, tile] of tiles.entries()) {
        tile.file = `page-${i}.png`;
        await page.screenshot({ path: path.join(workDir, tile.file), clip: { x: 0, y: tile.y, width: pageSize.width, height: tile.height }, fullPage: true, animations: "disabled", caret: "hide" });
        tile.y -= region.y0;
      }
      pageRegion = region;
      finalUrl = page.url();
    } finally {
      await context.close().catch(() => {});
    }
    const timeline = buildTimeline({ viewport: request.viewport, chrome, page: pageSize, beats: measured, duration });
    const poster = `${base}.poster.png`;
    log(`rendering ${request.id} (${duration} s)`);
    const clip = await renderClip(browser, { timeline, workDir, images: tiles.map(({ file, y, height }) => ({ src: file, y, height })), url: finalUrl, theme: request.theme, out, poster, fps: request.fps, log });
    // The shot the clip was drawn from: <id>.fullpage.png, or <id>.fullpage-<n>.png per tile on a tall region.
    const shots = tiles.map((tile, i) => ({ ...tile, path: tiles.length === 1 ? `${base}.fullpage.png` : `${base}.fullpage-${i}.png` }));
    for (const shot of shots) await copyFile(path.join(workDir, shot.file), shot.path);
    const fullpage = shots[0].path, snapshot = `${base}.snapshot.html`;
    await writeFile(snapshot, html);
    const record = {
      schema: SIDECAR_SCHEMA,
      id: request.id,
      kind: request.kind,
      request_url: request.url,
      final_url: finalUrl,
      http_status: status,
      page_title: title,
      provenance: { ...request.provenance },
      captured_at: new Date().toISOString(),
      consent,
      hidden,
      route: { name: route.name, url: route.url, ...(route.file ? { file: route.file } : {}), notes: route.notes, ...(retargeted.length ? { retargeted } : {}), ...(oembed ? { oembed: await oembed } : {}) },
      video: rel(dir, out),
      poster: rel(dir, poster),
      fullpage: { path: rel(dir, fullpage), width: pageSize.width, height: pageSize.height, scale: SHOT_SCALE, region: pageRegion,
        ...(shots.length > 1 ? { tiles: shots.map((shot) => ({ path: rel(dir, shot.path), y: shot.y, height: shot.height })) } : {}) },
      snapshot: { path: rel(dir, snapshot), sha256: sha256(html), bytes: Buffer.byteLength(html) },
      viewport: request.viewport,
      chrome,
      fps: request.fps,
      duration: clip.duration,
      frames: clip.frames,
      spans: measured.filter((beat) => beat.action === "select" || beat.action === "highlight").map((beat) => ({ beat: beat.index, action: beat.action, text: beat.text, rects: beat.pageRects })),
      beats: timeline.effects.map((effect) => {
        const beat = measured.find((entry) => entry.index === effect.index);
        const box = effect.box ? { ...effect.box, y: Math.round((effect.box.y + pageRegion.y0) * 10) / 10 } : null;
        return { index: effect.index, action: effect.action, at: beat.at, dur: beat.dur, target: targetLabel(beat.target), ...(beat.label ? { label: beat.label } : {}), ...(beat.text ? { matched: beat.text } : {}), ...(beat.via ? { via: beat.via } : {}), start: effect.start, end: effect.end, box };
      })
    };
    const sidecar = `${base}.evidence.json`;
    await writeFile(sidecar, `${JSON.stringify(record, null, 2)}\n`);
    return { video: out, poster, sidecar, fullpage, snapshot, record };
  } finally {
    await browser.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * --still: one hi-res crop of a target (or the top of the page) for
 * rebuilding as a card. → {still, sidecar, record}. Writes <id>.still.png
 * and <id>.still.json (provenance, final URL, snapshot sha256, crop box).
 */
export async function captureStill(input, { root = process.cwd(), target = null, scale, pad, log = () => {}, availability = recorderAvailability } = {}) {
  const { errors, request } = validateCaptureRequest({ beats: [], ...input });
  if (errors.length) throw new Error(`capture request has errors:\n- ${errors.join("\n- ")}`);
  const available = await availability();
  if (!available.ok) throw new Error(`cannot capture: ${available.reasons.join("; ")}`);
  const want = target ?? request.still?.target ?? null;
  const k = scale ?? request.still?.scale ?? 3, margin = pad ?? request.still?.pad ?? 24;
  const dir = path.dirname(path.resolve(root, request.out));
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, request.id);
  const browser = await launch(available);
  try {
    const viewport = { width: request.viewport.width, height: request.viewport.height };
    const { context, page, status, consent, title, hidden, route } = await openEvidencePage(browser, request, { viewport, scale: k, log });
    try {
      await freeze(page, viewport.height * 3);
      let box = { x: 0, y: 0, width: viewport.width, height: viewport.height }, matched = null;
      if (want) {
        const result = await measureTarget(page, retarget(want, route).target, "still target");
        const r = result.rects.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), right: Math.max(a.right, b.x + b.width), bottom: Math.max(a.bottom, b.y + b.height) }), { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity });
        const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const x = Math.max(0, r.x - margin), y = Math.max(0, r.y - margin);
        box = { x, y, width: Math.min(docWidth, r.right + margin) - x, height: r.bottom + margin - y };
        matched = result.text;
      }
      const html = await page.content();
      const still = `${base}.still.png`;
      await page.screenshot({ path: still, clip: box, fullPage: true, animations: "disabled", caret: "hide" });
      const record = { schema: SIDECAR_SCHEMA, id: request.id, kind: request.kind, mode: "still", request_url: request.url, final_url: page.url(), http_status: status, page_title: title,
        provenance: { ...request.provenance }, captured_at: new Date().toISOString(), consent, hidden, route: { name: route.name, url: route.url, notes: route.notes }, still: { path: rel(dir, still), box, scale: k, pixels: { width: Math.round(box.width * k), height: Math.round(box.height * k) } },
        target: want ? targetLabel(want) : null, ...(matched ? { matched } : {}), snapshot: { sha256: sha256(html), bytes: Buffer.byteLength(html) } };
      const sidecar = `${base}.still.json`;
      await writeFile(sidecar, `${JSON.stringify(record, null, 2)}\n`);
      return { still, sidecar, record };
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
