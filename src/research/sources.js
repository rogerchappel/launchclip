// Source finding: primary sources first (model cards, repos, releases, PRs,
// commits, papers, official pages), then secondary ones from a configured web
// search. The public GitHub, Hugging Face and arXiv APIs are called directly;
// web search is pluggable (Brave, Tavily or Serper, whichever key is set) and
// simply absent without a key. Keyless news leads (news.js: company feeds,
// Hacker News, GDELT, Wikipedia current events) point at pages that are then
// fetched and classified here like any other.
//
// Each finder returns snapshots ({url, title, publisher, published_at,
// fetched_at, sha256, text}) tagged with {finder, kind, primary}. verify.js
// decides which of them support which claim.
import { assertPublicUrl } from "../evidence/capture.js";
import { safeHost } from "./http.js";
import { officialDomain } from "./logos.js";
import { ageDays, findNewsLeads, headlineOf, newsQueries, outboundLinks, storyOwners } from "./news.js";

// Hosts whose pages are the party's own words about its own work.
const PRIMARY_HOSTS = ["github.com", "huggingface.co", "arxiv.org", "openreview.net", "proceedings.neurips.cc", "aclanthology.org"];
const MAX_SEARCH_RESULTS = 5;

/**
 * entities (claims.js entityIndex) + options → snapshots.
 * options: {topic, text (the brief or script), urls (seen in the script), searches (claim search hints),
 *   news (false to skip the keyless news sources), feeds (urls), windowDays (how fresh a story must be),
 *   now, maxNewsLeads, maxPerEntity, env}
 * → {sources, search, news: {queries, providers, stories}}
 */
export async function findSources(http, entities, options = {}) {
  const env = options.env ?? process.env;
  const found = [];
  const seen = new Set();
  const keep = (snapshot, tags) => {
    if (!snapshot?.text) return;
    const key = canonicalUrl(snapshot.url);
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ ...snapshot, ...tags });
  };
  const repos = entities.filter((entity) => entity.kind === "repo").map((entity) => entity.name);
  const models = entities.filter((entity) => entity.kind === "model").map((entity) => entity.name);
  const papers = entities.filter((entity) => entity.kind === "paper").map((entity) => entity.name.replace(/^arXiv:/i, ""));
  const orgs = entities.filter((entity) => entity.kind === "org").map((entity) => entity.name);
  // Whose own words a page can be: the companies, products and models the claims name.
  const owners = unique([...orgs, ...models, ...entities.filter((entity) => entity.kind === "name").map((entity) => entity.name), ...repos.map((repo) => repo.split("/")[0])]);

  // Links the script names are checked first: they are what the writer relied on.
  for (const url of options.urls ?? []) {
    for (const snapshot of await snapshotUrl(http, url)) keep(snapshot, { finder: "script-link", ...classifySnapshot(snapshot, owners) });
  }
  // Hugging Face: a named repo id, else a search on each model name.
  const hfIds = new Set(repos);
  for (const model of models.slice(0, options.maxModels ?? 6)) {
    for (const id of await searchHuggingFace(http, model, orgs)) hfIds.add(id);
  }
  for (const id of hfIds) {
    for (const snapshot of await huggingFaceModel(http, id)) keep(snapshot, { finder: "huggingface", kind: "model-card", primary: true, source_class: "primary" });
  }
  // GitHub: the same ids as repos, plus a repository search on model names.
  const ghRepos = new Set(repos);
  for (const model of models.slice(0, options.maxModels ?? 6)) {
    for (const full of await searchGithub(http, model, orgs)) ghRepos.add(full);
  }
  for (const full of ghRepos) {
    for (const snapshot of await githubRepository(http, full)) keep(snapshot, { finder: "github", kind: snapshot.kind ?? "repo", primary: true, source_class: "primary" });
  }
  // arXiv: named papers, then a title search on model names.
  const arxivIds = new Set(papers);
  for (const model of models.slice(0, 3)) for (const id of await searchArxiv(http, model)) arxivIds.add(id);
  for (const id of arxivIds) {
    const snapshot = await arxivPaper(http, id);
    if (snapshot) keep(snapshot, { finder: "arxiv", kind: "article", primary: true, source_class: "primary" });
  }
  // Keyless news: stories the public indexes list, each followed to the page itself.
  const news = options.news === false ? { queries: [], providers: [], stories: [] } : await newsSources(http, entities, { ...options, orgs, owners, keep, found });
  // Web search, when a key is configured: one query per claim hint, else per model or the topic.
  const search = webSearchProvider(env);
  if (search) {
    const queries = unique([...(options.searches ?? []), ...models.slice(0, 4).map((model) => `${model} announcement`), ...(options.topic && !models.length ? [options.topic] : [])]).slice(0, options.maxSearches ?? 12);
    const fetchResults = async (query, { primaryOnly = false } = {}) => {
      const kept = [];
      for (const result of await search.run(http, query)) {
        if (/youtube\.com|youtu\.be/.test(result.url)) continue;
        // A follow-up for the primary source fetches only pages that can be one.
        if (primaryOnly && classifyUrl(result.url, owners).source_class === "aggregator") continue;
        const snapshot = await http.snapshot(result.url, { title: result.title, published_at: result.published_at ?? undefined });
        if (!snapshot) continue;
        const tags = classifySnapshot(snapshot, owners);
        if (primaryOnly && !tags.primary) continue;
        const before = found.length;
        keep(snapshot, { finder: `search:${search.name}`, query, ...tags });
        if (found.length > before) kept.push(found.at(-1));
      }
      return kept;
    };
    for (const query of queries) {
      const results = await fetchResults(query);
      if (results.some((entry) => entry.primary)) continue;
      // Only aggregators or rewrites answered: ask again for the company's own page.
      for (const followUp of primaryQueries(query, owners, found).slice(0, 2)) {
        const primaries = await fetchResults(followUp, { primaryOnly: true });
        if (primaries.length) break;
      }
    }
  }
  return { sources: found, search: search?.name ?? null, news };
}

