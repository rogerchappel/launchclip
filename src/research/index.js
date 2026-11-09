// launchclip research <topic|script.md> --out research/: the evidence and
// asset gathering stage (docs/RESEARCH.md).
//
//   claims (patterns + optional model/agent claims) → sources (HF, GitHub,
//   arXiv, script links, optional web search) → verify (ledger) → captures
//   → official X posts (social.js) → data (tables) → media (metaphor beats)
//   → people → logos → files + RESEARCH.md
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
import { findSources, webSearchProvider } from "./sources.js";
import { buildLedger, keywordsFor, numberAppears, passagesOf } from "./verify.js";
import { buildCaptureRequests } from "./capture.js";
import { extractData } from "./data.js";
import { claimMediaQueries, findMedia, metaphorQueries } from "./media.js";
import { findPeople } from "./people.js";
import { findSocialPosts } from "./social.js";
import { findLogos, logoManifest, writeLogos } from "./logos.js";
import { NEWS_SCHEMA, ageDays, freshDaysOption, freshnessWindow } from "./news.js";
import { attachEvidenceData } from "./evidence_data.js";
import { ASSETS_SCHEMA, RESEARCH_PATHS, SOCIAL_SCHEMA, validateAssets, validateCapture, validateLedger, validateLogos, validateSocial } from "./schema.js";

export { RESEARCH_PATHS } from "./schema.js";

