// Evidence data: the module-ready `data` the beat director hands the evidence
// builders (kit/core/capability-builders-*.mjs, whose headers are the
// contract). matchEvidence() passes capture.data, else claim.data, through
// as beat.evidence.data, so this stage writes:
//
//   capture.data   pr | commit | diff: {module, params} from src/evidence/github.js (its cached API JSON)
//                  post: the post fields read from the capture's sidecar (*.evidence.json)
//   claim.data     series:   {series, panels, source} from research/data/*.json (the table the claim quotes)
//                  people:   {people: [{name, role?, photo?, links?}]}, photo only when the portrait is licence-clear
//                  tokens:   {text, tokens, encoding} for a quoted sentence (src/tokenizer.js)
//                  equation: {tex, svg?} for TeX in the claim (svg when mathjax-full is installed)
//                  chain:    {sources: [{module, params, token}]} when two or more GitHub sources back the claim
//
// Nothing is invented: a field is set only from a fetched or captured source,
// and anything that cannot be built is listed in the report with its reason.
// Only verified claims (and captures of them) get data.
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { githubEvidence, parseGithubRef, sourceParams } from "../evidence/github.js";
import { RESEARCH_PATHS } from "./schema.js";

const GITHUB_MODULE = { pr: "repo-pr-card", commit: "commit-card", diff: "diff-view" };
const POST_HOSTS = { "x.com": "x", "twitter.com": "x", "bsky.app": "bluesky", "threads.net": "threads", "www.threads.net": "threads", "mastodon.social": "mastodon", "www.linkedin.com": "linkedin", "linkedin.com": "linkedin" };
const MAX_TOKEN_TEXT = 160;

/**
 * Reads a research folder (evidence.json, captures/, data/, assets.json) and
 * returns {ledger, captures} with data attached, plus the report.
 * options: {root (where `launchclip evidence capture` wrote assets/evidence/; default the research dir's parent)}
 * adapters: {fetch (GitHub, when a response is not cached), tokenize(text) → {text, tokens, encoding}, tex(tex) → svg}
 */
export async function loadResearchEvidence(researchDir, options = {}, adapters = {}) {
  const dir = path.resolve(researchDir);
  const ledgerFile = path.join(dir, RESEARCH_PATHS.ledger);
  if (!existsSync(ledgerFile)) return { ledger: null, captures: [], report: [] };
  const ledger = await readJson(ledgerFile);
  const captures = await readJsonDir(path.join(dir, RESEARCH_PATHS.captures));
  const tables = await readJsonDir(path.join(dir, RESEARCH_PATHS.data));
  const assetsFile = path.join(dir, RESEARCH_PATHS.assets);
  const assets = existsSync(assetsFile) ? await readJson(assetsFile) : null;
  const root = path.resolve(options.root ?? path.dirname(dir));
  return attachEvidenceData({ ledger, captures, tables, assets }, { root }, adapters);
}

/** The pure core: {ledger, captures, tables, assets} → {ledger, captures, report} with data attached (inputs are not mutated). */
export async function attachEvidenceData({ ledger, captures = [], tables = [], assets = null }, options = {}, adapters = {}) {
  const root = path.resolve(options.root ?? ".");
  const report = [];
  const note = (target, kind, status, reason) => report.push({ target, kind, status, ...(reason ? { reason } : {}) });
  const outCaptures = [];
  const githubByUrl = new Map();
  const claimOf = (capture) => ledger?.claims?.find((claim) => claim.capture === capture.id || claim.sources?.some((source) => source.url === capture.url));

  for (const capture of captures) {
    const copy = { ...capture };
    const claim = claimOf(capture);
    if (claim && claim.status !== "verified") { outCaptures.push(copy); continue; }
    if (GITHUB_MODULE[capture.kind]) {
      const result = await githubData(capture.url, { module: GITHUB_MODULE[capture.kind], token: tokenOf(capture), root, fetch: adapters.fetch });
      if (result.data) { copy.data = result.data; githubByUrl.set(capture.url, { ...result.data, token: tokenOf(capture) }); note(capture.id, capture.kind, "attached"); }
      else note(capture.id, capture.kind, "skipped", result.reason);
    } else if (capture.kind === "post") {
      const sidecar = await readSidecar(root, capture);
      const post = sidecar ? postFromSidecar(capture, sidecar, claim) : null;
      if (post) { copy.data = post; note(capture.id, "post", "attached"); }
      else note(capture.id, "post", "skipped", sidecar ? "the sidecar names no author or text" : "no sidecar yet (run launchclip evidence capture)");
    }
    outCaptures.push(copy);
  }

  const outLedger = ledger ? { ...ledger, claims: [] } : null;
  for (const claim of ledger?.claims ?? []) {
    const copy = { ...claim };
    delete copy.data;
    if (claim.status !== "verified") { outLedger.claims.push(copy); continue; }
    const data = {};
    const series = seriesData(claim, tables);
    if (series) { Object.assign(data, series); note(claim.id, "series", "attached"); }
    const people = peopleData(claim, assets);
    if (people) { Object.assign(data, people); note(claim.id, "people", "attached"); }
    if (claim.kind === "quote" && claim.quote) {
      const tokens = await tokenData(claim.quote, adapters.tokenize);
      if (tokens.data) { Object.assign(data, tokens.data); note(claim.id, "tokens", "attached"); }
      else note(claim.id, "tokens", "skipped", tokens.reason);
    }
    const tex = texOf(claim.text);
    if (tex) {
      const equation = await equationData(tex, adapters.tex);
      Object.assign(data, equation.data);
      note(claim.id, "equation", "attached", equation.reason);
    }
    const chain = await chainData(claim, { root, fetch: adapters.fetch, known: githubByUrl });
    if (chain) { Object.assign(data, chain); note(claim.id, "chain", "attached"); }
    if (Object.keys(data).length) copy.data = data;
    outLedger.claims.push(copy);
  }
  return { ledger: outLedger, captures: outCaptures, report };
}