/**
 * The keyless news pass. Each lead's page is fetched and classified against
 * the names the brief gives plus the ones its own headline gives, so a
 * company's announcement on its own domain is primary and a report about it
 * is not. A report's links to the company's own page are followed once: that
 * is where the primary source of a story usually is.
 * → {queries, providers, stories: [{title, url, publisher, published_at, age_days, via, source_class, primary, status, from?}]}
 */
async function newsSources(http, entities, options) {
  const { owners, orgs, keep, found } = options;
  const now = options.now ?? new Date().toISOString();
  const windowDays = options.windowDays ?? null;
  const queries = newsQueries(options.topic ?? options.text ?? "", entities);
  // A named company's own feed is the best lead there is; its site comes from Wikidata.
  const sites = [];
  for (const org of orgs.slice(0, 3)) {
    const site = await officialDomain(http, org).catch(() => null);
    if (site?.website) sites.push({ name: org, website: site.website });
  }
  const { leads, providers } = await findNewsLeads(http, { queries, now, windowDays, feeds: options.feeds ?? [], sites, maxLeads: options.maxNewsLeads });
  const stories = [];
  const record = (snapshot, lead, tags, extra = {}) => {
    const age = ageDays(snapshot.published_at, now);
    const stale = windowDays != null && age != null && age > windowDays;
    stories.push({
      title: headlineOf(snapshot.title ?? lead.title ?? snapshot.url), url: snapshot.url, publisher: snapshot.publisher ?? null, published_at: snapshot.published_at ?? null, age_days: age,
      via: lead.via, source_class: tags.source_class, primary: tags.primary,
      // A story is kept when the party's own page states it and it is as fresh as the brief asks.
      status: stale ? "stale" : tags.primary ? "kept" : "no-primary-source", ...extra
    });
    return !stale;
  };
  for (const lead of leads) {
    // Public pages only: a feed or an index can list any address.
    if (!isPublic(lead.url)) continue;
    const snapshot = await http.snapshot(lead.url, { published_fallback: lead.published_at ?? undefined });
    if (!snapshot?.text) { stories.push({ title: lead.title, url: lead.url, publisher: null, published_at: lead.published_at ?? null, age_days: ageDays(lead.published_at, now), via: lead.via, source_class: null, primary: false, status: "not-fetched", reason: notFetched(http.failure?.(lead.url)) }); continue; }
    const names = [...owners, ...storyOwners(lead.title ?? snapshot.title ?? "")];
    const tags = classifySnapshot(snapshot, names);
    // An old page may still back a claim the brief makes (the ledger then flags it as old news), but it is no story.
    const fresh = record(snapshot, lead, tags);
    keep(snapshot, { finder: `news:${lead.via[0]}`, ...tags, news: true, ...(fresh ? {} : { stale: true }) });
    if (tags.primary) continue;
    // A report cites its source: follow links to a page the story's own party owns.
    const html = await http.text(lead.url);
    const cited = outboundLinks(html ?? "", snapshot.final_url ?? lead.url).filter((url) => isPublic(url) && !SOCIAL_HOST.test(safeHost(url) ?? "") && classifyUrl(url, names).primary && !PRIMARY_HOSTS.includes(safeHost(url) ?? "")).slice(0, 2);
    for (const url of cited) {
      if (found.some((entry) => canonicalUrl(entry.url) === canonicalUrl(url))) continue;
      const page = await http.snapshot(url);
      if (!page?.text) continue;
      const pageTags = classifySnapshot(page, names);
      if (!pageTags.primary) continue;
      const pageFresh = record(page, lead, pageTags, { from: snapshot.url });
      keep(page, { finder: `news:${lead.via[0]}`, ...pageTags, news: true, ...(pageFresh ? {} : { stale: true }) });
    }
  }
  return { queries, providers, stories };
}

