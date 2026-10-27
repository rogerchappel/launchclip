// GitHub evidence: fetch a public pull request, commit or file diff from the
// GitHub REST API and map it straight into the code-evidence module params
// (repo-pr-card, commit-card, diff-view, and evidence-chain /
// date-pinned-timeline sources; kit/core/catalog-i-code.mjs), so nothing on
// screen is retyped by hand.
//
// - Unauthenticated by default (60 requests an hour); GITHUB_TOKEN raises the
//   limit when it is set. Every response is cached under
//   <dir>/assets/evidence/github-*.json and reused, so a render never needs
//   the network twice. A rate-limited call fails with the reset time.
// - Avatars are saved to <dir>/assets/evidence/avatars/<login>.<ext> so the
//   cards draw the real face (opts.avatars: false skips them).
//
//   node src/evidence/github.js <url | owner/repo#n | owner/repo@sha>
//     [--module repo-pr-card | commit-card | diff-view | source]
//     [--token gpt-6.1-terra] [--file path] [--lines 8] [--dir .] [--no-avatars]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.github.com";
const CACHE_DIR = path.join("assets", "evidence");

/** "https://github.com/o/r/pull/12", "o/r#12", ".../commit/<sha>", "o/r@<sha>" → {repo, kind, number | sha}. */
export function parseGithubRef(ref) {
  const text = String(ref ?? "").trim();
  let m = /^(?:https?:\/\/)?github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i.exec(text) ?? /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(text);
  if (m) return { repo: m[1], kind: "pull", number: Number(m[2]) };
  m = /^(?:https?:\/\/)?github\.com\/([\w.-]+\/[\w.-]+)\/commit\/([0-9a-f]{7,40})/i.exec(text) ?? /^([\w.-]+\/[\w.-]+)@([0-9a-f]{7,40})$/i.exec(text);
  if (m) return { repo: m[1], kind: "commit", sha: m[2].toLowerCase() };
  throw new Error(`not a GitHub pull request or commit: ${JSON.stringify(text)} (use a github.com URL, owner/repo#123 or owner/repo@sha)`);
}

const cacheName = (...parts) => `github-${parts.join("-").replace(/[^\w.-]+/g, "-")}.json`;

/**
 * GET an API path, cached in <dir>/assets/evidence/<name>. Fresh fetches need
 * opts.fetch (default global fetch); the cache is used when present unless
 * opts.refresh.
 */
