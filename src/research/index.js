// launchclip research <topic|script.md> --out research/: the evidence and
// asset gathering stage (docs/RESEARCH.md).
//
//   claims (patterns + optional model/agent claims) → sources (HF, GitHub,
//   arXiv, script links, optional web search) → verify (ledger) → captures
//   → data (tables) → media (metaphor beats) → people → files + RESEARCH.md
//
// No model is needed: the metered make pipeline may add a model claim pass,
// and the subscription agent may hand in its own claims.json, but the stage
// itself is deterministic over what the public APIs return. Every verdict
// points at a hashed snapshot, so a reviewer can see what was read.
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { entityIndex, extractClaims, mergeClaims, modelClaims, splitSentences } from "./claims.js";
import { createHttp } from "./http.js";
import { findSources } from "./sources.js";
import { buildLedger, keywordsFor, numberAppears, passagesOf } from "./verify.js";
import { buildCaptureRequests } from "./capture.js";
import { extractData } from "./data.js";
import { findMedia, metaphorQueries } from "./media.js";
import { findPeople } from "./people.js";
import { attachEvidenceData } from "./evidence_data.js";
import { ASSETS_SCHEMA, RESEARCH_PATHS, validateAssets, validateCapture, validateLedger } from "./schema.js";

export { RESEARCH_PATHS } from "./schema.js";

/**
 * input: a topic string, or a path to a script or outline (.md/.txt).
 * options: {out, cwd, urls[], claims (claims.json path or array), media (queries[] | "none"),
 *   people ("none" to skip), maxCaptures, maxTables, theme, now}
 * adapters: {fetch, env, client ({client}: a make model for the claim pass), log}
 * → the report (also what the CLI prints)
 */