// ---------------------------------------------------------------------------
// Captures

/** A PR, commit or diff URL → {data: {module, params}} from github.js (its cache first), or {reason}. */
export async function githubData(url, { module, token, root, fetch } = {}) {
  let ref;
  try { ref = parseGithubRef(url); } catch { return { reason: `not a GitHub pull request or commit URL: ${url}` }; }
  const wanted = module === "diff-view" ? "diff-view" : ref.kind === "pull" ? "repo-pr-card" : "commit-card";
  const run = (highlight) => githubEvidence(url, { dir: root, module: wanted, ...(highlight ? { token: highlight } : {}), ...(fetch ? { fetch } : {}) });
  try {
    return { data: await run(token) };
  } catch (error) {
    // The capture highlighted text that is not in the patch (a PR title, say): the card without a highlighted token.
    if (token && /contains/.test(String(error?.message))) {
      try { return { data: await run(null) }; } catch (retry) { error = retry; }
    }
    return { reason: String(error?.message ?? error).split("\n")[0] };
  }
}

/** The capture's sidecar (<root>/<out without .mp4>.evidence.json), or null. */
export async function readSidecar(root, capture) {
  const out = capture.out ?? `assets/evidence/${capture.id}.mp4`;
  const file = path.join(root, out.replace(/\.mp4$/, ".evidence.json"));
  return existsSync(file) ? readJson(file) : null;
}

/**
 * A post's fields from what the capture actually recorded: the platform from
 * the final URL's host, the handle from its path, the author and text from
 * the page title X, Bluesky and Threads write ("Name on X: "text" / X"), else
 * the highlighted span. Fields the page did not show are left out.
 */
export function postFromSidecar(capture, sidecar, claim = null) {
  const url = sidecar.final_url ?? sidecar.request_url ?? capture.url;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const platform = POST_HOSTS[parsed.hostname] ?? null;
  if (!platform) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  const handle = platform === "bluesky" ? segments[1] ?? null : segments[0]?.replace(/^@/, "") ?? null;
  const title = String(sidecar.page_title ?? "");
  const titled = title.match(/^(.+?)\s+(?:\(@[\w.]+\)\s+)?on\s+(?:X|Twitter|Bluesky|Threads)\s*:\s*["“](.+)["”]\s*(?:\/\s*\w+)?$/s);
  const span = (sidecar.spans ?? []).map((entry) => entry.text).filter(Boolean).join(" ").trim();
  const text = titled?.[2]?.trim() || span || null;
  const name = titled?.[1]?.trim() || capture.provenance?.publisher || null;
  if (!text || !(name || handle)) return null;
  const published = capture.provenance?.published_at ?? null;
  return {
    platform,
    name: name ?? handle,
    ...(handle ? { handle: `@${handle}` } : {}),
    text,
    ...(published ? { date: String(published).slice(0, 10) } : {}),
    source: { url, ...(sidecar.captured_at ? { captured_at: sidecar.captured_at } : {}), ...(sidecar.poster ? { screenshot: sidecar.poster } : {}) },
    ...(claim ? { claim: claim.id } : {})
  };
}

// ---------------------------------------------------------------------------
// Claims

/**
 * The table the claim quotes → {series (the quoted row, one bar per column),
 * panels (up to six rows), source}. A claim whose quote is not a table row
 * gets no series.
 */