// Why a page gave nothing, in words: a refusal is a finding, never something to work round.
function notFetched(status) {
  if (status === "robots") return "its robots.txt does not allow this client";
  if (status === "401" || status === "403" || status === "429") return `the site refused the request (HTTP ${status}); it may still open in a browser, so pass it with --url after checking it, or pick another source`;
  if (status === "error") return "the request failed (network or timeout)";
  return status ? `HTTP ${status}` : "no readable text";
}

function isPublic(url) {
  try { assertPublicUrl(url); return true; } catch { return false; }
}

/**
 * A query that found no primary source → queries for one: "<company>
 * <product> announcement", restricted to the company's domain when a page on
 * it is already known (site: works on Brave, Serper and Tavily).
 */
export function primaryQueries(query, owners = [], found = []) {
  const named = owners.filter((name) => looseIn(query, name));
  if (!named.length) return [`${query} official announcement`];
  // The versioned name is the product ("Nimbus-7B"); a plain one is the company ("Nimbus AI").
  const product = named.find((name) => /\d/.test(name)) ?? named[0];
  const head = product.split(/[- ]/)[0];
  // The maker: a company the query names, else the named company whose name the product starts with.
  const company = named.find((name) => name !== product && !/\d/.test(name)) ?? owners.find((name) => !/\d/.test(name) && ownerWords([name]).includes(normalise(head))) ?? head;
  const subject = company === product ? product : `${company} ${product}`;
  const domain = found.map((entry) => safeHost(entry.url) ?? "").find((host) => host && !PRIMARY_HOSTS.includes(host) && !SOCIAL_HOST.test(host) && officialHost(host, ownerWords([company])));
  return unique([domain ? `${subject} announcement site:${domain.replace(/^www\./, "")}` : null, `${subject} announcement`, `${subject} blog`]);
}

function looseIn(text, name) {
  return normalise(text).includes(normalise(name));
}

/**
 * url + the names a claim mentions → {kind, primary, source_class}.
 *
 * source_class is "primary" (the party's own words: its domain, its official
 * account, the paper, the code host), "aggregator" (a roundup, digest or
 * listing of other people's news) or "secondary" (anything else: a rewrite,
 * a third-party page). The rule is structural, not an allowlist: a page on the
 * domain of an entity it names is that entity's own word. classifySnapshot
 * refines it with the page's text (an outlet's original report is primary).
 */