export async function runResearch(input, options = {}, adapters = {}) {
  const env = adapters.env ?? process.env;
  const log = adapters.log ?? (() => {});
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const now = options.now ?? new Date().toISOString();
  const source = await readInput(input, cwd);
  const outDir = path.resolve(cwd, String(options.out ?? RESEARCH_PATHS.dir));
  await mkdir(outDir, { recursive: true });
  const http = createHttp({ fetch: adapters.fetch, env, log, now: () => options.now ?? new Date().toISOString(), snapshotDir: path.join(outDir, RESEARCH_PATHS.snapshots) });

  // 1. Claims: the patterns, then the agent's claims.json, then the model pass.
  let claims = extractClaims(source.text);
  const extra = await readClaims(options.claims, cwd);
  if (extra.length) claims = mergeClaims(claims, extra);
  let usage = null;
  if (adapters.client?.client) {
    const result = await modelClaims({ client: adapters.client.client, text: source.text });
    claims = mergeClaims(claims, result.claims);
    usage = result.usage;
  }
  // A bare topic has no sentences to check, but its names still find sources.
  const seedEntities = source.kind === "topic" ? extractClaims(`${source.text}.`)[0]?.entities ?? [] : [];
  const entities = mergeEntities(entityIndex(claims), seedEntities);
  log(`research: ${claims.length} claim(s), ${entities.length} entit${entities.length === 1 ? "y" : "ies"}`);

  // 2. Sources.
  const urls = [...new Set([...toList(options.urls), ...entities.filter((entity) => entity.kind === "url").map((entity) => entity.name)])];
  const searches = claims.map((claim) => claim.search).filter(Boolean);
  const { sources: snapshots, search } = await findSources(http, entities, { topic: source.kind === "topic" ? source.text : null, urls, searches, env });
  log(`research: ${snapshots.length} source(s) fetched (${snapshots.filter((entry) => entry.primary).length} primary)`);

  // 3. Ledger.
  let ledger = buildLedger({ claims, snapshots, entities, now, search, input: { kind: source.kind, ...(source.file ? { file: path.relative(cwd, source.file) } : { topic: source.text }) } });
  // What the primary sources state, for a script pass to write from and the audit to check against.
  ledger.excerpts = keyExcerpts(snapshots);

  // 4. Captures, 5. data.
  let { requests, byClaim } = buildCaptureRequests(ledger, { maxCaptures: options.maxCaptures, theme: options.theme });
  const subject = entities.find((entity) => entity.kind === "model" || entity.kind === "repo")?.name?.split("/").pop() ?? null;
  const data = extractData(snapshots, ledger, { subject, maxTables: options.maxTables });
  for (const claim of ledger.claims) {
    if (byClaim[claim.id]) claim.capture = byClaim[claim.id];
    const tables = data.filter((file) => file.claims.includes(claim.id)).map((file) => file.id);
    if (tables.length) claim.tables = tables;
  }

  // 6. Media, 7. people.
  const sentences = splitSentences(source.text);
  const mediaOff = toList(options.media).includes("none");
  const queries = mediaOff ? [] : metaphorQueries(sentences, claims, { queries: toList(options.media), max: options.maxMediaQueries });
  const media = queries.length ? await findMedia(http, queries, { env, now }) : { assets: [], rejected: [], providers: [] };
  const peopleOff = String(options.people ?? "") === "none";
  const { people, portraits } = peopleOff ? { people: [], portraits: [] } : await findPeople(http, entities, claims, { now });
  const assets = {
    schema: ASSETS_SCHEMA,
    created_at: now,
    policy: {
      licences: "public domain, CC0, CC BY, CC BY-SA, Pexels and Pixabay licences, NASA media; NC, ND, fair use and unlabelled items are dropped",
      never: "YouTube, streaming services, film or TV releases, or a photo scraped from a page",
      icons_logos_audio: "resolve through the media-use skill, not here"
    },
    providers: media.providers,
    queries,
    assets: [...media.assets, ...portraits],
    people,
    rejected: media.rejected.length
  };

  // Contracts before anything is written.
  const problems = [...validateLedger(ledger), ...requests.flatMap(validateCapture), ...validateAssets(assets)];
  if (problems.length) throw new Error(`research contract failed: ${problems.join("; ")}`);

  // Module-ready data for the evidence builders (src/research/evidence_data.js); post captures get theirs once captured (research attach).
  const attached = await attachEvidenceData({ ledger, captures: requests, tables: data, assets }, { root: path.dirname(outDir) }, { fetch: adapters.fetch, tokenize: adapters.tokenize, tex: adapters.tex });
  ledger = attached.ledger;
  requests = attached.captures;

  await writeJson(path.join(outDir, RESEARCH_PATHS.ledger), ledger);
  await rm(path.join(outDir, RESEARCH_PATHS.captures), { recursive: true, force: true });
  for (const request of requests) await writeJson(path.join(outDir, RESEARCH_PATHS.captures, `${request.id}.json`), request);
  await rm(path.join(outDir, RESEARCH_PATHS.data), { recursive: true, force: true });
  for (const file of data) await writeJson(path.join(outDir, RESEARCH_PATHS.data, `${file.id}.json`), file);
  await writeJson(path.join(outDir, RESEARCH_PATHS.assets), assets);
  await writeFile(path.join(outDir, RESEARCH_PATHS.digest), renderDigest({ ledger, requests, data, assets }));

  const flagged = ledger.claims.filter((claim) => claim.status !== "verified");
  return {
    stage: "research",
    status: flagged.length ? "flagged" : "verified",
    out: outDir,
    files: {
      ledger: path.join(outDir, RESEARCH_PATHS.ledger),
      digest: path.join(outDir, RESEARCH_PATHS.digest),
      captures: requests.map((request) => path.join(outDir, RESEARCH_PATHS.captures, `${request.id}.json`)),
      data: data.map((file) => path.join(outDir, RESEARCH_PATHS.data, `${file.id}.json`)),
      assets: path.join(outDir, RESEARCH_PATHS.assets)
    },
    summary: { ...ledger.summary, captures: requests.length, tables: data.length, assets: media.assets.length, people: people.length, portraits: portraits.length },
    flagged: flagged.map((claim) => ({ id: claim.id, status: claim.status, text: claim.text, action: claim.flag?.action, message: claim.flag?.message })),
    requests: http.calls.length,
    evidence_data: attached.report,
    ...(usage ? { usage } : {})
  };
}

