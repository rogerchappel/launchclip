// Logos: each organisation the research names → its official domain
// (Wikidata's "official website", P856, or a domain the caller names) → its
// logo, fetched at run time from the organisation's own home page, else the
// Simple Icons CDN (CC0 icon data). No logo pack ships with LaunchClip.
//
// On the home page, in order: an inline or linked SVG logo in the header, a
// <link rel=icon> SVG, the apple-touch-icon, then og:image only when it is
// plainly a logo. Public http(s) hosts only (the evidence capture guard),
// no credentials or cookies, a short timeout and a size cap per request, and
// redirects are followed by hand so every hop passes the guard.
//
// Files land in research/logos/<slug>.svg|png and research/logos.json lists
// them. Kit modules read project-local assets/ paths, so each entry names the
// asset path it should be staged at (stageLogos copies them) and the params
// each logo module takes.
//
// An optional cache (options.cacheDir or LAUNCHCLIP_LOGO_CACHE), keyed by
// domain, keeps repeated runs from refetching.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPublicUrl } from "../evidence/capture.js";
import { createHttp, decodeEntities } from "./http.js";
import { LOGOS_SCHEMA, RESEARCH_PATHS } from "./schema.js";

const USER_AGENT = "launchclip-research/1 (+https://github.com/rogerchappel/launchclip)";
const SIMPLE_ICONS = "https://cdn.simpleicons.org";
// The library's list of brands (title, slug, colour); the major version keeps the file's path and shape.
const SIMPLE_ICONS_INDEX = "https://cdn.jsdelivr.net/npm/simple-icons@16/data/simple-icons.json";
const ORG_DESCRIPTION = /\b(?:company|corporation|business|enterprise|firm|startup|start-up|conglomerate|manufacturer|maker|developer|publisher|laborator(?:y|ies)|lab|organi[sz]ation|non-?profit|foundation|institute|agency|brand|subsidiary|website|platform|service|provider|retailer|bank|network|studio|group)\b/i;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;

export const LOGO_DEFAULTS = Object.freeze({ max: 8, timeoutMs: 8000, maxBytes: 512 * 1024, maxPageBytes: 2 * 1024 * 1024, minRaster: 96 });

// What a logo plugs into: the kit modules that take a logo file, and the param shape each wants.
export const LOGO_MODULES = Object.freeze({
  "logo-row": { param: "logos", shape: "[{src: asset, label: name ≤ 20}] 2–6" },
  "brand-lockup": { param: "mark", shape: "asset (a square mark) or {src, ratio}; a monochrome mark wants markTint" },
  "orbit-cards": { param: "items", shape: "[{image: asset, text?: ≤ 40}] 3–6" },
  "particle-logo": { param: "logos", shape: "[{path: {d, viewBox}, label ≤ 24}] 1–2; only logos with a single-path `path`" }
});

/**
 * entities (research's entity index) → {logos[], missed[], files[{file, bytes}], cache_hits}
 * options: {cacheDir, domains ({name: domain}), max, timeoutMs, maxBytes, now}
 * adapters: {fetch, http (research's createHttp, for Wikidata), env, log}
 */