export function classifyUrl(url, names = []) {
  const host = safeHost(url) ?? "";
  let pathname = "";
  try { pathname = new URL(url).pathname; } catch { /* left empty */ }
  let kind = "page";
  if (host === "github.com") {
    if (/\/pull\/\d+\/files/.test(pathname) || /\/compare\//.test(pathname)) kind = "diff";
    else if (/\/pull\/\d+/.test(pathname)) kind = "pr";
    else if (/\/commit\/[0-9a-f]{7,40}/.test(pathname)) kind = "commit";
    else if (/^\/[^/]+\/[^/]+\/?$/.test(pathname) || /\/releases/.test(pathname)) kind = "repo";
  } else if (host === "huggingface.co" && /^\/(?!datasets|spaces|blog|papers)[^/]+\/[^/]+/.test(pathname)) kind = "model-card";
  else if (SOCIAL_HOST.test(host)) kind = "post";
  else if (/arxiv\.org|openreview\.net|news|blog|techcrunch|theverge|wired|reuters|bloomberg/.test(host + pathname)) kind = "article";
  const words = ownerWords(names);
  const codeHost = PRIMARY_HOSTS.some((primaryHost) => host === primaryHost || host.endsWith(`.${primaryHost}`));
  // An official account: x.com/<handle> where the handle is the entity's own name.
  const handle = kind === "post" ? normalise(pathname.split("/")[1] ?? "") : "";
  const officialPost = Boolean(handle) && words.some((word) => ownsLabel(handle, word));
  const official = !SOCIAL_HOST.test(host) && officialHost(host, words);
  const roundup = ROUNDUP_URL.test(pathname.toLowerCase()) || ROUNDUP_HOST.test(host);
  // Even on an owner's domain, a roundup page is a roundup.
  const primary = codeHost || officialPost || (official && !roundup);
  const source_class = primary ? "primary" : roundup ? "aggregator" : "secondary";
  return { kind, primary, source_class };
}

/**
 * A fetched snapshot + names → the same tags, refined by what the page says.
 * A third-party page that covers several of the named companies, or is titled
 * as a roundup, is an aggregator; one that reports first-hand (a statement
 * given to the outlet, an interview, a filing) is an original report and
 * counts as primary.
 */
export function classifySnapshot(snapshot, names = []) {
  const tags = classifyUrl(snapshot.final_url ?? snapshot.url, names);
  const title = String(snapshot.title ?? "");
  const roundupTitle = ROUNDUP_TITLE.test(title);
  if (tags.primary && !roundupTitle) return tags;
  if (tags.kind === "post" || ["pr", "commit", "diff", "repo", "model-card"].includes(tags.kind)) return tags;
  const text = String(snapshot.text ?? "");
  const host = safeHost(snapshot.final_url ?? snapshot.url) ?? "";
  // How many of the named companies this one page covers: a roundup covers many.
  const flat = normalise(text);
  // One company counts once ("Nimbus AI" and "Nimbus-7B" are both nimbus), and the host's own name not at all.
  const covered = new Set(names.map((name) => ownerWords([name]).sort((a, b) => a.length - b.length)[0]).filter((word) => word && word.length >= 4 && !officialHost(host, [word]) && flat.includes(word))).size;
  if (tags.source_class === "aggregator" || roundupTitle || covered >= 3) {
    return { ...tags, primary: false, source_class: "aggregator" };
  }
  if (ORIGINAL_REPORT.test(text)) return { ...tags, primary: true, source_class: "primary", report: true };
  return tags;
}

// The names an owner's domain or handle is spelled with: "Nimbus AI" → nimbusai, nimbus; "Nimbus-7B" → nimbus.
function ownerWords(names) {
  return unique(names.flatMap((name) => {
    const plain = String(name).split("/").pop();
    const head = plain.split(/[- ]/)[0];
    return [plain, plain.replace(/\b(?:AI|Labs?|Inc|Corp|Research|Technologies|Systems|Group)\b/gi, ""), /\d/.test(plain) ? head : null];
  }).filter(Boolean).map(normalise).filter((word) => word.length >= 3 && !/^\d/.test(word)));
}

// The owner's own domain: nimbus.ai, nimbusai.com, news.nimbus.com or blog.nimbus for "Nimbus AI";
// not openrouter.ai for "OpenAI", not nimbus-news-digest.com.
function officialHost(host, words) {
  const labels = host.replace(/^www\./, "").split(".").map(normalise).filter(Boolean);
  return words.some((word) => labels.some((label) => ownsLabel(label, word)));
}

function ownsLabel(label, word) {
  return label === word || (label.startsWith(word) && OWNER_SUFFIX.test(label.slice(word.length)));
}

const SOCIAL_HOST = /(^|\.)(x\.com|twitter\.com|bsky\.app|threads\.net|mastodon\.social)$/;
// What may follow an owner's name in its own domain label or handle: nimbusai, nimbuslabs, nimbushq.
const OWNER_SUFFIX = /^(?:ai|labs?|hq|inc|app|io|corp|co|research|tech|dev|official|team)$/;
const MONTH = "(?:january|february|march|april|may|june|july|august|september|october|november|december)";
// A page that lists other people's news, whoever hosts it.
const ROUNDUP_URL = new RegExp(`(?:round-?up|digest|newsletter|this-week|weekly|week-in|recap|top-\\d+-|best-|${MONTH}-(?:\\d{4}-)?(?:ai-)?(?:releases|updates|news|launches)|(?:^|/)(?:ai|tech)-news|what-happened|everything-announced|/tags?/|/category/|/directory/)`);
const ROUNDUP_HOST = /(?:digest|roundup|newsletter|weekly|tracker|insider|aggregat)/;
const ROUNDUP_TITLE = new RegExp(`(?:round-?up|digest|newsletter|this week in|weekly|recap|\\btop \\d+\\b|\\b\\d+ (?:biggest|best|top)\\b|everything (?:announced|you need)|${MONTH} (?:\\d{4} )?(?:ai )?(?:releases|updates|news|launches))`, "i");
// First-hand reporting: the company spoke to the outlet, or the outlet read the filing.
const ORIGINAL_REPORT = /\b(?:said in a statement|told [A-Z]\w+|confirmed to [A-Z]\w+|in an interview with|a spokesperson (?:for|said)|according to (?:a|the) (?:company|filing|statement|press release))/;

async function snapshotUrl(http, url) {
  const github = String(url).match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/(pull|commit)\/([0-9a-f]+|\d+))?/i);
  if (github?.[3] === "pull") return [await githubPull(http, `${github[1]}/${github[2]}`, github[4])].filter(Boolean);
  if (github?.[3] === "commit") return [await githubCommit(http, `${github[1]}/${github[2]}`, github[4])].filter(Boolean);
  if (github) return githubRepository(http, `${github[1]}/${github[2]}`);
  const hf = String(url).match(/^https?:\/\/huggingface\.co\/(?!datasets|spaces|blog|papers)([^/]+\/[^/#?]+)/i);
  if (hf) return huggingFaceModel(http, hf[1]);
  const arxiv = String(url).match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i);
  if (arxiv) return [await arxivPaper(http, arxiv[1])].filter(Boolean);
  return [await http.snapshot(url)].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Hugging Face

export async function searchHuggingFace(http, name, orgs = []) {
  const query = name.replace(/\s+/g, "-");
  const results = await http.json(`https://huggingface.co/api/models?search=${encodeURIComponent(query)}&sort=likes&direction=-1&limit=10`);
  if (!Array.isArray(results)) return [];
  const want = normalise(name);
  const orgWords = orgs.map(normalise);
  // The release itself, not a quantisation or fine-tune: the name matches and the author is the named org when there is one.
  const ranked = results
    .filter((model) => normalise(model.id.split("/")[1]).startsWith(want))
    .filter((model) => !/gguf|awq|gptq|mlx|exl\d|bpw|onnx|quant|abliterat|uncensored|heretic|bnb|\dbit|nvfp4|int[48]|-q\d|distill|merge|lora/i.test(model.id))
    .sort((a, b) => Number(orgWords.some((org) => normalise(b.id.split("/")[0]).includes(org))) - Number(orgWords.some((org) => normalise(a.id.split("/")[0]).includes(org))) || (b.likes ?? 0) - (a.likes ?? 0));
  // When the named org published it, a re-upload by anyone else is not the primary source.
  const byOrg = ranked.filter((model) => orgWords.some((org) => normalise(model.id.split("/")[0]).includes(org)));
  // Without the org, only a repo people actually use counts: anyone can name an upload after a closed model.
  return (byOrg.length ? byOrg : ranked.filter((model) => (model.likes ?? 0) >= 25)).slice(0, 2).map((model) => model.id);
}

export async function huggingFaceModel(http, id) {
  const info = await http.json(`https://huggingface.co/api/models/${id}`);
  if (!info?.id) return [];
  const url = `https://huggingface.co/${info.id}`;
  const readme = await http.text(`${url}/raw/main/README.md`);
  if (!readme) return [];
  // The API's own facts (licence, parameter count, dates) join the card text as one passage naming the model, so a claim can be checked against them.
  const facts = [
    `Model: ${info.id}`,
    info.createdAt ? `Created: ${info.createdAt}` : null,
    info.lastModified ? `Last modified: ${info.lastModified}` : null,
    info.cardData?.license ? `License: ${info.cardData.license}` : null,
    info.safetensors?.total ? `Parameters (safetensors total): ${info.safetensors.total}` : null,
    info.pipeline_tag ? `Pipeline: ${info.pipeline_tag}` : null,
    info.downloads != null ? `Downloads (last 30 days): ${info.downloads}` : null,
    info.likes != null ? `Likes: ${info.likes}` : null
  ].filter(Boolean).join("; ");
  const card = await http.keep({ url, title: `${info.id} · model card`, publisher: `Hugging Face · ${info.author ?? info.id.split("/")[0]}`, published_at: info.createdAt ?? null, text: `${readme}\n\nHugging Face API: ${facts}.` }, readme);
  return [{ ...card, api: { id: info.id, author: info.author, license: info.cardData?.license ?? null, parameters: info.safetensors?.total ?? null, sha: info.sha ?? null } }];
}

// ---------------------------------------------------------------------------
// GitHub

export async function searchGithub(http, name, orgs = []) {
  const results = await http.json(`https://api.github.com/search/repositories?q=${encodeURIComponent(`${name} in:name`)}&sort=stars&order=desc&per_page=5`);
  const items = results?.items ?? [];
  const orgWords = orgs.map(normalise);
  const want = normalise(name.split(/[- ]/)[0]);
  return items
    .filter((repo) => normalise(repo.name).includes(want) && (!orgWords.length || orgWords.some((org) => normalise(repo.owner?.login ?? "").includes(org))))
    .slice(0, 2)
    .map((repo) => repo.full_name);
}

export async function githubRepository(http, full) {
  const repo = await http.json(`https://api.github.com/repos/${full}`);
  if (!repo?.full_name) return [];
  const out = [];
  const readme = await http.text(`https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/README.md`);
  if (readme) {
    out.push(await http.keep({
      url: repo.html_url,
      title: `${repo.full_name}${repo.description ? `: ${repo.description}` : ""}`,
      publisher: `GitHub · ${repo.owner?.login}`,
      published_at: repo.created_at,
      text: `${readme}\n\nGitHub API: Repository ${repo.full_name}; Stars: ${repo.stargazers_count}; License: ${repo.license?.spdx_id ?? "none"}; Created: ${repo.created_at}; Pushed: ${repo.pushed_at}.`,
      kind: "repo"
    }, readme));
  }
  const releases = await http.json(`https://api.github.com/repos/${repo.full_name}/releases?per_page=3`);
  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release.body) continue;
    out.push(await http.keep({ url: release.html_url, title: `${repo.full_name} ${release.name || release.tag_name}`, publisher: `GitHub · ${repo.owner?.login}`, published_at: release.published_at, text: release.body, kind: "repo" }));
  }
  return out;
}