/**
 * Lines for a script pass: what the sources state (with ids to cite) and
 * which brief claims to cut or soften. The writer may only state facts from
 * the first two lists.
 */
export function researchNotes(ledger, snapshotsOrNull = null, options = {}) {
  const lines = ["## Research (launchclip research; state only facts listed here)"];
  const verified = ledger.claims.filter((claim) => claim.status === "verified");
  if (verified.length) {
    lines.push("", "Verified claims:");
    for (const claim of verified) lines.push(`- [${claim.id}] ${claim.text} (source: ${claim.sources[0]?.publisher ?? claim.sources[0]?.url})`);
  }
  const excerpts = ledger.excerpts ?? (snapshotsOrNull ? keyExcerpts(snapshotsOrNull, options) : []);
  if (excerpts.length) {
    lines.push("", "Facts from primary sources:");
    for (const excerpt of excerpts) lines.push(`- ${excerpt.text} (source: ${excerpt.publisher ?? excerpt.url})`);
  }
  const flagged = ledger.claims.filter((claim) => claim.status !== "verified");
  if (flagged.length) {
    lines.push("", "Do not state these as fact (cut, soften or attribute):");
    for (const claim of flagged) lines.push(`- [${claim.status}] ${claim.text}: ${claim.flag?.message ?? ""}`);
  }
  return lines.join("\n");
}