export async function findLogos(entities, options = {}, adapters = {}) {
  const env = adapters.env ?? process.env;
  const log = adapters.log ?? (() => {});
  const fetcher = adapters.fetch ?? globalThis.fetch;
  const http = adapters.http ?? createHttp({ fetch: fetcher, env, log });
  const limits = { ...LOGO_DEFAULTS, ...pick(options, ["timeoutMs", "maxBytes", "maxPageBytes", "minRaster"]) };
  const get = (url, max = limits.maxBytes) => publicFetch(url, { fetch: fetcher, timeoutMs: limits.timeoutMs, maxBytes: max, log });
  const now = options.now ?? new Date().toISOString();
  const cache = logoCache(options.cacheDir ?? env.LAUNCHCLIP_LOGO_CACHE ?? null);
  const domains = Object.fromEntries(Object.entries(options.domains ?? {}).map(([name, domain]) => [normalise(name), domain]));
  const max = Number(options.max ?? LOGO_DEFAULTS.max);

  const candidates = entities
    .filter((entity) => entity.kind === "org" || entity.kind === "name" || domains[normalise(entity.name)])
    .sort((a, b) => (b.claims?.length ?? 0) - (a.claims?.length ?? 0));
  const logos = [];
  const missed = [];
  const files = [];
  let cacheHits = 0;
  for (const entity of candidates) {
    if (logos.length >= max) break;
    const name = entity.name;
    let resolved = null;
    try {
      // 1. The domain: named by the caller, else the cache's name index, else Wikidata.
      const given = domains[normalise(name)];
      if (given) resolved = { domain: bareDomain(given), website: /^https?:\/\//.test(given) ? given : `https://${bareDomain(given)}/` };
      else if (cache && await cache.domainOf(name)) resolved = await cache.domainOf(name);
      else resolved = await officialDomain(http, name);
      // "name" entities are any capitalised run; only a Wikidata organisation (or a named domain) gets a logo.
      if (!resolved && entity.kind !== "org") continue;
      const key = resolved?.domain ?? `simple-icons/${simpleIconsSlug(name)}`;
      const hit = cache ? await cache.get(key) : null;
      let found;
      if (hit) {
        found = hit;
        cacheHits += 1;
      } else {
        found = (resolved ? await siteLogo(resolved, name, get, limits) : null) ?? await simpleIcon(name, resolved?.domain, get);
        if (found && cache) await cache.put(key, found);
      }
      if (resolved && cache) await cache.setDomain(name, resolved);
      if (!found) { missed.push({ name, domain: resolved?.domain ?? null, reason: resolved ? "no logo on the site or Simple Icons" : "no official domain and no Simple Icons match" }); continue; }
      const slug = uniqueSlug(slugOf(name), logos);
      const entry = manifestEntry({ name, slug, entity, resolved, found, now });
      logos.push(entry);
      files.push({ file: entry.file, bytes: found.bytes });
      log(`research: logo for ${name} (${entry.kind}${entry.via ? `, ${entry.via}` : ""})`);
    } catch (error) {
      missed.push({ name, domain: resolved?.domain ?? null, reason: String(error?.message ?? error).split("\n")[0] });
    }
  }
  return { logos, missed, files, cache_hits: cacheHits };
}

/** The research/logos.json manifest for findLogos' result. */
export function logoManifest(result, now = new Date().toISOString()) {
  return {
    schema: LOGOS_SCHEMA,
    created_at: now,
    policy: {
      use: "each logo identifies the organisation the research names; no endorsement implied",
      sources: "the organisation's own site, else Simple Icons (CC0 icon data); the marks stay their owners' trademarks",
      stage: `kit modules read assets/ paths: copy research/${RESEARCH_PATHS.logoFiles}/<slug>.<ext> to each entry's asset path (stageLogos)`
    },
    modules: LOGO_MODULES,
    logos: result.logos,
    missed: result.missed
  };
}

/** Write research/logos/* and research/logos.json (replacing an earlier run's). */
export async function writeLogos(outDir, result, manifest) {
  const dir = path.join(outDir, RESEARCH_PATHS.logoFiles);
  await rm(dir, { recursive: true, force: true });
  if (result.files.length) await mkdir(dir, { recursive: true });
  for (const { file, bytes } of result.files) await writeFile(path.join(outDir, file), bytes);
  await writeFile(path.join(outDir, RESEARCH_PATHS.logos), `${JSON.stringify(manifest, null, 2)}\n`);
  return result.files.map(({ file }) => path.join(outDir, file));
}

/** Copy the manifest's logos into <root>/assets/logos/ so modules can name them. → the staged entries */
export async function stageLogos(manifest, researchDir, root) {
  const staged = [];
  for (const logo of manifest.logos ?? []) {
    const target = path.join(root, logo.asset);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(researchDir, logo.file), target);
    staged.push({ ...logo, staged: target });
  }
  return staged;
}

// ---------------------------------------------------------------------------
// Domains

