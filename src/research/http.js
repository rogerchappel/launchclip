// Fetching and snapshots for the research stage. Every page a claim is
// checked against is kept as text under research/snapshots/<sha256>.txt, and
// the ledger records that hash, so a reviewer can see exactly what the check
// read even after the page changes. Remote text is data, never instructions.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const USER_AGENT = "launchclip-research/1 (+https://github.com/rogerchappel/launchclip)";
const MAX_BODY = 4_000_000;

/**
 * options: {fetch, env, now, snapshotDir, timeoutMs, log}
 * → {json(url, init), text(url, init), snapshot(url, init), keep(fields, body), calls}
 */
export function createHttp(options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date().toISOString());
  const timeoutMs = Number(options.timeoutMs ?? 30_000);
  const log = options.log ?? (() => {});
  const calls = [];
  const memo = new Map();

  function headersFor(url, extra = {}) {
    const headers = { "user-agent": USER_AGENT, ...extra };
    const host = safeHost(url);
    if (host === "api.github.com" && env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
    if (host === "huggingface.co" && env.HF_TOKEN) headers.authorization = `Bearer ${env.HF_TOKEN}`;
    return headers;
  }

  async function request(url, init = {}) {
    const key = `${init.method ?? "GET"} ${url} ${init.body ?? ""}`;
    if (memo.has(key)) return memo.get(key);
    const pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(url, { ...init, headers: headersFor(url, init.headers), signal: controller.signal, redirect: "follow" });
        const body = await response.text();
        calls.push({ url: redactUrl(url), status: response.status });
        if (!response.ok) {
          log(`research: ${response.status} from ${redactUrl(url)}`);
          return { ok: false, status: response.status, body: "", url: response.url || url, headers: response.headers };
        }
        return { ok: true, status: response.status, body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body, url: response.url || url, headers: response.headers };
      } catch (error) {
        calls.push({ url: redactUrl(url), status: "error", error: String(error?.message ?? error) });
        log(`research: ${redactUrl(url)} failed (${String(error?.message ?? error).split("\n")[0]})`);
        return { ok: false, status: 0, body: "", url };
      } finally {
        clearTimeout(timer);
      }
    })();
    memo.set(key, pending);
    return pending;
  }

  return {
    calls,
    async json(url, init) {
      const response = await request(url, init);
      if (!response.ok) return null;
      try { return JSON.parse(response.body); } catch { return null; }
    },
    async text(url, init) {
      const response = await request(url, init);
      return response.ok ? response.body : null;
    },
    /** → {url, final_url, title, publisher, published_at, fetched_at, sha256, text, lines} or null */
    async snapshot(url, init = {}) {
      const response = await request(url, init);
      if (!response.ok || !response.body) return null;
      const type = String(response.headers?.get?.("content-type") ?? "");
      const html = /html/i.test(type) || /^\s*<(?:!doctype|html)/i.test(response.body);
      const page = html ? htmlToText(response.body) : { text: response.body, title: null, publisher: null, published_at: null };
      return keep({
        url,
        final_url: response.url,
        title: init.title ?? page.title,
        publisher: init.publisher ?? page.publisher ?? safeHost(response.url ?? url),
        published_at: init.published_at ?? page.published_at,
        text: page.text
      }, response.body);
    },
    keep
  };

  /** A snapshot built from API data: hashed (over the raw body), stamped and written like a fetched page. */
  async function keep(fields, body = fields.text) {
    const sha256 = createHash("sha256").update(String(body)).digest("hex");
    if (options.snapshotDir) {
      await mkdir(options.snapshotDir, { recursive: true });
      await writeFile(path.join(options.snapshotDir, `${sha256}.txt`), `${fields.url}\n\n${fields.text}`);
    }
    return { ...fields, fetched_at: now(), sha256 };
  }
}

/** HTML → readable text with the page's title, site name and publish date. */
export function htmlToText(html) {
  const meta = (name) => {
    const match = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*>`, "i"));
    return match ? decodeEntities(match[0].match(/content=["']([^"']*)["']/i)?.[1] ?? "") || null : null;
  };
  const title = meta("og:title") ?? (decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "") || null);
  const timeTag = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ?? null;
  const published = meta("article:published_time") ?? meta("datePublished") ?? meta("date") ?? timeTag;
  const text = decodeEntities(html
    .replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:td|th)[^>]*>/gi, " | ")
    .replace(/<\/(?:p|div|li|h[1-6]|tr|table|section|article|header|footer|blockquote|pre|br)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n").map((line) => line.replace(/[ \t ]+/g, " ").trim()).filter(Boolean).join("\n");
  return { text, title, publisher: meta("og:site_name"), published_at: published ? isoDate(published) : null };
}

export function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

export function isoDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function safeHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

// API keys never reach the ledger or the logs.
export function redactUrl(url) {
  return String(url).replace(/([?&](?:key|api_key|apikey|access_token|token)=)[^&]+/gi, "$1REDACTED");
}
