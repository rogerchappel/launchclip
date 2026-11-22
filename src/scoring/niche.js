// `launchclip score niche "<keywords>" --name <niche>` (docs/SCORING_ROADMAP.md,
// stage 8): one command from keywords to a drafted rubric with its evidence.
//
//   discover → widen the keywords → evidence → (video) → formats → draft → report
//
// Everything for a niche lives in one folder, so one machine holds many:
//
//   <niches>/<name>/niche.json  creators.json  library.jsonl  thumbs/
//                   rubric.draft.json  report.md
//
// Each step skips what is already done, so the command can be stopped and run
// again. Nothing here asks a question: on a server it runs to the end.
//
// io: {fetch, token, apiKey, client, stderr, steps} where steps swaps any of
// {discover, widen, evidence, video, formats, draft} for a stand-in, for tests.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergeLibrary, withOutliers } from "./library.js";

export const nichesDir = (flags = {}) => path.resolve(String(flags.dir ?? process.env.LAUNCHCLIP_NICHES ?? "niches"));
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const readJson = async (file, fallback) => (existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : fallback);
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const readJsonl = async (file) => (existsSync(file) ? (await readFile(file, "utf8")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)) : []);
const writeJsonl = (file, rows) => writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));

/** --rubric may name a niche: its reviewed rubric.json, else its draft. A path to a file is left alone. */
export function resolveRubric(value, flags = {}) {
  if (existsSync(String(value))) return value;
  for (const file of ["rubric.json", "rubric.draft.json"]) {
    const candidate = path.join(nichesDir(flags), String(value), file);
    if (existsSync(candidate)) return candidate;
  }
  return value;
}