export async function githubGet(apiPath, name, opts = {}) {
  const dir = path.resolve(opts.dir ?? ".");
  const file = path.join(dir, CACHE_DIR, name);
  if (!opts.refresh) {
    try {
      return JSON.parse(await readFile(file, "utf8")).data;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const fetcher = opts.fetch ?? globalThis.fetch;
  const token = opts.githubToken ?? process.env.GITHUB_TOKEN;
  const response = await fetcher(`${API}${apiPath}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "launchclip-evidence", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) }
  });
  const remaining = response.headers?.get?.("x-ratelimit-remaining");
  const reset = Number(response.headers?.get?.("x-ratelimit-reset"));
  if ((response.status === 403 || response.status === 429) && remaining === "0") {
    const when = Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : "within the hour";
    throw new Error(`GitHub API rate limit reached (${token ? "token" : "60 an hour unauthenticated"}); it resets at ${when}. Cached evidence under ${CACHE_DIR}/ is reused; set GITHUB_TOKEN to raise the limit.`);
  }
  if (!response.ok) throw new Error(`GitHub API ${apiPath} → ${response.status} ${response.statusText ?? ""}`.trim());
  if (remaining !== null && remaining !== undefined && Number(remaining) < 5) opts.onWarn?.(`GitHub API: ${remaining} requests left before the rate limit resets`);
  const data = await response.json();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ url: `${API}${apiPath}`, fetchedAt: new Date().toISOString(), data }, null, 2)}\n`);
  return data;
}

export async function fetchPull(repo, number, opts = {}) {
  const pull = await githubGet(`/repos/${repo}/pulls/${number}`, cacheName(repo, "pull", number), opts);
  const files = await githubGet(`/repos/${repo}/pulls/${number}/files?per_page=100`, cacheName(repo, "pull", number, "files"), opts);
  return { pull, files };
}

export async function fetchCommit(repo, sha, opts = {}) {
  return githubGet(`/repos/${repo}/commits/${sha}`, cacheName(repo, "commit", sha.slice(0, 12)), opts);
}

/** Save an avatar under assets/evidence/avatars/ → its assets/ path (null on failure or when disabled). */
export async function saveAvatar(login, url, opts = {}) {
  if (opts.avatars === false || !login || !url) return null;
  const dir = path.resolve(opts.dir ?? ".");
  const safe = login.replace(/[^\w.-]+/g, "-");
  for (const ext of ["png", "jpg"]) {
    const rel = `${CACHE_DIR}/avatars/${safe}.${ext}`;
    try { await readFile(path.join(dir, rel)); return rel; } catch { /* not cached */ }
  }
  try {
    const response = await (opts.fetch ?? globalThis.fetch)(`${url}${url.includes("?") ? "&" : "?"}s=120`, { headers: { "user-agent": "launchclip-evidence" } });
    if (!response.ok) return null;
    const ext = /jpe?g/.test(response.headers?.get?.("content-type") ?? "") ? "jpg" : "png";
    const rel = `${CACHE_DIR}/avatars/${safe}.${ext}`;
    await mkdir(path.join(dir, CACHE_DIR, "avatars"), { recursive: true });
    await writeFile(path.join(dir, rel), Buffer.from(await response.arrayBuffer()));
    return rel;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mapping

const isoDay = value => (value ? String(value).slice(0, 10) : undefined);
const clean = (text, max) => {
  const flat = String(text ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const login = value => clean(value, 39).replace(/\s+/g, "-") || "unknown";

/** A unified patch → rows {type, old, new, raw}. */
export function patchRows(patch) {
  const rows = [];
  let old = 0, neu = 0;
  for (const line of String(patch ?? "").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { old = Number(hunk[1]); neu = Number(hunk[2]); rows.push({ type: "hunk", raw: line, old: null, new: null }); continue; }
    if (line.startsWith("\\")) continue;
    const raw = line.length > 400 ? line.slice(0, 400) : line;
    if (line[0] === "+") rows.push({ type: "add", raw, old: null, new: neu++ });
    else if (line[0] === "-") rows.push({ type: "del", raw, old: old++, new: null });
    else if (rows.length) rows.push({ type: "ctx", raw: raw.startsWith(" ") ? raw : ` ${raw}`, old: old++, new: neu++ });
  }
  return rows;
}

/**
 * A window of at most `max` rows of one hunk round the anchor: the first
 * added row with `token`, else any row with it, else the first change.
 * → {lines: ["+…", "-…", " …"], start: {old, new}, anchor} or null.
 */
export function patchExcerpt(patch, { token = null, max = 8, before = 2 } = {}) {
  const rows = patchRows(patch);
  const has = row => token && row.type !== "hunk" && row.raw.slice(1).includes(token);
  let anchor = rows.findIndex(row => row.type === "add" && has(row));
  if (anchor < 0) anchor = rows.findIndex(has);
  if (anchor < 0 && token) return null;
  if (anchor < 0) anchor = rows.findIndex(row => row.type === "add" || row.type === "del");
  if (anchor < 0) return null;
  let from = anchor, to = anchor;
  while (from > 0 && rows[from - 1].type !== "hunk") from--;
  while (to < rows.length - 1 && rows[to + 1].type !== "hunk") to++;
  // The removed row just above an added anchor stays in view.
  let lead = before;
  for (let k = anchor - 1; k >= from && rows[k].type === "del"; k--) lead = Math.max(lead, anchor - k + 1);
  const start = Math.max(from, Math.min(anchor - lead, to - max + 1));
  const window = rows.slice(start, Math.min(to + 1, start + max));
  const first = window[0];
  const startOld = first.old ?? (rows.slice(start).find(row => row.old !== null)?.old ?? 1);
  const startNew = first.new ?? (rows.slice(start).find(row => row.new !== null)?.new ?? 1);
  return { lines: window.map(row => row.raw), start: { old: startOld, new: startNew }, anchor: anchor - start };
}

/** The file to show: opts.file, else the first whose patch has the token, else the first with a patch. */
function pickFile(files, { file, token } = {}) {
  const list = (files ?? []).filter(entry => entry.patch);
  if (file) {
    const found = list.find(entry => entry.filename === file) ?? (files ?? []).find(entry => entry.filename === file);
    if (!found) throw new Error(`no file ${JSON.stringify(file)} in this change (${list.map(entry => entry.filename).join(", ")})`);
    if (!found.patch) throw new Error(`${file} has no text patch (binary or too large)`);
    return found;
  }
  const hit = token ? list.find(entry => entry.patch.includes(token)) : null;
  if (token && !hit) throw new Error(`no file in this change contains ${JSON.stringify(token)}`);
  if (!list.length) throw new Error("this change has no text patch to show");
  return hit ?? list[0];
}

function diffFields(files, opts) {
  const entry = pickFile(files, opts);
  const excerpt = patchExcerpt(entry.patch, { token: opts.token, max: opts.lines ?? 8 });
  return {
    file: entry.filename, additions: entry.additions, deletions: entry.deletions,
    lines: excerpt.lines, startLine: excerpt.start, ...(opts.token ? { highlight: opts.token } : {})
  };
}

const prState = pull => (pull.merged_at ? "merged" : pull.state === "closed" ? "closed" : pull.draft ? "draft" : "open");

/** {pull, files} → repo-pr-card params. */
export function prCardParams({ pull, files }, opts = {}) {
  const repo = pull.base?.repo?.full_name ?? opts.repo;
  return {
    repo, number: pull.number, title: clean(pull.title, 140), state: prState(pull),
    author: opts.avatar ? { login: login(pull.user?.login), avatar: opts.avatar } : login(pull.user?.login),
    date: isoDay(pull.merged_at ?? pull.closed_at ?? pull.created_at),
    ...diffFields(files, opts)
  };
}

/** Co-authors named in Co-authored-by trailers (names, deduplicated). */
function coAuthors(message) {
  const names = [];
  for (const m of String(message ?? "").matchAll(/^co-authored-by:\s*([^<\n]+?)\s*</gim)) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}

/** commit JSON → commit-card params. */
export function commitCardParams(commit, opts = {}) {
  const full = commit.commit?.message ?? "";
  let message = full.split("\n")[0];
  const pr = / \(#(\d+)\)$/.exec(message);
  if (pr) message = message.slice(0, pr.index);
  const first = commit.author?.login ? login(commit.author.login) : login(commit.commit?.author?.name);
  const authors = [opts.avatar ? { login: first, avatar: opts.avatar } : first];
  for (const name of coAuthors(full)) if (authors.length < 3 && name !== first) authors.push(clean(name, 39));
  const repo = opts.repo ?? /repos\/([^/]+\/[^/]+)\/commits/.exec(commit.url ?? "")?.[1];
  return {
    repo, sha: commit.sha.slice(0, 12), verified: Boolean(commit.commit?.verification?.verified),
    authors, message: clean(message, 140), ...(pr ? { number: Number(pr[1]) } : {}),
    date: isoDay(commit.commit?.author?.date ?? commit.commit?.committer?.date),
    ...diffFields(commit.files, opts)
  };
}

/** A file's diff → diff-view params (focus on the anchor row and the rows round it). */
export function diffViewParams(files, opts = {}) {
  const fields = diffFields(files, { ...opts, lines: opts.lines ?? 10 });
  const rows = fields.lines.map(line => line[0]);
  const change = rows.findIndex(type => type === "+" || type === "-");
  const added = rows.findIndex(type => type === "+");
  const focus = [];
  if (change >= 0) focus.push({ rows: [change, Math.max(change, added >= 0 ? added : change)] });
  if (added >= 0 && added !== change) focus.push({ row: added });
  if (!focus.length) focus.push({ row: 0 });
  return { file: fields.file, additions: fields.additions, deletions: fields.deletions, lines: fields.lines, startLine: fields.startLine, focus, ...(fields.highlight ? { highlight: fields.highlight } : {}) };
}

/** Card params → a compact evidence-chain / date-pinned-timeline source (kind pr or commit, ≤ 6 lines). */
export function sourceParams(kind, params, { lines = 4 } = {}) {
  const pick = (keys) => Object.fromEntries(keys.filter(key => params[key] !== undefined).map(key => [key, params[key]]));
  const out = kind === "pr"
    ? { kind: "pr", ...pick(["repo", "number", "state", "author", "date", "file", "additions", "deletions", "highlight"]) }
    : { kind: "commit", ...pick(["repo", "sha", "verified", "authors", "date", "file", "additions", "deletions", "highlight"]) };
  // Keep the rows round the token (or the first change) within `lines`.
  const anchorAt = params.highlight ? params.lines.findIndex(line => line[0] === "+" && line.includes(params.highlight)) : params.lines.findIndex(line => line[0] === "+" || line[0] === "-");
  const from = Math.max(0, Math.min(Math.max(0, anchorAt - Math.min(2, lines - 1)), params.lines.length - lines));
  const kept = params.lines.slice(from, from + lines);
  let old = params.startLine.old, neu = params.startLine.new;
  for (const line of params.lines.slice(0, from)) { if (line[0] !== "+") old++; if (line[0] !== "-") neu++; }
  return { ...out, lines: kept, startLine: { old, new: neu } };
}

/**
 * One reference → {module, params}: a PR as repo-pr-card, a commit as
 * commit-card, or either as diff-view / source (opts.module).
 */
export async function githubEvidence(ref, opts = {}) {
  const target = parseGithubRef(ref);
  const module = opts.module ?? (target.kind === "pull" ? "repo-pr-card" : "commit-card");
  if (target.kind === "pull") {
    const data = await fetchPull(target.repo, target.number, opts);
    const avatar = await saveAvatar(data.pull.user?.login, data.pull.user?.avatar_url, opts);
    if (module === "diff-view") return { module, params: diffViewParams(data.files, opts) };
    const params = prCardParams(data, { ...opts, repo: target.repo, avatar });
    return module === "source" ? { module, params: sourceParams("pr", params, opts) } : { module: "repo-pr-card", params };
  }
  const commit = await fetchCommit(target.repo, target.sha, opts);
  const avatar = await saveAvatar(commit.author?.login, commit.author?.avatar_url, opts);
  if (module === "diff-view") return { module, params: diffViewParams(commit.files, opts) };
  const params = commitCardParams(commit, { ...opts, repo: target.repo, avatar });
  return module === "source" ? { module, params: sourceParams("commit", params, opts) } : { module: "commit-card", params };
}

async function main(argv) {
  const opts = { dir: "." };
  let ref = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--module") opts.module = argv[++i];
    else if (arg === "--token") opts.token = argv[++i];
    else if (arg === "--file") opts.file = argv[++i];
    else if (arg === "--lines") opts.lines = Number(argv[++i]);
    else if (arg === "--dir") opts.dir = argv[++i];
    else if (arg === "--no-avatars") opts.avatars = false;
    else if (arg === "--refresh") opts.refresh = true;
    else if (!ref) ref = arg;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!ref) throw new Error("usage: node src/evidence/github.js <url | owner/repo#n | owner/repo@sha> [--module repo-pr-card|commit-card|diff-view|source] [--token text] [--file path] [--lines n] [--dir .] [--no-avatars] [--refresh]");
  opts.onWarn = message => process.stderr.write(`${message}\n`);
  process.stdout.write(`${JSON.stringify(await githubEvidence(ref, opts), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exit(1); });
}