export async function githubPull(http, full, number) {
  const pull = await http.json(`https://api.github.com/repos/${full}/pulls/${number}`);
  if (!pull?.html_url) return null;
  // The facts line names the repo and number, so "pull request 39217" can be checked against the PR itself.
  const text = `${pull.title}\n\n${pull.body ?? ""}\n\nGitHub API: Pull request ${full}#${number} (pull request ${number}) by ${pull.user?.login ?? "unknown"}; State: ${pull.state}${pull.merged_at ? `; Merged: ${pull.merged_at}` : ""}; Changed files: ${pull.changed_files}; Additions: ${pull.additions}; Deletions: ${pull.deletions}.`;
  return http.keep({ url: pull.html_url, title: `${full}#${number}: ${pull.title}`, publisher: `GitHub · ${full.split("/")[0]}`, published_at: pull.merged_at ?? pull.created_at, text, kind: "pr" });
}

export async function githubCommit(http, full, sha) {
  const commit = await http.json(`https://api.github.com/repos/${full}/commits/${sha}`);
  if (!commit?.html_url) return null;
  const text = `${commit.commit?.message ?? ""}\n\nAuthor: ${commit.commit?.author?.name ?? ""}\nDate: ${commit.commit?.author?.date ?? ""}\nFiles: ${(commit.files ?? []).map((file) => file.filename).join(", ")}`;
  return http.keep({ url: commit.html_url, title: `${full}@${sha.slice(0, 7)}: ${String(commit.commit?.message ?? "").split("\n")[0]}`, publisher: `GitHub · ${full.split("/")[0]}`, published_at: commit.commit?.author?.date ?? null, text, kind: "commit" });
}