function whole(flags, name, fallback) {
  if (flags[name] == null) return fallback;
  const value = Number(flags[name]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a whole number; got ${flags[name]}`);
  return value;
}

/**
 * Asks the text scorer of every post with words "is this about the niche?",
 * once a post (the answer is kept on the row as on_topic). A creator with 5 or
 * more answered posts and under `minShare` of them on topic is set aside.
 * → {rows, aside, creators}
 */
export async function topicFilter(rows, { niche, minShare = 0.4, fetch, apiKey } = {}) {
  const { parseRubric, scoreItems } = await import("../scorer.js");
  const words = (row) => [row.caption, row.transcript].filter(Boolean).join("\n").trim();
  const todo = rows.filter((row) => row.on_topic == null && words(row));
  if (todo.length) {
    const rubric = parseRubric({ questions: { on_topic: { type: "noul", gate: false, instructions: `Is this post about ${niche}?`, criteria: { true: `It is about ${niche}, or made for people interested in it.`, false: "It is about something else." } } } });
    const report = await scoreItems(todo.map((row, index) => ({ id: String(index), kind: "hook", text: words(row).slice(0, 1500) })), rubric, { ...(fetch ? { fetch } : {}), ...(apiKey ? { apiKey } : {}) });
    for (const item of report.items) { const p = item.answers?.on_topic?.value; if (Number.isFinite(p)) todo[Number(item.id)].on_topic = Math.round(p * 100) / 100; }
  }
  const off = [...Map.groupBy(rows.filter((row) => row.on_topic != null), (row) => row.account)].filter(([, posts]) => posts.length >= 5 && posts.filter((row) => row.on_topic >= 0.5).length / posts.length < minShare).map(([account]) => account);
  return { rows: rows.filter((row) => !off.includes(row.account)), aside: rows.filter((row) => off.includes(row.account)), creators: off };
}

async function defaultSteps() {
  const [{ discover }, { widenKeywords }, { gatherEvidence }, { tagFormats, compareNiches, formatWorthTesting }, { runRubricDraft }] = await Promise.all([
    import("./discover.js"), import("./keywords.js"), import("./evidence.js"), import("./compare.js"), import("./rubric.js")
  ]);
  return { topic: topicFilter, discover, widen: widenKeywords, evidence: gatherEvidence, formats: tagFormats, compare: compareNiches, worthTesting: formatWorthTesting, draft: runRubricDraft, video: async (...args) => (await import("./video.js")).videoSignals(...args) };
}

/**
 * target: keywords, comma separated (optional once niche.json exists).
 * flags: name, dir, niche (the niche in a few words, for the writers),
 * platform, creators (a keyword, default 8), per-creator, days, widen (take the
 * in-niche keywords found, without asking), keywords (how many widened keywords
 * to take, default 5), text-only, with-video, formats-only (no rubric draft: a
 * niche collected to borrow formats from), questions, model, second.
 * → {name, folder, keywords, posts, creators, evidence, draft, report, warnings}
 */
export async function runNiche(target, flags = {}, io = {}) {
  const typed = String(target ?? "").split(",").map((word) => word.trim()).filter(Boolean);
  const name = slug(flags.name ?? typed[0] ?? "");
  if (!name) throw new Error('usage: launchclip score niche "<keyword>, <keyword>" [--name <niche>] [--niche "<a few words>"] [--platform tiktok|instagram] [--widen] [--text-only] [--with-video] [--dir <niches>]');
  const folder = path.join(nichesDir(flags), name);
  await mkdir(folder, { recursive: true });
  const files = { niche: path.join(folder, "niche.json"), creators: path.join(folder, "creators.json"), library: path.join(folder, "library.jsonl"), draft: path.join(folder, "rubric.draft.json"), report: path.join(folder, "report.md") };
  const stderr = io.stderr ?? process.stderr;
  const say = (text) => stderr.write(`${text}\n`);
  const steps = { ...(io.steps?.discover && io.steps?.draft ? {} : await defaultSteps()), ...io.steps };
  const warnings = [];

  const niche = await readJson(files.niche, { name, niche: String(flags.niche ?? typed.join(", ")), platform: String(flags.platform ?? "tiktok").toLowerCase(), keywords: [] });
  if (flags.niche) niche.niche = String(flags.niche);
  for (const keyword of typed) if (!niche.keywords.some((entry) => entry.keyword.toLowerCase() === keyword.toLowerCase())) niche.keywords.push({ keyword, relation: "in", source: "you" });
  if (!niche.keywords.length) throw new Error(`${files.niche} has no keywords yet: give some, as in launchclip score niche "<keyword>" --name ${name}`);
  await writeJson(files.niche, niche);

  // Each keyword gets its own search and its own share of creators, so one corner of the industry cannot fill the library.
  const discoverKeyword = async (entry) => {
    say(`Discover: ${entry.keyword}`);
    try {
      const found = await steps.discover({ keywords: [entry.keyword], platform: niche.platform, creators: whole(flags, "creators", 8), perCreator: whole(flags, "per-creator", 30), days: whole(flags, "days", 0), searchLimit: whole(flags, "search-limit", 60), ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.token ? { token: io.token } : {}), onStep: (text) => say(`  ${text}`) });
      // A creator already in the library keeps the keyword that found them first.
      const known = new Map((await readJsonl(files.library)).map((row) => [`${row.platform}:${row.account}`, row.keyword]));
      await mergeLibrary(files.library, found.rows.map((row) => ({ ...row, keyword: known.get(`${row.platform}:${row.account}`) ?? entry.keyword })));
      const creators = await readJson(files.creators, { platform: niche.platform, creators: [] });
      for (const creator of found.creators) if (!creators.creators.some((seen) => seen.account === creator.account)) creators.creators.push({ ...creator, keyword: entry.keyword });
      await writeJson(files.creators, creators);
      warnings.push(...found.warnings);
      Object.assign(entry, { done: true, posts: found.rows.length, creators: found.creators.length });
    } catch (error) {
      // One keyword that fails does not stop the niche. A search that found nobody is settled; anything else (no credit, no network) is tried again next run.
      const error1 = String(error.message).split("\n")[0];
      Object.assign(entry, /found no accounts/.test(error1) ? { done: true, posts: 0, creators: 0, error: error1 } : { error: error1 });
      warnings.push(`${entry.keyword}: ${entry.error}`);
    }
    await writeJson(files.niche, niche);
  };
  for (const entry of niche.keywords.filter((entry) => entry.relation === "in" && entry.source === "you" && !entry.done)) await discoverKeyword(entry);

  // Widen once: the library itself (shared hashtags) and a writing model name the rest of the industry.
  if (!niche.widened && steps.widen) {
    say("Keywords: looking for the rest of the industry");
    try {
      // The writing model sorts keywords into the niche or out of it. Without one they come back unsorted, and none is collected.
      const model = flags.model ?? process.env.LAUNCHCLIP_MAKE_MODEL;
      const client = io.client ?? (model && !io.steps?.widen ? (await import("../model_provider.js")).createStructuredClient(model) : undefined);
      const more = await steps.widen({ niche: niche.niche, keywords: niche.keywords.map((entry) => entry.keyword), rows: await readJsonl(files.library), ...(client ? { client } : {}) });
      for (const entry of more) if (!niche.keywords.some((seen) => seen.keyword.toLowerCase() === entry.keyword.toLowerCase())) niche.keywords.push(entry);
      // Unsorted keywords are not kept as the answer: the next run with a model sorts them.
      niche.widened = more.every((entry) => entry.relation);
      if (!niche.widened) { niche.keywords = niche.keywords.filter((entry) => entry.relation); warnings.push("keywords were found but not sorted: set a writing model (--model or LAUNCHCLIP_MAKE_MODEL) and run again"); }
      await writeJson(files.niche, niche);
    } catch (error) {
      warnings.push(`keywords were not widened: ${String(error.message).split("\n")[0]}`);
    }
  }
  if (flags.widen) {
    const take = whole(flags, "keywords", 5);
    // Search phrases before hashtags: on the first real niche the hashtags led to music edits, and the rubric needs posts where someone speaks.
    const waiting = niche.keywords.filter((entry) => entry.relation === "in" && entry.source !== "you" && !entry.done);
    for (const entry of [...waiting.filter((entry) => entry.source === "model"), ...waiting.filter((entry) => entry.source !== "model")].slice(0, take)) await discoverKeyword(entry);
  }

  let rows = await readJsonl(files.library);
  if (!rows.length) throw new Error(`no posts were found for ${niche.keywords.map((entry) => entry.keyword).join(", ")}${warnings.length ? `: ${warnings[0]}` : ""}`);

  // Evidence straight after discovery: subtitle and cover links expire.
  say(`Evidence: ${rows.length} posts`);
  const evidence = await steps.evidence(rows, { ...(flags["text-only"] ? {} : { thumbsDir: path.join(folder, "thumbs") }), ...(io.fetch ? { fetch: io.fetch } : {}), onStep: (text) => say(`  ${text}`) });
  rows = evidence.rows;
  await writeJsonl(files.library, rows);
  // gatherEvidence counts this run only; the report wants the library as it stands.
  const have = { posts: rows.length, transcripts: rows.filter((row) => row.transcript).length, thumbs: rows.filter((row) => row.thumb).length };

  // A search returns broad accounts too. A creator whose posts are mostly about something else is set aside, not deleted.
  if (steps.topic) {
    say("Topic: checking each creator is in the niche");
    try {
      const checked = await steps.topic(rows, { niche: niche.niche, ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.apiKey ? { apiKey: io.apiKey } : {}) });
      if (checked.aside.length) {
        await mergeLibrary(path.join(folder, "library.off-topic.jsonl"), checked.aside);
        warnings.push(`set aside as mostly off the niche: ${checked.creators.join(", ")} (${checked.aside.length} posts, kept in library.off-topic.jsonl)`);
      }
      rows = checked.rows;
      await writeJsonl(files.library, rows);
    } catch (error) {
      warnings.push(`the niche check did not run: ${String(error.message).split("\n")[0]}`);
    }
  }

  let video = null;
  if (flags["with-video"]) {
    say("Video: a sample of each creator's best and worst");
    // No transcription here: a speech model invents words on music-only posts, and those would be read as spoken hooks.
    video = await steps.video(rows, { dir: folder, transcribe: false, onStep: (step) => say(`  ${step.row?.id}: ${step.ok ? "done" : step.error}`) });
    rows = video.rows;
    await writeJsonl(files.library, rows);
  }

  let formatsCost = 0;
  if (steps.formats) {
    say("Formats: tagging how each post is built");
    try {
      const tagged = await steps.formats(rows, { ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.apiKey ? { apiKey: io.apiKey } : {}) });
      rows = tagged.rows;
      formatsCost = tagged.cost_usd ?? 0;
      await writeJsonl(files.library, rows);
    } catch (error) {
      warnings.push(`formats were not tagged: ${String(error.message).split("\n")[0]}`);
    }
  }

  // A niche collected only to borrow formats from needs no rubric of its own.
  if (!flags["formats-only"]) say("Draft: writing and testing the questions");
  const draft = flags["formats-only"] ? { cost_usd: 0, questions: [] } : await steps.draft(files.library, { niche: niche.niche, out: files.draft, ...(flags["text-only"] ? { "text-only": true } : {}), ...(flags.questions ? { questions: flags.questions } : {}), ...(flags.model ? { model: flags.model } : {}), ...(flags.second ? { second: flags.second } : {}) }, { ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.apiKey ? { apiKey: io.apiKey } : {}), ...(io.client ? { client: io.client } : {}) });

  // Other niches on this machine are where formats to try come from.
  const others = [];
  for (const entry of existsSync(nichesDir(flags)) ? await readdir(nichesDir(flags), { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || entry.name === name) continue;
    const otherRows = await readJsonl(path.join(nichesDir(flags), entry.name, "library.jsonl"));
    if (otherRows.some((row) => row.tags)) others.push({ name: entry.name, rows: otherRows });
  }
  const imports = steps.compare ? others.map((other) => ({ from: other.name, candidates: steps.compare({ name: other.name, rows: withOutliers(other.rows) }, { name, rows: withOutliers(rows) }) })) : [];

  const summary = { name, folder, niche: niche.niche, platform: niche.platform, keywords: niche.keywords, posts: rows.length, creators: new Set(rows.map((row) => row.account)).size, evidence: have, ...(video ? { video: video.counts } : {}), draft, imports: imports.map((entry) => ({ from: entry.from, candidates: entry.candidates.length })), report: files.report, cost_usd: Math.round(((draft.cost_usd?.total ?? draft.cost_usd ?? 0) + formatsCost) * 1e6) / 1e6, warnings };
  await writeFile(files.report, nicheReport(summary, rows, imports, steps.worthTesting));
  // The same list as data, for `launchclip score hooks --formats <niche>`.
  await writeJson(path.join(folder, "worth-testing.json"), imports.flatMap((entry) => entry.candidates.map(({ examples, ...candidate }) => ({ from: entry.from, ...candidate }))));
  return summary;
}

const cell = (value) => String(value ?? "").replace(/\s+/g, " ").replace(/\|/g, "/");
const cut = (text, length = 110) => (cell(text).length > length ? `${cell(text).slice(0, length - 1)}…` : cell(text));

/** report.md: what was collected, what the draft found, examples to look at, and formats to try from other niches. */
export function nicheReport(summary, rows, imports = [], worthTesting) {
  const lines = [`# ${summary.niche}: rubric evidence`, "", `${summary.posts} posts from ${summary.creators} creators on ${summary.platform}. ${summary.evidence?.transcripts ?? 0} with a transcript, ${summary.evidence?.thumbs ?? 0} with a cover kept.`, ""];
  const status = summary.draft?.status;
  if (status) lines.push(`**${status.ready ? "Ready to use." : "Not ready yet."}** ${status.judging_posts} posts judged the questions, ${status.kept} kept as rules.`, "");

  lines.push("## Keywords", "", "| Keyword | In the niche | From | Creators | Posts |", "|---|---|---|---|---|");
  for (const entry of summary.keywords) lines.push(`| ${cell(entry.keyword)} | ${cell(entry.relation ?? "?")} | ${cell(entry.source)} | ${entry.done ? entry.creators : "not collected"} | ${entry.done ? entry.posts : ""} |`);
  const outliers = withOutliers(rows).filter((row) => Number.isFinite(row.outlier));
  const byKeyword = Map.groupBy(outliers.filter((row) => row.keyword), (row) => row.keyword);
  if (byKeyword.size > 1) {
    lines.push("", "Share of each keyword's posts that beat their own channel's normal:", "");
    for (const [keyword, group] of byKeyword) lines.push(`- ${cell(keyword)}: ${Math.round((group.filter((row) => row.outlier > 1).length / group.length) * 100)}% of ${group.length}`);
  }

  const questions = summary.draft?.questions ?? [];
  if (questions.length) {
    lines.push("", "## Questions tested", "", "| Part | Question | Verdict | Link with results | Winners / the rest |", "|---|---|---|---|---|");
    for (const question of questions) lines.push(`| ${cell(question.part ?? "")} | ${cut(question.instructions ?? question.key, 90)} | ${cell(question.verdict)} | ${question.rho == null ? "" : Number(question.rho).toFixed(2)} | ${question.yes_rate_hits == null ? "" : `${Math.round(question.yes_rate_hits * 100)}% / ${Math.round(question.yes_rate_rest * 100)}%`} |`);
    lines.push("", "A link near 0 means no pattern. A kept question is a pattern in this library, not a cause.");
  }

  lines.push("", "## Posts to look at", "", "The furthest above and below their own channel's normal.", "");
  const sorted = [...outliers].sort((a, b) => b.outlier - a.outlier);
  const example = (row) => `- ${row.outlier >= 10 ? Math.round(row.outlier) : Math.round(row.outlier * 100) / 100}× normal, ${row.metrics?.views ?? "?"} views, @${cell(row.account)}: "${cut(row.spoken_hook ?? row.caption)}"${row.url ? ` [open](${row.url})` : ""}`;
  lines.push("**Above**", "", ...sorted.slice(0, 8).map(example), "", "**Below**", "", ...sorted.slice(-5).map(example));

  lines.push("", "## Worth testing here", "");
  const sections = worthTesting ? imports.filter((entry) => entry.candidates.length).map((entry) => worthTesting(entry.candidates, { from: entry.from, to: summary.name }).replace(/^#+ .*\n+/, `**From ${entry.from}**\n\n`)) : [];
  lines.push(sections.length ? sections.join("\n\n") : "Nothing to compare against yet. Run another niche on this machine (a neighbouring topic is the best first one) and its formats that are rare here are listed in this section.");
  if (summary.warnings.length) lines.push("", "## Warnings", "", ...summary.warnings.map((warning) => `- ${cell(warning)}`));
  return `${lines.join("\n")}\n`;
}

/** The run as lines a person reads. */
export function formatNiche(summary) {
  const lines = [`${summary.niche}: ${summary.posts} posts from ${summary.creators} creators (${summary.evidence?.transcripts ?? 0} with a transcript).`];
  const waiting = summary.keywords.filter((entry) => !entry.done && entry.relation === "in");
  if (waiting.length) lines.push(`More keywords found in the niche, not yet collected: ${waiting.map((entry) => entry.keyword).join(", ")}. Run again with --widen to collect them, or edit niche.json.`);
  const status = summary.draft?.status;
  if (status) lines.push(`${status.kept} question(s) kept as rules from ${status.judging_posts} judging posts. ${status.ready ? "Ready to use." : "Not ready yet."}`);
  for (const warning of summary.warnings) lines.push(`warning: ${warning}`);
  lines.push(`Evidence: ${summary.report}`, `Rubric draft: ${path.join(summary.folder, "rubric.draft.json")}. Cost $${summary.cost_usd}.`, `Use it: launchclip score hooks "<topic>" --rubric ${summary.name}`);
  return `${lines.join("\n")}\n`;
}
