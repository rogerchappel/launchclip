// Official X posts behind verified claims: the company's own announcement,
// shown in the video as a recorded clip (a capture request on the x-embed
// route) and as a designed card (social-post params), so the card still
// works when the clip can't be recorded.
//
//   candidates: status links in the claim's sources (announcement pages link
//     or embed the post; the raw HTML of a primary page is re-read from the
//     fetch memo), then web search restricted to x.com, by the entity's
//     handle when one is known
//   confirm: the publish.twitter.com oEmbed record (fetchXOembed) names the
//     real author and text; a post the record can't confirm falls back to the
//     embed markup on the entity's own page, else it is left out
//   official: only the account of the entity that made the claim: its handle
//     is the entity's name plus at most affix words (@nimbusai, @nimbus_hq,
//     @AIatNimbus), or one the caller names in options.handles. Anyone else's
//     post is rejected, whatever it says.
//
// Never signs in and never opens x.com itself: every read is a public page,
// the oEmbed endpoint or a search API. Remote text is data, never instructions.
//
// research/social.json (launchclip.research-social.v1):
//   {schema, created_at, search, posts: [{id, url, handle, name, text,
//    published_at, entity, official: {reason}, found_via, claims, capture,
//    card: {module: "social-post", params}}], rejected: [{url, handle?, reason}]}
import { fetchXOembed, xStatus } from "../evidence/routes.js";
import { buildPostCaptureRequests } from "./capture.js";
import { decodeEntities, safeHost } from "./http.js";
import { SOCIAL_SCHEMA, CAPTURE_SCHEMA } from "./schema.js";