/**
 * input: a topic string, or a path to a script or outline (.md/.txt).
 * options: {out, cwd, urls[], claims (claims.json path or array), media (queries[] | "none"),
 *   people ("none" to skip), social ("none" to skip), handles ({entity: X handle}), maxPosts,
 *   logos ("none" to skip), logoDomains ({name: domain}), logoCache (dir; else LAUNCHCLIP_LOGO_CACHE),
 *   maxLogos, maxCaptures, maxTables, theme, now,
 *   news ("none" to skip the keyless news sources), feeds (RSS or Atom urls), freshDays (a number; null for no
 *   limit; undefined reads the brief: "this week", "latest"), maxNewsLeads, maxStories}
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
  const http = createHttp({ fetch: adapters.fetch, env, log, sleep: adapters.sleep, now: () => options.now ?? new Date().toISOString(), snapshotDir: path.join(outDir, RESEARCH_PATHS.snapshots) });
  // How fresh a source must be: --fresh-days, else what the brief asks for ("this week", "latest"), else no limit.
  const freshDays = freshDaysOption(options.freshDays);
  const asked = freshDays === undefined ? freshnessWindow(source.text) : freshDays == null ? null : { days: freshDays, asked_by: "--fresh-days" };

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
  const { sources: snapshots, search, news } = await findSources(http, entities, { topic: source.kind === "topic" ? source.text : null, text: source.text, urls, searches, env, now, news: String(options.news ?? "") === "none" ? false : undefined, feeds: toList(options.feeds), windowDays: asked?.days ?? null, maxNewsLeads: options.maxNewsLeads });
  log(`research: ${snapshots.length} source(s) fetched (${snapshots.filter((entry) => entry.primary).length} primary)`);
  // 2b. Stories: a topic, or a brief that asks for the latest, states no claims of its own, so each kept
  // story's headline becomes one: checked against its own page like any claim, and shown from it.
  if (source.kind === "topic" || asked) {
    const headlines = storyClaims(news.stories, snapshots, claims, options.maxStories);
    claims = mergeClaims(claims, headlines).map((claim) => headlines.some((entry) => entry.text === claim.text) ? { ...claim, headline: true, origin: "news" } : claim);
    if (headlines.length) log(`research: ${headlines.length} stor${headlines.length === 1 ? "y" : "ies"} from primary sources`);
  }

  // 3. Ledger.
  let ledger = buildLedger({ claims, snapshots, entities, now, search, input: { kind: source.kind, ...(source.file ? { file: path.relative(cwd, source.file) } : { topic: source.text }) } });
  // What the primary sources state, for a script pass to write from and the audit to check against.
  ledger.excerpts = keyExcerpts(snapshots);
  // Every claim carries the date its source was published; one older than the brief asks for is flagged.
  datedClaims(ledger, { now, window: asked });

  // 4. Captures, 5. data.
  let { requests, byClaim } = buildCaptureRequests(ledger, { maxCaptures: options.maxCaptures, theme: options.theme });
  // 4b. The entity's own announcement posts on X: a clip each (x-embed route) and a social-post card.
  const social = String(options.social ?? "") === "none"
    ? { manifest: { schema: SOCIAL_SCHEMA, created_at: now, search: null, posts: [], rejected: [] }, requests: [] }
    : await findSocialPosts(http, ledger, { snapshots, search: webSearchProvider(env), handles: options.handles, maxPosts: options.maxPosts, theme: options.theme, now, existing: requests });
  for (const claim of ledger.claims) {
    const posts = social.manifest.posts.filter((post) => post.claims.includes(claim.id)).map((post) => post.id);
    if (posts.length) claim.posts = posts;
  }
  if (social.manifest.posts.length) log(`research: ${social.manifest.posts.length} official X post(s), ${social.manifest.rejected.length} rejected`);
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
  // Metaphor beats (or --media), then what the verified claims are about: those items carry the claim they support.
  const queries = mediaOff ? [] : [...metaphorQueries(sentences, claims, { queries: toList(options.media), max: options.maxMediaQueries }), ...claimMediaQueries(ledger, { max: options.maxClaimMedia })];
  const media = queries.length ? await findMedia(http, queries, { env, now }) : { assets: [], rejected: [], providers: [] };
  const peopleOff = String(options.people ?? "") === "none";
  const { people, portraits } = peopleOff ? { people: [], portraits: [] } : await findPeople(http, entities, claims, { now });
  // 8. Logos: each organisation named → its official domain → the logo on its own site, else Simple Icons.
  const logosOff = String(options.logos ?? "") === "none";
  const logoResult = logosOff ? { logos: [], missed: [], files: [], cache_hits: 0 } : await findLogos(entities, { cacheDir: options.logoCache, domains: options.logoDomains, max: options.maxLogos, now }, { fetch: adapters.fetch, http, env, log });
  const logos = logoManifest(logoResult, now);
  const assets = {
    schema: ASSETS_SCHEMA,
    created_at: now,
    policy: {
      licences: "public domain, CC0, CC BY, CC BY-SA, Pexels and Pixabay licences, NASA media; NC, ND, fair use and unlabelled items are dropped",
      never: "YouTube, streaming services, film or TV releases, or a photo scraped from a page",
      icons_logos_audio: `logos: ${RESEARCH_PATHS.logos}; icons and audio resolve through the media-use skill, not here`
    },
    providers: media.providers,
    queries: queries.map(({ query, beat, claims: backed }) => ({ query, beat, ...(backed ? { claims: backed } : {}) })),
    assets: [...media.assets, ...portraits],
    people,
    rejected: media.rejected.length
  };

  // Contracts before anything is written.
  const newsManifest = {
    schema: NEWS_SCHEMA,
    created_at: now,
    queries: news.queries,
    freshness: asked ? { days: asked.days, asked_by: asked.asked_by } : null,
    policy: "the sources below are how a story was found, never who said it: a story is kept only when a primary source states it, and no index, feed reader or encyclopedia is named in the narration or on screen",
    providers: news.providers,
    stories: news.stories.map((story) => ({ ...story, claim: ledger.claims.find((claim) => claim.headline && claim.text === story.title && claim.status === "verified")?.id ?? null }))
  };
  const problems = [...validateLedger(ledger), ...requests.flatMap(validateCapture), ...social.requests.flatMap(validateCapture), ...validateSocial(social.manifest), ...validateAssets(assets), ...validateLogos(logos)];
  if (problems.length) throw new Error(`research contract failed: ${problems.join("; ")}`);

  // Module-ready data for the evidence builders (src/research/evidence_data.js); post captures get theirs once captured (research attach).
  const attached = await attachEvidenceData({ ledger, captures: requests, tables: data, assets }, { root: path.dirname(outDir) }, { fetch: adapters.fetch, tokenize: adapters.tokenize, tex: adapters.tex });
  ledger = attached.ledger;
  // Post captures carry their card data already (social.js), so they join after the attach pass.
  requests = [...attached.captures, ...social.requests];

  await writeJson(path.join(outDir, RESEARCH_PATHS.ledger), ledger);
  await rm(path.join(outDir, RESEARCH_PATHS.captures), { recursive: true, force: true });
  for (const request of requests) await writeJson(path.join(outDir, RESEARCH_PATHS.captures, `${request.id}.json`), request);
  await rm(path.join(outDir, RESEARCH_PATHS.data), { recursive: true, force: true });
  for (const file of data) await writeJson(path.join(outDir, RESEARCH_PATHS.data, `${file.id}.json`), file);
  await writeJson(path.join(outDir, RESEARCH_PATHS.assets), assets);
  await writeJson(path.join(outDir, RESEARCH_PATHS.social), social.manifest);
  await writeJson(path.join(outDir, RESEARCH_PATHS.news), newsManifest);
  const logoFiles = await writeLogos(outDir, logoResult, logos);
  await writeFile(path.join(outDir, RESEARCH_PATHS.digest), renderDigest({ ledger, requests, data, assets, social: social.manifest, logos, news: newsManifest }));

  const flagged = ledger.claims.filter((claim) => claim.status !== "verified" || claim.stale || claim.undated);
  return {
    stage: "research",
    status: flagged.length ? "flagged" : "verified",
    out: outDir,
    files: {
      ledger: path.join(outDir, RESEARCH_PATHS.ledger),
      digest: path.join(outDir, RESEARCH_PATHS.digest),
      captures: requests.map((request) => path.join(outDir, RESEARCH_PATHS.captures, `${request.id}.json`)),
      data: data.map((file) => path.join(outDir, RESEARCH_PATHS.data, `${file.id}.json`)),
      assets: path.join(outDir, RESEARCH_PATHS.assets),
      social: path.join(outDir, RESEARCH_PATHS.social),
      news: path.join(outDir, RESEARCH_PATHS.news),
      logos: path.join(outDir, RESEARCH_PATHS.logos),
      logo_files: logoFiles
    },
    summary: { ...ledger.summary, captures: requests.length, tables: data.length, assets: media.assets.length, people: people.length, portraits: portraits.length, posts: social.manifest.posts.length, logos: logos.logos.length, stories: newsManifest.stories.filter((story) => story.status === "kept").length, stories_dropped: newsManifest.stories.filter((story) => story.status !== "kept").length },
    // The logos.json entries: make lists these as assets (stage each file at its `asset` path; `params` per module).
    logos: logos.logos,
    flagged: flagged.map((claim) => ({ id: claim.id, status: claim.stale ? "stale" : claim.undated ? "undated" : claim.status, text: claim.text, action: claim.flag?.action, message: claim.flag?.message })),
    requests: http.calls.length,
    evidence_data: attached.report,
    ...(usage ? { usage } : {})
  };
}

/**
 * Lines for a script pass: what the sources state (with ids to cite) and
 * which brief claims to cut or soften. For a story (quotes, dates, named
 * models) the writer may only state facts from the first two lists; an
 * evergreen topic may add well-established general knowledge.
 */