// ---------------------------------------------------------------------------
// arXiv

export async function searchArxiv(http, name) {
  const xml = await http.text(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`ti:"${name.replace(/-/g, " ")}"`)}&max_results=3&sortBy=submittedDate&sortOrder=descending`);
  return parseArxiv(xml ?? "").map((entry) => entry.id);
}

export async function arxivPaper(http, id) {
  const xml = await http.text(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
  const entry = parseArxiv(xml ?? "")[0];
  if (!entry) return null;
  const text = `${entry.title}\n\n${entry.summary}\n\nAuthors: ${entry.authors.join(", ")}\nPublished: ${entry.published}`;
  return http.keep({ url: `https://arxiv.org/abs/${entry.id}`, title: entry.title, publisher: "arXiv", published_at: entry.published, text, authors: entry.authors }, xml);
}

export function parseArxiv(xml) {
  return [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, body]) => {
    const tag = (name) => body.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const id = tag("id").match(/abs\/(\d{4}\.\d{4,5})/)?.[1] ?? tag("id").replace(/^.*abs\//, "").replace(/v\d+$/, "");
    return { id, title: tag("title"), summary: tag("summary"), published: tag("published") || null, authors: [...body.matchAll(/<name>([^<]+)<\/name>/g)].map((match) => match[1].trim()) };
  }).filter((entry) => entry.id && entry.title && entry.title !== "Error");
}

