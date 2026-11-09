// Keyless news leads: where current stories are found when no web search key
// is set (and beside one when it is). Every source here is public, needs no
// key or sign-up, and is asked a handful of times a run:
//
//   feeds          a named company's own RSS or Atom feed, found from the
//                  <link rel="alternate"> on its official site (Wikidata),
//                  plus any --feed URL
//   hacker-news    the HN Search API (hn.algolia.com) for a query, or the
//                  official API's front page (hacker-news.firebaseio.com)
//   gdelt          the GDELT DOC 2.0 article list, one request a run
//   wikipedia      Portal:Current_events, for a brief that asks for the latest
//
// A lead is only a pointer: {url, title, published_at, via}. The page it
// points at is fetched, hashed and classified like any other source
// (sources.js), so the rule holds that a story needs a primary source.
// Hacker News, GDELT and Wikipedia are how a story was found, never who said
// it: they are recorded in research/news.json and never reach the narration.
import { decodeEntities, isoDate, safeHost } from "./http.js";
import { extractEntities } from "./claims.js";
import { isBlockedMediaUrl } from "./schema.js";

export const NEWS_SCHEMA = "launchclip.research-news.v1";
export const NEWS_FILE = "news.json";
export const NEWS_DEFAULTS = Object.freeze({ maxLeads: 10, perProvider: 6, maxFeeds: 3, maxQueries: 3 });

// What each provider asks of its users, repeated in news.json so a reviewer sees it.
export const NEWS_PROVIDERS = Object.freeze({
  feeds: { name: "Publisher and company feeds", terms: "RSS and Atom feeds the site itself advertises; robots.txt is honoured" },
  "hacker-news": { name: "Hacker News", terms: "official API: no key, no stated rate limit; HN Search API: no key, a few requests a run" },
  gdelt: { name: "GDELT Project", terms: "open data for any use with a citation to the GDELT Project (https://www.gdeltproject.org/); one request a run" },
  wikipedia: { name: "Wikipedia current events", terms: "Wikimedia API with an identifying user agent, requests in series; text is CC BY-SA and is never quoted, only its source links are followed" }
});

const DAY_MS = 86_400_000;
const HN_MIN_POINTS = 20;
// Words of the brief that describe the video or ask for news, not the subject.
const BRIEF_WORDS = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "by", "from", "about", "into", "is", "are", "was", "were", "what", "whats", "who", "why", "how", "when", "did", "does", "do", "has", "have", "this", "that", "these", "it", "its", "new", "news", "latest", "breaking", "headlines", "headline", "recent", "recently", "today", "todays", "yesterday", "week", "weeks", "month", "months", "year", "morning", "last", "just", "announce", "announces", "announced", "release", "releases", "released", "launch", "launches", "launched", "happened", "happening", "roundup", "round-up", "update", "updates", "top", "biggest", "best", "stories", "story", "video", "short", "clip", "explainer", "second", "seconds", "minute", "minutes", "brief", "make", "create", "cover", "covering", "summary", "summarise", "summarize", "explain", "explained", "everything", "need", "know", "you", "your", "we", "our", "my", "me", "i"]);
// Words too common in headlines to stand for the company a page belongs to.
const GENERIC_OWNER = new Set(["news", "tech", "technology", "today", "times", "post", "daily", "world", "week", "weekly", "report", "live", "show", "review", "first", "open", "data", "cloud", "apps", "home", "global", "media", "digital", "online", "business", "science", "health", "sports", "markets", "money", "politics", "video", "with", "from", "over", "after", "before", "says", "said", "will", "what", "when", "this", "that", "your", "more", "into", "about", "launches", "releases", "announces", "unveils", "introduces", "introducing", "launch", "release", "announcing", "breaking", "update", "official", "blog", "press", "story", "guide"]);

/**
 * How fresh a source must be for this brief, from its own words.
 * → {days, asked_by} or null when the brief does not ask for the latest.
 */