export function researchNotes(ledger, snapshotsOrNull = null, options = {}) {
  const claims = ledger?.claims ?? [];
  const verified = claims.filter((claim) => claim.status === "verified");
  const excerpts = ledger?.excerpts ?? (snapshotsOrNull ? keyExcerpts(snapshotsOrNull, options) : []);
  // An evergreen topic (how a material, method or choice works) needs no
  // primary source for its general knowledge; the strict rules are for
  // stories: quotes, dated claims and news about a company or product.
  const evergreen = !claims.some(isStoryClaim);
  // Nothing fetched (offline, no web search key, every source down), or an
  // evergreen topic whose sources confirm nothing: "state only facts listed
  // here" with an empty list leaves "3 common deck materials" with nothing to
  // say, and the script names the options and explains none. The script
  // keeps to well-established general knowledge instead; the audit still
  // holds the research gate at pending for review. A story with no primary
  // source stays strict, so its "drop these stories" list still reaches it.
  if (!Number(ledger?.summary?.sources_checked) || (evergreen && !verified.length && !excerpts.length)) return unresearchedNotes(ledger);
  const lines = evergreen
    ? ["## Research (launchclip research; state these facts as given, anything else only as well-established general knowledge)", "", ...SOURCE_RULES.slice(0, 2).map((rule) => `- ${rule}`), ...GENERAL_KNOWLEDGE_RULES.map((rule) => `- ${rule}`)]
    : ["## Research (launchclip research; state only facts listed here)", "", ...SOURCE_RULES.map((rule) => `- ${rule}`)];
  const current = verified.filter((claim) => !claim.stale);
  if (current.length) {
    lines.push("", "Verified claims:");
    for (const claim of current) {
      const source = claim.sources.find((entry) => entry.supports && entry.primary) ?? claim.sources[0];
      lines.push(`- [${claim.id}] ${claim.text} (source: ${source?.publisher ?? source?.url}${claim.published_at ? `, published ${String(claim.published_at).slice(0, 10)}` : ""})`);
    }
  }
  const stale = verified.filter((claim) => claim.stale);
  if (stale.length) {
    lines.push("", `Old news (the brief asks for the last ${ledger.freshness?.days ?? "few"} days): leave these out, or say when they happened; never present them as new:`);
    for (const claim of stale) lines.push(`- [${claim.id}] ${claim.text} (published ${String(claim.published_at).slice(0, 10)})`);
  }
  if (excerpts.length) {
    lines.push("", "Facts from primary sources:");
    for (const excerpt of excerpts) lines.push(`- ${excerpt.text} (source: ${excerpt.publisher ?? excerpt.url})`);
  }
  const dropped = claims.filter((claim) => claim.status !== "verified" && claim.no_primary_source);
  if (dropped.length) {
    lines.push("", "Drop these stories: no primary source states them, only aggregators or rewrites:");
    for (const claim of dropped) lines.push(`- [${claim.id}] ${claim.text}`);
  }
  const flagged = claims.filter((claim) => claim.status !== "verified" && !claim.no_primary_source);
  if (flagged.length) {
    lines.push("", "Do not state these as fact (cut, soften or attribute to the company):");
    for (const claim of flagged) lines.push(`- [${claim.status}] ${claim.text}: ${claim.flag?.message ?? ""}`);
  }
  return lines.join("\n");
}