/** An organisation's official site from Wikidata → {domain, website, wikidata} or null. */
export async function officialDomain(http, name) {
  const search = await http.json(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=5&format=json&origin=*`);
  const ids = (search?.search ?? []).filter((hit) => normalise(hit.label) === normalise(name) || (hit.aliases ?? []).some((alias) => normalise(alias) === normalise(name))).map((hit) => hit.id);
  if (!ids.length) return null;
  const data = await http.json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims|descriptions&languages=en&format=json&origin=*`);
  for (const id of ids) {
    const entity = data?.entities?.[id];
    const humans = (entity?.claims?.P31 ?? []).some((claim) => claim.mainsnak?.datavalue?.value?.id === "Q5");
    const description = entity?.descriptions?.en?.value ?? "";
    const website = (entity?.claims?.P856 ?? []).map((claim) => claim.mainsnak?.datavalue?.value).find((value) => /^https?:\/\//.test(value ?? ""));
    if (humans || !website || !ORG_DESCRIPTION.test(description)) continue;
    return { domain: bareDomain(website), website, wikidata: id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The site

/** The logo on the organisation's home page, best first → {bytes, format, source_url, page_url, via, kind} or null. */
export async function siteLogo(resolved, name, get, limits = LOGO_DEFAULTS) {
  const page = await get(resolved.website, limits.maxPageBytes);
  if (!page || !/html/i.test(page.type) && !/^\s*</.test(page.bytes.subarray(0, 64).toString("utf8"))) return null;
  const html = page.bytes.toString("utf8");
  for (const candidate of pageLogoCandidates(html, page.url, name)) {
    if (candidate.svg) {
      const svg = cleanSvg(candidate.svg);
      if (svg) return { kind: "site", via: candidate.via, format: "svg", bytes: Buffer.from(svg), source_url: page.url, page_url: page.url };
      continue;
    }
    let file = null;
    try { file = await get(candidate.url); } catch { file = null; }
    const found = file && checkFile(file, candidate.svgOnly, limits);
    if (found) return { kind: "site", via: candidate.via, ...found, source_url: file.url, page_url: page.url };
  }
  return null;
}

/**
 * The page's logo candidates in preference order:
 * [{via, svg} | {via, url, svgOnly?}]
 */
export function pageLogoCandidates(html, baseUrl, name = "") {
  const out = [];
  const wanted = new RegExp(`logo|brand|home|${escapeRegExp(normalise(name)) || "\\b\\B"}`, "i");
  const absolute = (href) => { try { return new URL(decodeEntities(href), baseUrl).href; } catch { return null; } };
  const header = html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] ?? "";
  // Header SVG: inline in a home link, or labelled as the logo or the brand.
  for (const match of header.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    const before = header.slice(Math.max(0, match.index - 400), match.index);
    const link = before.match(/<a\b[^>]*>(?![\s\S]*<\/a>)[\s\S]*$/i)?.[0] ?? "";
    const open = match[0].match(/^<svg\b[^>]*>/i)[0];
    const title = match[0].match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const homeLink = /href=["'](?:\/|\.\/|https?:\/\/[^"'/]+\/?)["']/i.test(link);
    if (homeLink || wanted.test(squash(`${open} ${title} ${link}`))) out.push({ via: "header-svg", svg: match[0] });
  }
  for (const match of header.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(match[0], "src");
    if (src && /\.svg(?:[?#]|$)/i.test(src) && wanted.test(squash(`${attr(match[0], "alt") ?? ""} ${attr(match[0], "class") ?? ""} ${attr(match[0], "id") ?? ""} ${src}`))) {
      const url = absolute(src);
      if (url) out.push({ via: "header-img", url, svgOnly: true });
    }
  }
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  for (const tag of links) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attr(tag, "href");
    if (!href || !(rel.includes("icon") || rel.includes("mask-icon"))) continue;
    if (/svg/i.test(attr(tag, "type") ?? "") || /\.svg(?:[?#]|$)/i.test(href)) {
      const url = absolute(href);
      if (url) out.push({ via: "icon-svg", url, svgOnly: true });
    }
  }
  const touch = links.filter((tag) => /apple-touch-icon/i.test(attr(tag, "rel") ?? "") && attr(tag, "href"))
    .sort((a, b) => sizeOf(attr(b, "sizes")) - sizeOf(attr(a, "sizes")));
  for (const tag of touch) {
    const url = absolute(attr(tag, "href"));
    if (url) out.push({ via: "apple-touch-icon", url });
  }
  const og = metaContent(html, "og:image");
  const ogAlt = metaContent(html, "og:image:alt") ?? "";
  if (og && /logo/i.test(`${og} ${ogAlt}`)) {
    const url = absolute(og);
    if (url) out.push({ via: "og-image", url });
  }
  return out;
}

/** A logo file's bytes → {format, bytes, width?, height?} when it is a usable SVG or raster, else null. */
export function checkFile(file, svgOnly = false, limits = LOGO_DEFAULTS) {
  const head = file.bytes.subarray(0, 512).toString("utf8");
  if (/svg/i.test(file.type) || /<svg\b/i.test(head)) {
    const svg = cleanSvg(file.bytes.toString("utf8"));
    return svg ? { format: "svg", bytes: Buffer.from(svg) } : null;
  }
  if (svgOnly) return null;
  const raster = rasterInfo(file.bytes);
  if (!raster) return null;
  if (raster.width != null && Math.min(raster.width, raster.height) < limits.minRaster) return null;
  return { format: raster.format, bytes: file.bytes, ...(raster.width != null ? { width: raster.width, height: raster.height } : {}) };
}

/** An SVG document or inline <svg> → a standalone, script-free SVG string, or null when it is not a drawable logo. */
export function cleanSvg(text) {
  const match = String(text).match(/<svg\b[\s\S]*<\/svg>/i);
  if (!match) return null;
  let svg = match[0];
  // A sprite reference or an embedded document draws nothing on its own.
  if (/<use\b[^>]*href=["']#/i.test(svg) && !/<symbol\b|<defs\b/i.test(svg)) return null;
  svg = svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(?:xlink:)?href\s*=\s*["']\s*javascript:[^"']*["']/gi, "");
  if (!/<(?:path|rect|circle|ellipse|polygon|polyline|line|text|image|g)\b/i.test(svg)) return null;
  const open = svg.match(/^<svg\b[^>]*>/i)[0];
  if (!/viewBox=/i.test(open) && !(/\swidth=/i.test(open) && /\sheight=/i.test(open))) return null;
  let fixed = open;
  if (!/\sxmlns=/i.test(fixed)) fixed = fixed.replace(/^<svg\b/i, "<svg xmlns=\"http://www.w3.org/2000/svg\"");
  if (/xlink:/i.test(svg) && !/xmlns:xlink=/i.test(fixed)) fixed = fixed.replace(/^<svg\b/i, "<svg xmlns:xlink=\"http://www.w3.org/1999/xlink\"");
  return `${fixed}${svg.slice(open.length)}\n`;
}

// ---------------------------------------------------------------------------
// Simple Icons

/** Simple Icons' slug for a brand name ("Hugging Face" → "huggingface", "Dev.to" → "devdotto"). */
export function simpleIconsSlug(name) {
  return String(name).toLowerCase()
    .replace(/\+/g, "plus").replace(/\./g, "dot").replace(/&/g, "and")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The names Simple Icons has a mark for, as slugs: its public data file, read
 * once per process. A caller that checks a name here first never sends a
 * name the library does not hold (a person's, say) to the CDN.
 * → Set of slugs, or null when the file cannot be read.
 */
let simpleIconsSlugs = null;
export async function simpleIconsIndex(get) {
  if (simpleIconsSlugs) return simpleIconsSlugs;
  try {
    const file = await get(SIMPLE_ICONS_INDEX, 2 * 1024 * 1024);
    const list = JSON.parse(file.bytes.toString("utf8"));
    const slugs = new Set((Array.isArray(list) ? list : list.icons ?? []).map((icon) => icon.slug ?? simpleIconsSlug(icon.title)).filter(Boolean));
    if (slugs.size) simpleIconsSlugs = slugs;
    return simpleIconsSlugs;
  } catch { return null; }
}

/** The Simple Icons CDN by slug (from the name, then the domain) → a found logo or null. */
export async function simpleIcon(name, domain, get) {
  const slugs = [...new Set([simpleIconsSlug(name), domain ? simpleIconsSlug(domain.split(".").slice(0, -1).join("")) : null].filter((slug) => slug && slug.length >= 2))];
  for (const slug of slugs) {
    const url = `${SIMPLE_ICONS}/${slug}`;
    const file = await get(url);
    const svg = file && cleanSvg(file.bytes.toString("utf8"));
    if (svg) return { kind: "simple-icons", via: "simple-icons", slug, format: "svg", bytes: Buffer.from(svg), source_url: url };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fetching: public hosts only, no credentials, short timeout, size cap.

/** → {url (final), status, type, bytes} or null; throws for a private or local host. */
export async function publicFetch(url, { fetch, timeoutMs = LOGO_DEFAULTS.timeoutMs, maxBytes = LOGO_DEFAULTS.maxBytes, log = () => {} } = {}) {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    assertPublicLogoUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current, { headers: { "user-agent": USER_AGENT, accept: "text/html,image/svg+xml,image/png,image/*;q=0.8,*/*;q=0.5" }, redirect: "manual", credentials: "omit", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.("location");
        await response.body?.cancel?.().catch?.(() => {});
        if (!location) return null;
        current = new URL(location, current).href;
        continue;
      }
      if (!response.ok) { log(`research: logo ${response.status} from ${current}`); return null; }
      const length = Number(response.headers?.get?.("content-length") ?? 0);
      if (length > maxBytes) { await response.body?.cancel?.().catch?.(() => {}); return null; }
      const bytes = await readCapped(response, maxBytes);
      if (!bytes) return null;
      return { url: current, status: response.status, type: String(response.headers?.get?.("content-type") ?? ""), bytes };
    } catch (error) {
      if (error?.name === "AbortError") { log(`research: logo fetch timed out: ${current}`); return null; }
      if (/local or private address|must be http/.test(String(error?.message))) throw error;
      log(`research: logo fetch failed: ${current} (${String(error?.message ?? error).split("\n")[0]})`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** The evidence guard, plus no credentials in the URL and the private ranges it does not list. */
export function assertPublicLogoUrl(url) {
  const parsed = assertPublicUrl(url);
  if (parsed.username || parsed.password) throw new Error(`logo URL ${url} carries credentials; logos are fetched without signing in`);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const [a, b] = host.split(".").map(Number);
  const linkLocal = /^\d+\.\d+\.\d+\.\d+$/.test(host) && ((a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127));
  const ipv6Private = host.includes(":") && (/^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host === "::" || /^::ffff:/.test(host));
  if (linkLocal || ipv6Private) throw new Error(`logo URL ${url} is a local or private address; logos come from public sites only`);
  return parsed;
}

async function readCapped(response, maxBytes) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > maxBytes ? null : buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

// ---------------------------------------------------------------------------
// Cache: <dir>/<domain>/logo.json + logo.<ext>, and names.json (name → domain).

export function logoCache(dir) {
  if (!dir) return null;
  const root = path.resolve(String(dir));
  const names = path.join(root, "names.json");
  const folder = (key) => path.join(root, ...String(key).split("/").map((part) => part.replace(/[^a-z0-9.-]/gi, "_")));
  let index = null;
  const loadIndex = async () => (index ??= existsSync(names) ? JSON.parse(await readFile(names, "utf8")) : {});
  return {
    dir: root,
    async domainOf(name) { return (await loadIndex())[normalise(name)] ?? null; },
    async setDomain(name, resolved) {
      const all = await loadIndex();
      if (JSON.stringify(all[normalise(name)]) === JSON.stringify(resolved)) return;
      all[normalise(name)] = resolved;
      await mkdir(root, { recursive: true });
      await writeFile(names, `${JSON.stringify(all, null, 2)}\n`);
    },
    async get(key) {
      const meta = path.join(folder(key), "logo.json");
      if (!existsSync(meta)) return null;
      try {
        const found = JSON.parse(await readFile(meta, "utf8"));
        return { ...found, bytes: await readFile(path.join(folder(key), `logo.${found.format}`)) };
      } catch { return null; }
    },
    async put(key, found) {
      const { bytes, ...meta } = found;
      await mkdir(folder(key), { recursive: true });
      await writeFile(path.join(folder(key), `logo.${found.format}`), bytes);
      await writeFile(path.join(folder(key), "logo.json"), `${JSON.stringify(meta, null, 2)}\n`);
    }
  };
}

// ---------------------------------------------------------------------------
// The manifest entry

function manifestEntry({ name, slug, entity, resolved, found, now }) {
  const ext = found.format === "jpeg" ? "jpg" : found.format;
  const file = `${RESEARCH_PATHS.logoFiles}/${slug}.${ext}`;
  const asset = `assets/logos/${slug}.${ext}`;
  const svg = found.format === "svg" ? found.bytes.toString("utf8") : null;
  const colors = svg ? svgColors(svg) : [];
  const single = svg ? singlePath(svg) : null;
  const label = name.length <= 20 ? name : `${name.slice(0, 19)}…`;
  const params = {
    "logo-row": { src: asset, label },
    "brand-lockup": { mark: asset },
    "orbit-cards": { image: asset },
    ...(single ? { "particle-logo": { path: single, label: name.slice(0, 24) } } : {})
  };
  return {
    name,
    domain: resolved?.domain ?? null,
    file,
    source_url: found.source_url,
    kind: found.kind,
    ...(colors.length ? { colors } : {}),
    via: found.via,
    format: ext,
    asset,
    ...(found.width ? { width: found.width, height: found.height } : {}),
    ...(svg ? { monochrome: colors.length === 0 || /currentColor/i.test(svg) } : {}),
    ...(single ? { path: single } : {}),
    ...(found.page_url ? { page_url: found.page_url } : {}),
    ...(found.slug ? { simple_icons_slug: found.slug } : {}),
    ...(resolved?.wikidata ? { wikidata: resolved.wikidata } : {}),
    claims: entity.claims ?? [],
    params,
    sha256: createHash("sha256").update(found.bytes).digest("hex"),
    fetched_at: now
  };
}

/** The SVG's fill and stroke colours, most used first (at most 3). */
export function svgColors(svg) {
  const counts = new Map();
  for (const match of svg.matchAll(/(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\b/gi)) {
    let hex = match[1].toLowerCase();
    if (hex.length === 4) hex = `#${hex.slice(1).split("").map((c) => c + c).join("")}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([hex]) => hex);
}

/** {d, viewBox} when the SVG is one path (every Simple Icon is): what particle-logo draws. */
export function singlePath(svg) {
  const paths = [...svg.matchAll(/<path\b[^>]*>/gi)];
  if (paths.length !== 1 || /<(?:rect|circle|ellipse|polygon|polyline|line|text|image)\b/i.test(svg)) return null;
  const d = attr(paths[0][0], "d");
  const viewBox = attr(svg.match(/^<svg\b[^>]*>/i)?.[0] ?? "", "viewBox")?.trim().replace(/[\s,]+/g, " ");
  if (!d || d.length > 20000 || !PATH_DATA.test(d) || !/^-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/.test(viewBox ?? "")) return null;
  return { d, viewBox };
}

// ---------------------------------------------------------------------------

function rasterInfo(bytes) {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes.toString("latin1", 1, 4) === "PNG") return { format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { format: "jpg", width: null, height: null };
  if (bytes.length > 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return { format: "webp", width: null, height: null };
  return null;
}

function attr(tag, name) {
  const match = String(tag).match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function metaContent(html, property) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    if ((attr(match[0], "property") ?? attr(match[0], "name")) === property) return attr(match[0], "content");
  }
  return null;
}

function sizeOf(sizes) {
  return Number(String(sizes ?? "").match(/(\d+)x\d+/)?.[1] ?? 0);
}

function bareDomain(value) {
  const text = String(value).trim();
  try { return new URL(/^https?:\/\//.test(text) ? text : `https://${text}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return text.toLowerCase(); }
}

function slugOf(name) {
  return String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "logo";
}

function uniqueSlug(slug, logos) {
  let candidate = slug;
  for (let n = 2; logos.some((logo) => logo.file.startsWith(`${RESEARCH_PATHS.logoFiles}/${candidate}.`)); n += 1) candidate = `${slug}-${n}`;
  return candidate;
}

function squash(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalise(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object[key] != null).map((key) => [key, Number(object[key])]));
}