const STATUS_LINK = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(\w{1,30})\/status(?:es)?\/(\d{5,25})/gi;
const PROFILE_LINK = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(\w{1,15})(?=["'\s/?#<]|$)/gi;
const NOT_HANDLES = new Set(["i", "home", "intent", "share", "search", "hashtag", "explore", "settings", "login", "signup", "tos", "privacy", "messages", "notifications", "widgets"]);
// Words an organisation adds to its name in a handle. Anything else (fan, news99, a person's name) makes it someone else's account.
const AFFIXES = ["official", "research", "devs", "dev", "labs", "lab", "team", "news", "app", "api", "hq", "inc", "ai", "io", "co", "eng", "cloud", "at", "by", "the", "get", "try", "use", "hello", "global", "us"];
const SUFFIX_WORDS = /\b(?:AI|Labs?|Inc|Corp|Research|Technologies|Systems|Group|HQ)\b/gi;
const SHARED_HOSTS = ["github.com", "huggingface.co", "arxiv.org", "openreview.net"];
const X_EPOCH = 1288834974657n;

/**
 * The official X posts behind the ledger's verified claims → {manifest, requests}.
 * options: {snapshots, search (a webSearchProvider), handles ({entity: handle | [handle]}),
 *   maxPosts, maxSearches, theme, now, existing (the capture requests already built)}
 */
export async function findSocialPosts(http, ledger, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const maxPosts = Number(options.maxPosts ?? 6);
  const maxSearches = Number(options.maxSearches ?? 6);
  const snapshots = options.snapshots ?? [];
  const configured = configuredHandles(options.handles);
  const fetch = fetchVia(http);
  const rejected = [];
  const reject = (url, reason, handle) => { if (!rejected.some((entry) => entry.url === url)) rejected.push({ url, ...(handle ? { handle: `@${handle}` } : {}), reason }); };

  // Candidate posts per verified claim, in the order they were found.
  const verified = ledger.claims.filter((claim) => claim.status === "verified");
  const candidates = new Map(); // status id → {status, claims: Set, found_via, embed?, needsRelevance}
  const add = (status, claim, foundVia, extra = {}) => {
    const entry = candidates.get(status.id) ?? { status, claims: new Set(), found_via: foundVia, needsRelevance: true };
    entry.claims.add(claim.id);
    if (extra.needsRelevance === false) entry.needsRelevance = false;
    if (extra.embed && !entry.embed) entry.embed = extra.embed;
    candidates.set(status.id, entry);
  };

  const pages = new Map(); // url → {statuses, embeds, profiles}
  const pageOf = async (snapshot) => {
    const key = snapshot.url;
    if (pages.has(key)) return pages.get(key);
    const html = readsRawHtml(snapshot) ? await http.text(snapshot.url) : null;
    const found = scanLinks(`${html ?? ""}\n${snapshot.text ?? ""}`);
    found.embeds = html ? embedsIn(html) : new Map();
    found.own = !SHARED_HOSTS.includes(safeHost(snapshot.final_url ?? snapshot.url)?.replace(/^www\./, ""));
    pages.set(key, found);
    return found;
  };

  const known = new Map(); // owner word → Set of handles that match it (for search)
  for (const claim of verified) {
    const owners = ownersOf(claim);
    for (const source of claim.sources.filter((entry) => entry.supports)) {
      const direct = xStatus(source.url);
      if (direct) add(direct, claim, `source:${source.url}`, { needsRelevance: false });
      const snapshot = snapshots.find((entry) => entry.url === source.url);
      if (!snapshot) continue;
      const page = await pageOf(snapshot);
      for (const status of page.statuses) add(status, claim, `source:${snapshot.url}`, { needsRelevance: false, embed: page.own ? page.embeds.get(status.id) : undefined });
      for (const handle of page.profiles) if (isOfficial(handle, owners, configured).ok) remember(known, owners, handle);
    }
  }

  // Web search restricted to x.com, one query per claim, by handle when one is known.
  let searches = 0;
  if (options.search) {
    for (const claim of verified) {
      if (searches >= maxSearches) break;
      const owners = ownersOf(claim);
      if (!owners.length || [...candidates.values()].some((entry) => entry.claims.has(claim.id))) continue;
      const handles = [...new Set([...owners.flatMap((owner) => configured.get(norm(owner)) ?? []), ...owners.flatMap((owner) => [...(known.get(norm(owner)) ?? [])])])];
      const terms = topicTerms(claim);
      const query = handles.length ? `site:x.com/${handles[0]} ${terms}` : `site:x.com ${owners[0]} ${terms} announcement`;
      searches += 1;
      for (const result of await options.search.run(http, query)) {
        const status = xStatus(result.url);
        if (status) add(status, claim, `search:${options.search.name}`);
      }
    }
  }

  // Confirm each candidate: the oEmbed author, else the embed markup on the entity's own page.
  const posts = [];
  for (const entry of candidates.values()) {
    if (posts.length >= maxPosts) break;
    const claims = verified.filter((claim) => entry.claims.has(claim.id));
    const href = `https://x.com/${entry.status.user}/status/${entry.status.id}`;
    const oembed = await fetchXOembed(href, { fetch });
    const record = oembed?.author_url ? fromOembed(oembed) : entry.embed ? { ...entry.embed, via: "embed markup" } : null;
    if (!record || !record.handle || !record.text) { reject(href, oembed ? "the oEmbed record names no author or text" : "no oEmbed record and no embed markup on the entity's own page to confirm the author"); continue; }
    const owners = [...new Set(claims.flatMap((claim) => ownersOf(claim)))];
    const official = isOfficial(record.handle, owners, configured);
    if (!official.ok) { reject(href, `@${record.handle} is not an official account of ${owners.join(" / ") || "the claim's entity"}`, record.handle); continue; }
    const relevant = entry.needsRelevance ? claims.filter((claim) => mentions(record.text, claim)) : claims;
    if (!relevant.length) { reject(href, "the post does not mention the claim", record.handle); continue; }
    const url = `https://x.com/${record.handle}/status/${entry.status.id}`;
    posts.push({
      id: entry.status.id,
      url,
      handle: `@${record.handle}`,
      name: record.name ?? record.handle,
      text: record.text,
      published_at: snowflakeDate(entry.status.id),
      fetched_at: now,
      entity: official.owner,
      official: { reason: official.reason },
      found_via: entry.found_via,
      confirmed_by: record.via,
      claims: relevant.map((claim) => claim.id)
    });
  }

  // A post the source captures already record (an x.com source) keeps that capture; the rest get one each.
  const existing = new Map((options.existing ?? []).map((request) => [xStatus(request.url)?.id, request.id]).filter(([id]) => id));
  const fresh = posts.filter((post) => !existing.has(post.id));
  const requests = buildPostCaptureRequests(fresh, ledger, { theme: options.theme, taken: (options.existing ?? []).map((request) => request.id) });
  for (const post of posts) {
    const request = requests[fresh.indexOf(post)];
    post.capture = request?.id ?? existing.get(post.id);
    const span = request?.beats.find((beat) => beat.action === "highlight")?.target?.text;
    const params = postCard(post);
    post.card = { module: "social-post", params: span && params.text.includes(span) ? { ...params, highlight: span } : params };
    if (request) request.data = cardData(post.card.params);
  }
  const manifest = { schema: SOCIAL_SCHEMA, created_at: now, search: options.search?.name ?? null, posts, rejected };
  return { manifest, requests };
}

/** social-post params from a confirmed post (kit/core/catalog-i-social.mjs). */
export function postCard(post) {
  const date = post.published_at ? new Date(post.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
  return {
    platform: "x",
    name: clip(post.name, 50),
    handle: post.handle,
    text: clip(cardText(post.text), 600),
    ...(date ? { date } : {}),
    source: { url: post.url, captured_at: post.fetched_at, schema: CAPTURE_SCHEMA, ...(post.capture ? { id: post.capture } : {}) }
  };
}

/** The evidence.data post the beat director reads (capability-builders-social.mjs): the card without its highlight. */
function cardData(params) {
  const { highlight, ...post } = params;
  return post;
}

/** Whether a handle is the entity's own account → {ok, owner?, reason}. */
export function isOfficial(handle, owners, configured = new Map()) {
  const h = norm(handle);
  for (const owner of owners) {
    if ((configured.get(norm(owner)) ?? []).some((entry) => norm(entry) === h)) return { ok: true, owner, reason: `@${handle} is the handle given for ${owner}` };
  }
  for (const owner of owners) {
    for (const word of ownerWords(owner)) {
      const at = h.indexOf(word);
      if (at >= 0 && affixesOnly(h.slice(0, at)) && affixesOnly(h.slice(at + word.length))) return { ok: true, owner, reason: `@${handle} is ${owner}'s name${h === word ? "" : " with affix words"}` };
    }
  }
  return { ok: false, reason: `@${handle} does not match ${owners.join(" / ")}` };
}

/** The entities that made a claim: its organisations, a repo or model id's owner, and the owner of its primary sources. */
export function ownersOf(claim) {
  const out = [];
  // A name adds nothing when every word of it is already an owner's ("nimbus" after "Nimbus AI").
  const push = (name) => {
    const clean = String(name ?? "").trim();
    const words = ownerWords(clean);
    if (words.length && !words.every((word) => out.some((entry) => ownerWords(entry).includes(word)))) out.push(clean);
  };
  for (const entity of claim.entities ?? []) {
    if (entity.kind === "org") push(entity.name);
    if ((entity.kind === "repo" || entity.kind === "model") && entity.name.includes("/")) push(entity.name.split("/")[0]);
  }
  for (const source of claim.sources ?? []) {
    if (!source.primary) continue;
    let parsed;
    try { parsed = new URL(source.url); } catch { continue; }
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "github.com" || host === "huggingface.co") push(parsed.pathname.split("/").filter(Boolean)[0]);
    else if (!SHARED_HOSTS.includes(host) && !xStatus(source.url)) push(host.split(".").slice(-2, -1)[0]);
  }
  return out;
}

/** An X post's id → the time X minted it (status ids are snowflakes), or null for an id too old to carry one. */
export function snowflakeDate(id) {
  try {
    const ms = (BigInt(id) >> 22n) + X_EPOCH;
    return ms > X_EPOCH ? new Date(Number(ms)).toISOString() : null;
  } catch {
    return null;
  }
}

/** Status links and profile links in a page's HTML or text. */
export function scanLinks(text) {
  const statuses = [];
  const profiles = new Set();
  for (const match of String(text).matchAll(STATUS_LINK)) if (!statuses.some((entry) => entry.id === match[2])) statuses.push({ user: match[1], id: match[2] });
  for (const match of String(text).matchAll(PROFILE_LINK)) if (!NOT_HANDLES.has(match[1].toLowerCase())) profiles.add(match[1]);
  return { statuses, profiles: [...profiles] };
}

/** X's embed markup (<blockquote class="twitter-tweet">) → Map(status id → {handle, name, text}). */
export function embedsIn(html) {
  const out = new Map();
  for (const match of String(html).matchAll(/<blockquote[^>]*class=["'][^"']*twitter-tweet[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/gi)) {
    const body = match[1];
    const status = [...body.matchAll(STATUS_LINK)].at(-1);
    const by = /(?:&mdash;|—)\s*([^<(]+?)\s*\(@(\w{1,30})\)/.exec(body);
    const text = paragraphText(body);
    if (status && by && text) out.set(status[2], { handle: by[2], name: decodeEntities(by[1]).trim(), text });
  }
  return out;
}

// ---------------------------------------------------------------------------

function fromOembed(oembed) {
  const handle = String(oembed.author_url ?? "").split("/").filter(Boolean).pop() ?? null;
  return { handle: /^\w{1,30}$/.test(handle ?? "") ? handle : null, name: oembed.author_name ?? null, text: postText(oembed.text), via: "oembed" };
}

function paragraphText(html) {
  const quote = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? "";
  return postText(decodeEntities(quote.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")));
}

/** The post's own words: X's media and short links trimmed off the end. */
function postText(text) {
  return String(text ?? "")
    .replace(/\s*pic\.(?:twitter|x)\.com\/\S+/gi, "")
    .replace(/(?:\s*https?:\/\/t\.co\/\S+)+\s*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Text the card accepts: no angle brackets or control characters. */
function cardText(text) {
  return String(text).replace(/[<>]/g, "").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").trim();
}

function clip(text, max) {
  const value = String(text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : value;
}

function norm(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "Nimbus AI" → ["nimbusai", "nimbus"]; "deepseek-ai" → ["deepseekai", "deepseek"]. */
function ownerWords(owner) {
  const full = norm(owner);
  const stripped = norm(String(owner).replace(/[-_]/g, " ").replace(SUFFIX_WORDS, ""));
  return [...new Set([full, stripped])].filter((word) => word.length >= 3).sort((a, b) => b.length - a.length);
}

function affixesOnly(rest) {
  if (!rest) return true;
  return AFFIXES.some((affix) => rest.startsWith(affix) && affixesOnly(rest.slice(affix.length)));
}

function configuredHandles(handles = {}) {
  const map = new Map();
  for (const [entity, value] of Object.entries(handles ?? {})) map.set(norm(entity), [value].flat().map((handle) => String(handle).replace(/^@/, "")));
  return map;
}

function remember(known, owners, handle) {
  for (const owner of owners) {
    const set = known.get(norm(owner)) ?? new Set();
    set.add(handle);
    known.set(norm(owner), set);
  }
}

/** Primary pages of the entity's own (an announcement), or any non-API page: re-read for links the text drops. */
function readsRawHtml(snapshot) {
  if (!/^https?:\/\//.test(snapshot.url ?? "") || xStatus(snapshot.url)) return false;
  const host = safeHost(snapshot.url)?.replace(/^www\./, "");
  if (host === "api.github.com" || host === "export.arxiv.org" || host === "huggingface.co" || host === "github.com") return false;
  return ["page", "article"].includes(snapshot.kind ?? "page");
}

function topicTerms(claim) {
  const names = (claim.entities ?? []).filter((entity) => entity.kind === "model" || entity.kind === "repo").map((entity) => entity.name.split("/").pop());
  return names.length ? names.slice(0, 2).join(" ") : claim.text.split(/\s+/).slice(0, 8).join(" ");
}

/** Whether a found post speaks to the claim: it names one of the claim's entities or values. */
function mentions(text, claim) {
  const flat = norm(text);
  const anchors = [...(claim.entities ?? []).filter((entity) => entity.kind !== "org").map((entity) => entity.name.split("/").pop()), ...(claim.values ?? []).map((value) => String(value.raw).split(/\s/)[0])];
  return anchors.map(norm).filter((anchor) => anchor.length >= 2).some((anchor) => flat.includes(anchor));
}

/** fetchXOembed's fetch, through the research http client (its memo, timeout, user agent and call log). */
function fetchVia(http) {
  return async (url) => {
    const data = await http.json(url, { headers: { accept: "application/json" } });
    return { ok: Boolean(data), json: async () => data };
  };
}