// ---------------------------------------------------------------------------
// Web search (pluggable)

/** The configured provider, or null: BRAVE_API_KEY, then TAVILY_API_KEY, then SERPER_API_KEY. */
export function webSearchProvider(env = process.env) {
  if (env.BRAVE_API_KEY) return {
    name: "brave",
    async run(http, query) {
      const data = await http.json(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_SEARCH_RESULTS}`, { headers: { accept: "application/json", "x-subscription-token": env.BRAVE_API_KEY } });
      return (data?.web?.results ?? []).map((result) => ({ url: result.url, title: result.title, published_at: result.page_age ?? null }));
    }
  };
  if (env.TAVILY_API_KEY) return {
    name: "tavily",
    async run(http, query) {
      const data = await http.json("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.TAVILY_API_KEY}` }, body: JSON.stringify({ query, max_results: MAX_SEARCH_RESULTS }) });
      return (data?.results ?? []).map((result) => ({ url: result.url, title: result.title, published_at: result.published_date ?? null }));
    }
  };
  if (env.SERPER_API_KEY) return {
    name: "serper",
    async run(http, query) {
      const data = await http.json("https://google.serper.dev/search", { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.SERPER_API_KEY }, body: JSON.stringify({ q: query, num: MAX_SEARCH_RESULTS }) });
      return (data?.organic ?? []).map((result) => ({ url: result.link, title: result.title, published_at: result.date ?? null }));
    }
  };
  return null;
}

// ---------------------------------------------------------------------------

export function canonicalUrl(url) {
  return String(url).replace(/^http:/, "https:").replace(/\/raw\/main\/README\.md$/, "").replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
}

function normalise(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}