export function seriesData(claim, tables) {
  const ids = claim.tables ?? [];
  const quoted = claim.sources?.find((source) => source.supports && source.quote?.row);
  if (!ids.length || !quoted) return null;
  const table = tables.find((file) => ids.includes(file.id) && file.source?.url === quoted.url) ?? tables.find((file) => ids.includes(file.id));
  if (!table) return null;
  const toSeries = (row) => table.columns.slice(1).map((column) => ({ label: column, value: row.values[column] })).filter((entry) => typeof entry.value === "number");
  const label = String(quoted.quote.row.label).replace(/`/g, "").trim();
  const row = table.rows.find((entry) => entry.label.replace(/`/g, "").trim() === label);
  if (!row) return null;
  const series = toSeries(row);
  if (series.length < 2) return null;
  const panels = table.rows.map((entry) => ({ title: entry.label, series: toSeries(entry) })).filter((panel) => panel.series.length >= 2);
  const ordered = [panels.find((panel) => panel.title === row.label), ...panels.filter((panel) => panel.title !== row.label)].filter(Boolean).slice(0, 6);
  const date = table.source.published_at ? `, ${String(table.source.published_at).slice(0, 10)}` : "";
  return { series, panels: ordered, source: `${table.source.publisher ?? table.source.title}${date}`, table: table.id };
}

/** People the claim names → {people: [{name, role?, photo?, links?}]}; photo only from a licence-clear portrait. */
export function peopleData(claim, assets) {
  const people = (assets?.people ?? []).filter((person) => person.claims?.includes(claim.id));
  if (!people.length) return null;
  return {
    people: people.map((person) => {
      const portrait = person.portrait ? assets.assets?.find((asset) => asset.id === person.portrait) : null;
      const role = [person.role ?? person.role_in_script, person.affiliation].filter(Boolean).join(", ");
      return {
        name: person.name,
        ...(role ? { role } : {}),
        ...(portrait ? { photo: portrait.local ?? portrait.media_url, photo_credit: portrait.attribution } : {}),
        ...(person.wikidata ? { links: [person.wikidata.url] } : {})
      };
    })
  };
}

/** A quoted sentence → {data: {text, tokens, encoding}} or {reason}. */
export async function tokenData(text, tokenize) {
  const quote = String(text).trim();
  if (quote.length > MAX_TOKEN_TEXT) return { reason: `the quote is over ${MAX_TOKEN_TEXT} characters` };
  try {
    if (tokenize) return { data: await tokenize(quote) };
    const { tokenizerParams } = await import("../tokenizer.js");
    return { data: await tokenizerParams(quote) };
  } catch (error) {
    return { reason: String(error?.message ?? error).split(";")[0] };
  }
}

/** "$E = mc^2$" or \( … \) in the text → the TeX, else null. */
export function texOf(text) {
  const match = String(text).match(/\$\$?([^$]{2,200})\$\$?|\\\((.{2,200}?)\\\)/);
  return match ? (match[1] ?? match[2]).trim() : null;
}

/** TeX → {data: {tex, svg?}, reason?}: the SVG kit/core cannot make, precomputed when mathjax-full is installed. */
export async function equationData(tex, render = texToSvg) {
  try {
    const svg = await render(tex);
    return { data: { tex, ...(svg ? { svg } : {}) } };
  } catch (error) {
    return { data: { tex }, reason: `no SVG: ${String(error?.message ?? error).split("\n")[0]}` };
  }
}

export async function texToSvg(tex) {
  let modules;
  try {
    modules = await Promise.all([
      import("mathjax-full/js/mathjax.js"), import("mathjax-full/js/input/tex.js"), import("mathjax-full/js/output/svg.js"),
      import("mathjax-full/js/adaptors/liteAdaptor.js"), import("mathjax-full/js/handlers/html.js"), import("mathjax-full/js/input/tex/AllPackages.js")
    ]);
  } catch {
    throw new Error("mathjax-full is not installed (npm install mathjax-full)");
  }
  const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] = modules;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const document = mathjax.document("", { InputJax: new TeX({ packages: AllPackages }), OutputJax: new SVG({ fontCache: "none" }) });
  return adaptor.innerHTML(document.convert(tex, { display: true }));
}

/** Two or more GitHub sources behind one claim → {sources: [{module, params, token}]} in date order (the leak trail). */
export async function chainData(claim, { root, fetch, known = new Map() } = {}) {
  const urls = [...new Set((claim.sources ?? []).filter((source) => source.supports && /github\.com\/[^/]+\/[^/]+\/(?:pull|commit)\//.test(source.url)).map((source) => source.url))];
  if (urls.length < 2) return null;
  const sources = [];
  for (const url of urls) {
    const card = known.get(url) ?? (await githubData(url, { root, fetch })).data;
    if (!card || card.module === "diff-view") continue;
    const token = known.get(url)?.token ?? null;
    sources.push({ module: card.module, params: sourceParams(card.module === "repo-pr-card" ? "pr" : "commit", card.params), ...(token ? { token } : {}) });
  }
  if (sources.length < 2) return null;
  sources.sort((a, b) => String(a.params.date ?? "").localeCompare(String(b.params.date ?? "")));
  return { sources };
}

// ---------------------------------------------------------------------------

/** The text a capture highlights (its token for a diff or card). */
function tokenOf(capture) {
  const beat = (capture.beats ?? []).find((entry) => entry.action === "highlight" && entry.target?.text);
  return beat?.target.text ?? null;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readJsonDir(dir) {
  if (!existsSync(dir)) return [];
  return Promise.all(readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => readJson(path.join(dir, name))));
}