// General knowledge the script may use without a source, and must use: an
// option named and never explained teaches the viewer nothing.
export const GENERAL_KNOWLEDGE_RULES = Object.freeze([
  "Write from well-established, widely known facts about the topic: name the common options, what each is and how they differ.",
  "For every option, step or item the script names, say at least one concrete, generally true thing about it the viewer can use: what it is good at, its trade-off, the upkeep or care it needs, where it suits.",
  "Do not state unchecked specifics: exact numbers, prices, dates, ratings, quotes, or claims about a named company, product or person that the brief does not state itself."
]);

// A claim the strict source rules exist for: a quote, a date, or news only an
// aggregator carried. Not a model-looking name: the entity pass reads any
// "a/b" in a brief as a model id ("carousel/image"), so a deck-materials
// brief would read as a model launch.
function isStoryClaim(claim) {
  return claim.kind === "quote" || Boolean(claim.dates?.length) || Boolean(claim.no_primary_source);
}

/** Notes when research confirmed nothing: general knowledge only, nothing specific unchecked. */
function unresearchedNotes(ledger) {
  const checked = Number(ledger?.summary?.sources_checked) || 0;
  const lines = [
    checked
      ? "## Research (launchclip research confirmed nothing from its sources; nothing here is verified)"
      : "## Research (launchclip research could not fetch any source; nothing here is verified)",
    "",
    ...GENERAL_KNOWLEDGE_RULES.map((rule) => `- ${rule}`),
    "- Never write about the research itself (no \"not verified\", \"names not supplied\" or \"on hold\"): the viewer never sees it."
  ];
  const specific = (ledger?.claims ?? []).filter((claim) => claim.kind === "quote" || claim.values?.length || claim.dates?.length);
  if (specific.length) {
    lines.push("", "Unchecked specifics from the brief (state them only as the brief does, or leave them out):");
    for (const claim of specific) lines.push(`- ${claim.text}`);
  }
  return lines.join("\n");
}