/** Sentences and table rows with numbers from primary sources: the facts a writer can lean on. */
export function keyExcerpts(snapshots, options = {}) {
  const max = Number(options.maxExcerpts ?? 24);
  const out = [];
  for (const snapshot of snapshots.filter((entry) => entry.primary)) {
    let taken = 0;
    for (const passage of passagesOf(snapshot.text)) {
      if (taken >= 8 || out.length >= max) break;
      const text = passage.text.replace(/\s+/g, " ").trim();
      if (text.length < 24 || text.length > 260 || !/\d/.test(text) || /^\s*[<!\[]|https?:\/\/\S+$/.test(text) || /img\.shields|badge/i.test(text)) continue;
      out.push({ text, url: snapshot.url, publisher: snapshot.publisher ?? null });
      taken += 1;
    }
  }
  return out;
}

/**
 * The final narration against the ledger: each of its claims must match a
 * verified ledger claim (its numbers and most of its words) or a primary
 * source excerpt. → {ok, claims: [{text, status, match?}]}
 */
export function auditScript(narration, ledger, excerpts = ledger.excerpts ?? []) {
  const claims = extractClaims(narration);
  const verified = ledger.claims.filter((claim) => claim.status === "verified");
  const results = claims.map((claim) => {
    const words = keywordsFor(claim);
    const overlap = (text) => words.length ? words.filter((word) => text.toLowerCase().includes(word)).length / words.length : 0;
    const numbersIn = (text) => (claim.values ?? []).every((value) => numberAppears(text, value));
    const ledgerMatch = verified.find((entry) => numbersIn(entry.text) && overlap(entry.text) >= 0.4);
    if (ledgerMatch) return { text: claim.text, status: "verified", match: ledgerMatch.id };
    const excerpt = excerpts.find((entry) => (claim.values?.length ? numbersIn(entry.text) : true) && overlap(entry.text) >= (claim.values?.length ? 0.2 : 0.5));
    if (excerpt) return { text: claim.text, status: "sourced", match: excerpt.url };
    const contradicted = ledger.claims.find((entry) => entry.status === "contradicted" && overlap(entry.text) >= 0.6);
    return { text: claim.text, status: contradicted ? "contradicted" : "unverified", ...(contradicted ? { match: contradicted.id } : {}) };
  });
  return { ok: results.every((entry) => entry.status === "verified" || entry.status === "sourced"), claims: results };
}

export function renderDigest({ ledger, requests, data, assets }) {
  const lines = [`# Research`, "", `${ledger.summary.claims} claims: ${ledger.summary.verified} verified, ${ledger.summary.contradicted} contradicted, ${ledger.summary.unverified} unverified. ${ledger.summary.sources_checked} sources checked (${ledger.summary.primary_sources} primary)${ledger.summary.web_search ? `, web search: ${ledger.summary.web_search}` : ", no web search key set"}.`, ""];
  const flagged = ledger.claims.filter((claim) => claim.status !== "verified");
  if (flagged.length) {
    lines.push("## Flagged for the script", "", "Cut, soften or source these before the script is final.", "");
    for (const claim of flagged) lines.push(`- **${claim.status}** [${claim.id}] ${claim.text}  `, `  ${claim.flag?.message ?? ""}`);
    lines.push("");
  }
  lines.push("## Verified", "");
  for (const claim of ledger.claims.filter((entry) => entry.status === "verified")) {
    const best = claim.sources[0];
    lines.push(`- [${claim.id}] ${claim.text}  `, `  ${best.primary ? "primary" : "secondary"}: [${best.title}](${best.url}), confidence ${claim.confidence}: “${truncate(best.quote?.text ?? "", 160)}”${claim.capture ? ` → capture \`${claim.capture}\`` : ""}`);
  }
  lines.push("", "## Captures", "");
  for (const request of requests) lines.push(`- \`${request.id}\` ${request.kind}: ${request.url} (${request.beats.length} beats)`);
  if (!requests.length) lines.push("None: no verified claim has a source to show.");
  lines.push("", "## Data", "");
  for (const file of data) lines.push(`- \`data/${file.id}.json\` ${file.kind}: ${file.title} (${file.rows.length} rows, ${file.views.length} chart views) from ${file.source.publisher ?? file.source.url}`);
  if (!data.length) lines.push("None.");
  lines.push("", "## Assets", "");
  for (const asset of assets.assets) lines.push(`- \`${asset.id}\` ${asset.type ?? asset.role}, ${asset.licence.name}: ${asset.attribution} <${asset.source_url}>`);
  if (!assets.assets.length) lines.push("None.");
  if (assets.people.length) {
    lines.push("", "## People", "");
    for (const person of assets.people) lines.push(`- ${person.name}: ${[person.role, person.affiliation].filter(Boolean).join(", ") || "role unknown"}${person.wikidata ? ` ([${person.wikidata.id}](${person.wikidata.url}))` : ""}; ${person.portrait ? `portrait \`${person.portrait}\`` : person.portrait_note}`);
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------

async function readInput(input, cwd) {
  const value = String(input ?? "").trim();
  if (!value) throw new Error("launchclip research needs a topic or a script file: launchclip research \"<topic>\" | script.md [--out research]");
  const file = path.resolve(cwd, value);
  if (/\.(?:md|markdown|txt)$/i.test(value) || (value.length < 260 && !/\s/.test(value) && existsSync(file))) {
    if (!existsSync(file)) throw new Error(`no such script: ${value}`);
    return { kind: "script", file, text: await readFile(file, "utf8") };
  }
  return { kind: "topic", text: value };
}

async function readClaims(value, cwd) {
  if (!value) return [];
  if (Array.isArray(value) && typeof value[0] === "object") return value;
  const file = path.resolve(cwd, String(Array.isArray(value) ? value[0] : value));
  const parsed = JSON.parse(await readFile(file, "utf8"));
  return (Array.isArray(parsed) ? parsed : parsed.claims ?? []).map((claim) => ({ ...claim, origin: claim.origin ?? "agent" }));
}

function mergeEntities(index, seeds) {
  const out = [...index];
  for (const seed of seeds) if (!out.some((entity) => entity.name === seed.name)) out.push({ ...seed, claims: [] });
  return out;
}

function toList(value) {
  if (value == null || value === true) return [];
  return [value].flat().map(String).filter(Boolean);
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function truncate(text, max) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
