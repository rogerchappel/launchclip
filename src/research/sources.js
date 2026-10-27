// Source finding: primary sources first (model cards, repos, releases, PRs,
// commits, papers, official pages), then secondary ones from a configured web
// search. The public GitHub, Hugging Face and arXiv APIs are called directly;
// web search is pluggable (Brave, Tavily or Serper, whichever key is set) and
// simply absent without a key.
//
// Each finder returns snapshots ({url, title, publisher, published_at,
// fetched_at, sha256, text}) tagged with {finder, kind, primary}. verify.js
// decides which of them support which claim.
import { safeHost } from "./http.js";

// Hosts whose pages are the party's own words about its own work.
const PRIMARY_HOSTS = ["github.com", "huggingface.co", "arxiv.org", "openreview.net", "proceedings.neurips.cc", "aclanthology.org"];
const MAX_SEARCH_RESULTS = 5;

/**
 * entities (claims.js entityIndex) + options → snapshots.
 * options: {topic, urls (seen in the script), searches (claim search hints), maxPerEntity, env}
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

  // Links the script names are checked first: they are what the writer relied on.
  for (const url of options.urls ?? []) {
    for (const snapshot of await snapshotUrl(http, url)) keep(snapshot, { finder: "script-link", ...classifyUrl(snapshot.url ?? url, orgs) });
  }
  // Hugging Face: a named repo id, else a search on each model name.
  const hfIds = new Set(repos);
  for (const model of models.slice(0, options.maxModels ?? 6)) {
    for (const id of await searchHuggingFace(http, model, orgs)) hfIds.add(id);
  }
  for (const id of hfIds) {
    for (const snapshot of await huggingFaceModel(http, id)) keep(snapshot, { finder: "huggingface", kind: "model-card", primary: true });
  }
  // GitHub: the same ids as repos, plus a repository search on model names.
  const ghRepos = new Set(repos);
  for (const model of models.slice(0, options.maxModels ?? 6)) {
    for (const full of await searchGithub(http, model, orgs)) ghRepos.add(full);
  }
  for (const full of ghRepos) {
    for (const snapshot of await githubRepository(http, full)) keep(snapshot, { finder: "github", kind: snapshot.kind ?? "repo", primary: true });
  }
  // arXiv: named papers, then a title search on model names.
  const arxivIds = new Set(papers);
  for (const model of models.slice(0, 3)) for (const id of await searchArxiv(http, model)) arxivIds.add(id);
  for (const id of arxivIds) {
    const snapshot = await arxivPaper(http, id);
    if (snapshot) keep(snapshot, { finder: "arxiv", kind: "article", primary: true });
  }
  // Web search, when a key is configured: one query per claim hint, else per model or the topic.
  const search = webSearchProvider(env);
  if (search) {
    const queries = unique([...(options.searches ?? []), ...models.slice(0, 4).map((model) => `${model} announcement`), ...(options.topic && !models.length ? [options.topic] : [])]).slice(0, options.maxSearches ?? 12);
    for (const query of queries) {
      for (const result of await search.run(http, query)) {
        const tags = classifyUrl(result.url, orgs);
        if (/youtube\.com|youtu\.be/.test(result.url)) continue;
        const snapshot = await http.snapshot(result.url, { title: result.title, published_at: result.published_at ?? undefined });
        if (snapshot) keep(snapshot, { finder: `search:${search.name}`, query, ...tags });
      }
    }
  }
  return { sources: found, search: search?.name ?? null };
}

/** github.com/o/r/pull/N → pr, …/commit/sha → commit, huggingface.co/o/m → model-card, and whether the host is primary. */
export function classifyUrl(url, orgs = []) {
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
  else if (/(^|\.)(x\.com|twitter\.com|bsky\.app|threads\.net|mastodon\.social)$/.test(host)) kind = "post";
  else if (/arxiv\.org|openreview\.net|news|blog|techcrunch|theverge|wired|reuters|bloomberg/.test(host + pathname)) kind = "article";
  // "Nimbus AI" owns nimbus.ai and nimbusai.com: the org's name without its suffix word.
  const orgWords = orgs.flatMap((org) => [org, org.replace(/\b(?:AI|Labs?|Inc|Corp|Research|Technologies|Systems|Group)\b/gi, "")]).map((org) => org.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((word) => word.length >= 3);
  const hostWord = host.replace(/^www\./, "").split(".").slice(0, -1).join("");
  // The org's own domain: nimbus.ai for "Nimbus AI", but not openrouter.ai for "OpenAI" (a stripped name must keep five letters).
  const official = orgWords.some((word) => hostWord === word || (word.length >= 5 && hostWord.startsWith(word)));
  const primary = PRIMARY_HOSTS.some((primaryHost) => host === primaryHost || host.endsWith(`.${primaryHost}`)) || official;
  return { kind, primary };
}

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