export function freshnessWindow(text) {
  const brief = String(text ?? "");
  const tiers = [
    [3, /\b(?:today(?:'s|’s)?|breaking|this morning|tonight|yesterday|last night|right now)\b/i],
    [10, /\b(?:this week(?:'s|’s)?|last week|past week|weekly|just (?:announced|released|launched|dropped|shipped|unveiled))\b/i],
    [14, /\b(?:latest|newest|recent(?:ly)?|news|headlines?|what(?:'s|’s| is) new|round-?up)\b/i],
    [45, /\b(?:this month(?:'s|’s)?|last month|past month)\b/i]
  ];
  for (const [days, pattern] of tiers) {
    const match = brief.match(pattern);
    if (match) return { days, asked_by: match[0] };
  }
  return null;
}

/** → days (a number), null for no limit, or undefined to read the brief: --fresh-days <n>|none. */
export function freshDaysOption(value) {
  if (value == null || value === true || value === "") return undefined;
  if (/^(?:none|off|any)$/i.test(String(value))) return null;
  const days = Number(value);
  if (!(days > 0)) throw new Error(`--fresh-days must be a number of days or none; got ${value}`);
  return days;
}

/** Days between an ISO date and now, or null without a date. */
export function ageDays(published, now) {
  const then = Date.parse(published ?? "");
  const at = Date.parse(now ?? "");
  if (!Number.isFinite(then) || !Number.isFinite(at)) return null;
  return Math.max(0, Math.round((at - then) / DAY_MS * 10) / 10);
}

/**
 * What to ask the news sources: the things the brief names (releases first,
 * then companies and people), then its subject words. → up to three queries;
 * none for a brief that only asks for "today's news".
 */
export function newsQueries(text, entities = [], options = {}) {
  const max = Number(options.max ?? NEWS_DEFAULTS.maxQueries);
  const rank = { model: 0, org: 1, person: 2, name: 3 };
  const named = entities
    .filter((entity) => entity.kind in rank && entity.name.length >= 4 || entity.kind === "org" || entity.kind === "model")
    .filter((entity) => !BRIEF_WORDS.has(entity.name.toLowerCase()) && entity.name !== "Brief")
    .sort((a, b) => rank[a.kind] - rank[b.kind])
    .map((entity) => entity.name.split("/").pop());
  const first = String(text ?? "").split("\n").map((line) => line.replace(/^#{1,6}\s+.*$/, "").trim()).find(Boolean) ?? "";
  const words = (first.toLowerCase().match(/[a-z0-9][a-z0-9.+'’-]*/g) ?? []).map((word) => word.replace(/['’]s$/, "").replace(/[.'’-]+$/, "")).filter((word) => word && !BRIEF_WORDS.has(word) && !/^\d+(?:-second|s)?$/.test(word));
  const subject = [...new Set(words)].slice(0, 5).join(" ");
  const covered = (query) => named.some((name) => name.toLowerCase() === query);
  // The names are the subject when there are any; the brief's other words only blur the search.
  return [...new Set(named.length ? named : subject && !covered(subject) ? [subject] : [])].slice(0, max);
}

/**
 * Leads from every keyless source. options: {queries, now, windowDays, feeds
 * (urls), sites ([{name, website}] of named companies), maxLeads, providers
 * (ids to use)} → {leads: [{url, title, published_at, via: [..], points?}],
 * providers: [{id, name, terms, leads}]}
 */
export async function findNewsLeads(http, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const windowDays = options.windowDays ?? null;
  const queries = options.queries ?? [];
  const only = options.providers ?? Object.keys(NEWS_PROVIDERS);
  const context = { queries, now, windowDays, since: windowDays ? Math.floor((Date.parse(now) - windowDays * DAY_MS) / 1000) : null };
  const runs = {
    feeds: () => feedLeads(http, { ...context, feeds: options.feeds ?? [], sites: options.sites ?? [] }),
    "hacker-news": () => hackerNewsLeads(http, context),
    gdelt: () => gdeltLeads(http, context),
    // A day-by-day list of events is only an answer to "what is new".
    wikipedia: () => windowDays ? currentEventsLeads(http, context) : []
  };
  const merged = new Map();
  const providers = [];
  for (const id of only) {
    if (!runs[id]) continue;
    let found = [];
    try { found = await runs[id](); } catch { found = []; }
    const fresh = found.filter((lead) => usableLead(lead) && withinWindow(lead.published_at, now, windowDays));
    for (const lead of fresh.slice(0, options.perProvider ?? NEWS_DEFAULTS.perProvider)) {
      const key = leadKey(lead.url);
      const existing = merged.get(key);
      if (existing) { existing.via.push(lead.via); existing.published_at ??= lead.published_at ?? null; continue; }
      merged.set(key, { url: lead.url, title: lead.title ?? null, published_at: lead.published_at ?? null, via: [lead.via], ...(lead.points != null ? { points: lead.points } : {}) });
    }
    providers.push({ id, name: NEWS_PROVIDERS[id].name, terms: NEWS_PROVIDERS[id].terms, leads: fresh.length });
  }
  // A company's own feed first, then stories more than one source carries, then the newest.
  const leads = [...merged.values()].sort((a, b) =>
    Number(b.via.some((via) => via.startsWith("feed:"))) - Number(a.via.some((via) => via.startsWith("feed:")))
    || b.via.length - a.via.length
    || (Date.parse(b.published_at ?? "") || 0) - (Date.parse(a.published_at ?? "") || 0));
  return { leads: leads.slice(0, options.maxLeads ?? NEWS_DEFAULTS.maxLeads), providers };
}

function usableLead(lead) {
  if (!/^https?:\/\//.test(lead?.url ?? "")) return false;
  // Video hosts and social sites are not pages research reads (official posts are found in social.js).
  return !isBlockedMediaUrl(lead.url);
}

function withinWindow(published, now, windowDays) {
  if (!windowDays) return true;
  const age = ageDays(published, now);
  // An undated lead is kept: the page's own date decides once it is fetched.
  return age == null || age <= windowDays;
}

/** Whether text holds the word as a whole word ("ai" is not in "said"). */
function hasWord(text, word) {
  return new RegExp(`(?<![a-z0-9])${String(word).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(String(text).toLowerCase());
}

function leadKey(url) {
  return String(url).replace(/^http:/, "https:").replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Hacker News

export async function hackerNewsLeads(http, { queries = [], since = null } = {}) {
  const leads = [];
  if (!queries.length) {
    // No subject: the front page is today's stories. The official API, one small item each.
    const ids = await http.json("https://hacker-news.firebaseio.com/v0/topstories.json");
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 8)) {
      const item = await http.json(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (item?.type === "story" && item.url) leads.push({ url: item.url, title: item.title ?? null, published_at: item.time ? new Date(item.time * 1000).toISOString() : null, points: item.score ?? 0, via: "hacker-news" });
    }
    return leads;
  }
  for (const query of queries.slice(0, 2)) {
    // A few points keep out what nobody read; a window keeps to what is new.
    const filter = `&numericFilters=${encodeURIComponent([`points>${HN_MIN_POINTS}`, ...(since ? [`created_at_i>${since}`] : [])].join(","))}`;
    const data = await http.json(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=8${filter}`);
    for (const hit of data?.hits ?? []) {
      // A story with no link is a discussion (Ask HN), not a source.
      if (!hit.url) continue;
      leads.push({ url: hit.url, title: hit.title ?? null, published_at: isoDate(hit.created_at) ?? null, points: hit.points ?? 0, via: "hacker-news" });
    }
  }
  return leads.sort((a, b) => b.points - a.points);
}

// ---------------------------------------------------------------------------
// GDELT

export async function gdeltLeads(http, { queries = [], windowDays = null } = {}) {
  // GDELT refuses a keyword under three letters and needs a subject; one request a run.
  const query = queries.find((entry) => /\s/.test(entry) ? entry.length >= 5 : entry.length >= 3);
  if (!query) return [];
  const phrase = /\s/.test(query) && query.split(/\s+/).length <= 3 ? `"${query}"` : query;
  const data = await http.json(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${phrase} sourcelang:english`)}&mode=artlist&format=json&maxrecords=12&sort=${windowDays ? "datedesc" : "hybridrel"}&timespan=${windowDays ? `${Math.ceil(windowDays)}d` : "3m"}`);
  return (data?.articles ?? []).map((article) => ({ url: article.url, title: article.title ?? null, published_at: gdeltDate(article.seendate), via: "gdelt" }));
}

/** "20261109T070000Z" → ISO. */
export function gdeltDate(value) {
  const match = String(value ?? "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z` : null;
}

// ---------------------------------------------------------------------------
// Wikipedia current events

export async function currentEventsLeads(http, { queries = [] } = {}) {
  const data = await http.json("https://en.wikipedia.org/w/api.php?action=parse&page=Portal:Current_events&prop=text&format=json&formatversion=2");
  const html = typeof data?.parse?.text === "string" ? data.parse.text : data?.parse?.text?.["*"];
  return currentEventItems(html ?? "").filter((item) => !queries.length || queries.some((query) => query.toLowerCase().split(/\s+/).every((word) => hasWord(item.text, word))))
    .flatMap((item) => item.links.slice(0, 2).map((url) => ({ url, title: null, published_at: item.date, via: "wikipedia" })));
}

/** The portal's HTML → [{date (ISO day), text, links: [source urls]}], one per listed event. */
export function currentEventItems(html) {
  const items = [];
  const days = String(html).split(/<div[^>]+class="[^"]*current-events-main[^"]*"/).slice(1);
  for (const day of days) {
    const date = isoDate(day.match(/<span class="bday[^"]*">(\d{4}-\d{2}-\d{2})<\/span>/)?.[1] ?? "") ?? null;
    for (const [, body] of day.matchAll(/<li>((?:(?!<li>|<\/li>)[\s\S])*)<\/li>/g)) {
      const links = [...body.matchAll(/<a[^>]+class="external[^"]*"[^>]+href="([^"]+)"/g), ...body.matchAll(/<a[^>]+href="([^"]+)"[^>]+class="external[^"]*"/g)].map((match) => decodeEntities(match[1])).filter((url) => /^https?:\/\//.test(url));
      if (!links.length) continue;
      items.push({ date, text: decodeEntities(body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(), links: [...new Set(links)] });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Feeds

async function feedLeads(http, { feeds = [], sites = [], queries = [], windowDays = null }) {
  const urls = [...feeds];
  for (const site of sites.slice(0, NEWS_DEFAULTS.maxFeeds)) {
    const html = await http.text(site.website, { robots: true });
    const found = feedLinks(html ?? "", site.website)[0];
    if (found) urls.push(found);
  }
  const leads = [];
  for (const url of [...new Set(urls)].slice(0, NEWS_DEFAULTS.maxFeeds + feeds.length)) {
    const xml = await http.text(url, { robots: true });
    const items = parseFeed(xml ?? "", url);
    // With a window the newest items are the news; without one, only items about what the brief names.
    const words = queries.flatMap((query) => query.toLowerCase().split(/\s+/)).filter((word) => word.length >= 3);
    const relevant = items.filter((item) => windowDays || !words.length || words.some((word) => hasWord(`${item.title} ${item.summary}`, word)));
    for (const item of relevant.slice(0, 4)) leads.push({ url: item.url, title: item.title, published_at: item.published_at, via: `feed:${safeHost(url) ?? "feed"}` });
  }
  return leads;
}

/** The feeds a page advertises: <link rel="alternate" type="application/rss+xml|atom+xml" href>. → absolute urls */
export function feedLinks(html, baseUrl) {
  const out = [];
  for (const [tag] of String(html).matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(?:rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try { out.push(new URL(decodeEntities(href), baseUrl).href); } catch { /* a bad href is skipped */ }
  }
  // Comment feeds are not the site's news.
  return [...new Set(out)].filter((url) => !/comments?\/feed|\/comments/i.test(url));
}

/** RSS 2.0 or Atom → [{title, url, published_at, summary}], newest first. */
export function parseFeed(xml, baseUrl = null) {
  const text = String(xml ?? "");
  const field = (body, name) => {
    const match = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    return match ? decodeEntities(match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
  };
  const absolute = (href) => { try { return new URL(href, baseUrl ?? undefined).href; } catch { return null; } };
  const items = [];
  for (const [, body] of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    items.push({ title: field(body, "title"), url: absolute(field(body, "link") || field(body, "guid")), published_at: isoDate(field(body, "pubDate") || field(body, "dc:date")), summary: field(body, "description").slice(0, 400) });
  }
  for (const [, body] of text.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const links = [...body.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => ({ rel: tag.match(/rel=["']([^"']+)["']/i)?.[1] ?? "alternate", href: tag.match(/href=["']([^"']+)["']/i)?.[1] }));
    const href = links.find((link) => link.rel === "alternate" && link.href)?.href ?? links.find((link) => link.href)?.href;
    items.push({ title: field(body, "title"), url: href ? absolute(decodeEntities(href)) : null, published_at: isoDate(field(body, "published") || field(body, "updated")), summary: (field(body, "summary") || field(body, "content")).slice(0, 400) });
  }
  return items.filter((item) => item.title && /^https?:\/\//.test(item.url ?? "")).sort((a, b) => (Date.parse(b.published_at ?? "") || 0) - (Date.parse(a.published_at ?? "") || 0));
}

// ---------------------------------------------------------------------------
// Stories

/** A page title without the site's name after it: "Nimbus-7B is here | Nimbus AI" → "Nimbus-7B is here". */
export function headlineOf(title) {
  const text = String(title ?? "").replace(/\s+/g, " ").trim();
  const cut = text.split(/\s+[|–—·•]\s+|\s+-\s+(?=[^-]*$)/);
  // The headline is the long part; a site name is a word or three.
  const head = cut.length > 1 && cut[0].split(" ").length >= 3 ? cut[0] : text;
  return head.trim();
}

/**
 * Whose story a headline is: the companies and products it names, plus each
 * capitalised word, so a title-cased headline ("Nimbus Unveils New Model")
 * still names Nimbus. A page on the domain of one of these is that party's
 * own word (sources.js classifyUrl).
 */
export function storyOwners(title) {
  const headline = headlineOf(title);
  const entities = extractEntities(headline).filter((entity) => ["org", "model", "name"].includes(entity.kind)).map((entity) => entity.name);
  const words = (headline.match(/\b[A-Z][A-Za-z0-9]{3,}\b/g) ?? []).filter((word) => !GENERIC_OWNER.has(word.toLowerCase()));
  return [...new Set([...entities, ...words])];
}

/** Links out of a page: the citations a report makes. → absolute http(s) urls on other hosts */
export function outboundLinks(html, baseUrl) {
  const own = safeHost(baseUrl);
  const out = [];
  for (const [, href] of String(html).matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["']/gi)) {
    let url;
    try { url = new URL(decodeEntities(href), baseUrl); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || url.hostname.toLowerCase() === own) continue;
    out.push(url.href);
  }
  return [...new Set(out)];
}