// How the script uses its sources: the facts are the companies', never a roundup's.
export const SOURCE_RULES = Object.freeze([
  "Never name an aggregator, news roundup, digest or blog in the narration or on screen, and never cite \"a report\" or \"reports\": no source names in card titles or captions.",
  "State each fact directly, attributed to the company that made it (\"Nimbus released…\", \"Nimbus says…\"), not to the page that repeated it.",
  "Drop any story with no primary source (the company's own page, its official account, the paper, or an outlet's first-hand report); do not hedge it into the script."
]);

/** Sentences and table rows with numbers from primary sources: the facts a writer can lean on. */
export function keyExcerpts(snapshots, options = {}) {
  const max = Number(options.maxExcerpts ?? 24);
  const out = [];
  // A page older than the brief asks for can back a claim (which is then flagged), but is not a fact to write from.
  for (const snapshot of snapshots.filter((entry) => entry.primary && !entry.stale)) {
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

export function renderDigest({ ledger, requests, data, assets, social = null, logos = null, news = null }) {
  const lines = [`# Research`, "", `${ledger.summary.claims} claims: ${ledger.summary.verified} verified, ${ledger.summary.contradicted} contradicted, ${ledger.summary.unverified} unverified. ${ledger.summary.sources_checked} sources checked (${ledger.summary.primary_sources} primary)${ledger.summary.web_search ? `, web search: ${ledger.summary.web_search}` : ", no web search key set"}.`, ""];
  const flagged = ledger.claims.filter((claim) => claim.status !== "verified");
  if (flagged.length) {
    lines.push("## Flagged for the script", "", "Cut, soften or source these before the script is final.", "");
    for (const claim of flagged) lines.push(`- **${claim.status}** [${claim.id}] ${claim.text}  `, `  ${claim.flag?.message ?? ""}`);
    lines.push("");
  }
  const old = ledger.claims.filter((claim) => claim.status === "verified" && claim.stale);
  if (old.length) {
    lines.push(`## Old news (older than the ${ledger.freshness.days} days the brief asks for)`, "", "True, but not new: leave these out or say when they happened.", "");
    for (const claim of old) lines.push(`- [${claim.id}] ${claim.text}  `, `  ${claim.flag?.message ?? ""}`);
    lines.push("");
  }
  lines.push("## Verified", "");
  for (const claim of ledger.claims.filter((entry) => entry.status === "verified")) {
    const best = claim.sources[0];
    lines.push(`- [${claim.id}] ${claim.text}  `, `  ${best.primary ? "primary" : "secondary"}: [${best.title}](${best.url})${ledger.freshness && claim.published_at ? `, published ${String(claim.published_at).slice(0, 10)}` : ""}, confidence ${claim.confidence}: “${truncate(best.quote?.text ?? "", 160)}”${claim.capture ? ` → capture \`${claim.capture}\`` : ""}`);
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
  if (social?.posts?.length) {
    lines.push("", "## Posts on X", "");
    for (const post of social.posts) lines.push(`- ${post.name} (${post.handle}) ${post.url} for ${post.claims.join(", ")} → capture \`${post.capture}\`, social-post card: “${truncate(post.text, 120)}”`);
  }
  if (assets.people.length) {
    lines.push("", "## People", "");
    for (const person of assets.people) lines.push(`- ${person.name}: ${[person.role, person.affiliation].filter(Boolean).join(", ") || "role unknown"}${person.wikidata ? ` ([${person.wikidata.id}](${person.wikidata.url}))` : ""}; ${person.portrait ? `portrait \`${person.portrait}\`` : person.portrait_note}`);
  }
  if (news?.stories.length) {
    lines.push("", "## News leads", "", `Found through ${news.providers.filter((provider) => provider.leads).map((provider) => provider.name).join(", ") || "no source"}${news.queries.length ? ` for ${news.queries.map((query) => `“${query}”`).join(", ")}` : ""}. These are how a story was found; only its primary source is ever cited.`, "");
    for (const story of news.stories) lines.push(`- **${NEWS_STATUS[story.status] ?? story.status}**${story.published_at ? ` ${String(story.published_at).slice(0, 10)}` : " undated"}: ${story.title ?? story.url} <${story.url}>${story.claim ? ` → claim ${story.claim}` : ""}`);
  }
  if (logos?.logos.length) {
    lines.push("", "## Logos", "");
    for (const logo of logos.logos) lines.push(`- ${logo.name}${logo.domain ? ` (${logo.domain})` : ""}: \`${logo.file}\` from ${logo.kind === "site" ? `the site (${logo.via})` : "Simple Icons"} <${logo.source_url}>`);
  }
  return `${lines.join("\n")}\n`;
}

const NEWS_STATUS = { kept: "kept", stale: "too old", "no-primary-source": "dropped, no primary source", "not-fetched": "not fetched" };

/**
 * Headline claims from the kept stories: the page's own title, when the page
 * text states it word for word and no claim already says it. Newest first.
 */
export function storyClaims(stories, snapshots, claims = [], max = 8) {
  const key = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const out = [];
  const kept = stories.filter((story) => story.status === "kept" && story.title).sort((a, b) => (Date.parse(b.published_at ?? "") || 0) - (Date.parse(a.published_at ?? "") || 0));
  for (const story of kept) {
    if (out.length >= Number(max ?? 8)) break;
    const snapshot = snapshots.find((entry) => entry.url === story.url);
    // A headline of a few words says too little to check or to show.
    if (!snapshot || story.title.split(/\s+/).length < 4 || !key(snapshot.text).includes(key(story.title))) continue;
    if ([...claims, ...out].some((claim) => key(claim.text) === key(story.title))) continue;
    out.push({ text: story.title, kind: "statement", origin: "news" });
  }
  return out;
}

/**
 * Stamps each claim with its source's publish date (the best supporting
 * primary source), and, when the brief asks for the latest, flags a verified
 * claim whose source is older than that or carries no date at all.
 */
export function datedClaims(ledger, { now, window = null } = {}) {
  if (window) ledger.freshness = { days: window.days, asked_by: window.asked_by };
  let stale = 0, undated = 0;
  for (const claim of ledger.claims) {
    const source = claim.sources.find((entry) => entry.supports && entry.primary) ?? claim.sources.find((entry) => entry.supports);
    if (!source) continue;
    claim.published_at = source.published_at ?? null;
    if (!window || claim.status !== "verified") continue;
    const age = ageDays(source.published_at, now);
    if (age == null) {
      undated += 1;
      claim.undated = true;
      claim.flag = { action: "date-or-drop", message: `${source.publisher ?? source.url} gives no publish date, so this cannot be shown to be from the last ${window.days} days; check the date or leave it out` };
    } else if (age > window.days) {
      stale += 1;
      claim.stale = { published_at: source.published_at, age_days: age, window_days: window.days };
      claim.flag = { action: "date-or-drop", message: `${source.publisher ?? source.url} published this on ${String(source.published_at).slice(0, 10)}, ${Math.round(age)} days before this run; the brief asks for the last ${window.days} days ("${window.asked_by}"), so leave it out or say when it happened` };
    }
  }
  if (window) ledger.summary = { ...ledger.summary, stale, undated };
  return ledger;
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
