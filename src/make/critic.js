// Headless critic for `launchclip make --critic` (src/make/index.js).
//
// After finish has written qa/temporal-evidence/manifest.json and
// qa/critic-sheets/ (build-evidence.mjs), a vision-capable model reviews the
// sheets and the overview strip and writes qa/critic.json in the cinematic
// format (skills-src/references/cinematic-production.md):
//   {verdict: ship|repair|replan|recapture, summary, template, findings: [{id, severity, category,
//    message, evidence_ids}], keep, tooling_checks, verdict_pass, evidence_ids_reviewed}
// evidence_ids_reviewed is set by tooling: every manifest entry whose sample
// sits on a sheet the model was shown. Finding citations are checked against
// the manifest; a cited sample id expands to its two evidence ids, and an
// unknown id is dropped with a warning (a finding left with none is kept and
// cites the sheet's samples, so the citation gate still has evidence).
//
// Character stories (docs/ANIMATION_PIPELINE_RFC.md §4.7): with a show bible
// in the project, each character's reference sheet (bible/sheets/<id>.png) is
// shown beside the frames, and the critique lists them under
// reviewer.reference_sheets. `review: "animatic"` is the staging review of the
// animatic (§4.4): story, staging and acting only, written to
// qa/animatic-critic.json; reviewAnimatic() also records its verdict in
// ANIMATIC.json.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { FLAW_WORDS } from "@launchclip/core/characters/kinds.mjs";
import { RULES_HEADING } from "./script.js";
import { estimateModelUsageCost } from "../cost_tracker.js";
import { ANIMATIC_REVIEW_FILE, recordAnimaticReview } from "../animatic.js";

// The rubric (VIDEO_QUALITY_RFC §11.3): the craft categories, plus
// missed-opportunity (a line whose intent calls for a visual has none),
// sparseness (a run longer than the profile allows), brand-consistency (a
// scene that breaks the style or the brand frame), and for character stories
// acting (a pose or expression that does not match its line, or a character
// holding still while the story moves) and character-consistency (a character
// that looks different between shots, or unlike its reference sheet) and
// lip-sync (a mouth that does not match its line: closed while the character
// speaks, moving while it is silent, or the wrong character's mouth moving).
export const CHARACTER_CATEGORIES = Object.freeze(["acting", "character-consistency", "lip-sync"]);
// specificity (VIDEO_TELLS_RFC §3): the template check failed, the video would
// still fit with another subject in it.
export const CRITIC_CATEGORIES = Object.freeze(["narrative", "composition", "typography", "motion", "asset", "timing", "audio", "mount", "factual", "missed-opportunity", "sparseness", "brand-consistency", "specificity", ...CHARACTER_CATEGORIES]);
// The animatic's staging review judges story, staging and acting only (§4.4):
// they are cheap to fix before the delivery render. Polish waits for the final.
export const STAGING_CATEGORIES = Object.freeze(["narrative", "composition", "timing", ...CHARACTER_CATEGORIES]);
export const CRITIC_REVIEWS = Object.freeze(["final", "animatic"]);
export const CRITIC_FILE = "qa/critic.json";
// recapture (VIDEO_TELLS_RFC §4): the evidence is bad, so the sheets are rebuilt and the video is left alone.
export const CRITIC_VERDICTS = Object.freeze(["ship", "repair", "replan", "recapture"]);
export const TOOLING_CHECKS = Object.freeze(["agree", "false-positive"]);
export const VERDICT_SCORES = Object.freeze(["resolved", "partial", "unresolved"]);
const MAX_REGRESSIONS = 3;
const MAX_KEEP = 5;

const findingSchema = (categories) => ({
  type: "object",
  additionalProperties: false,
  required: ["id", "severity", "category", "message", "evidence_ids"],
  properties: {
    id: { type: "string" },
    severity: { type: "string", enum: ["blocking", "major", "minor"] },
    category: { type: "string", enum: categories },
    message: { type: "string" },
    evidence_ids: { type: "array", items: { type: "string" } }
  }
});
const KEEP_SCHEMA = { type: "array", items: { type: "string" } };
// The final review answers the template question first (properties are generated in order) and names what must survive a repair.
const criticSchema = (categories, final) => Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [...(final ? ["template"] : []), "verdict", "summary", "findings", ...(final ? ["keep"] : [])],
  properties: {
    ...(final ? { template: { type: "object", additionalProperties: false, required: ["swappable", "why"], properties: { swappable: { type: "boolean" }, why: { type: "string" } } } } : {}),
    verdict: { type: "string", enum: final ? CRITIC_VERDICTS : CRITIC_VERDICTS.slice(0, 3) },
    summary: { type: "string" },
    findings: { type: "array", items: findingSchema(categories) },
    ...(final ? { keep: KEEP_SCHEMA } : {})
  }
});
export const MAKE_CRITIC_SCHEMA = criticSchema(CRITIC_CATEGORIES, true);
export const STAGING_CRITIC_SCHEMA = criticSchema(STAGING_CATEGORIES, false);
// Pass B: each tooling finding, agreed or called a false positive.
export const TOOLING_CHECK_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["checks"],
  properties: { checks: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "check", "note"], properties: { id: { type: "string" }, check: { type: "string", enum: TOOLING_CHECKS }, note: { type: "string" } } } } }
});
// The verdict pass after a repair: the prior blocking and major findings scored, at most three regressions.
export const VERDICT_PASS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["scores", "regressions", "summary", "keep"],
  properties: {
    scores: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "status", "evidence_ids", "note"], properties: { id: { type: "string" }, status: { type: "string", enum: VERDICT_SCORES }, evidence_ids: { type: "array", items: { type: "string" } }, note: { type: "string" } } } },
    regressions: { type: "array", items: findingSchema(CRITIC_CATEGORIES) },
    summary: { type: "string" },
    keep: KEEP_SCHEMA
  }
});

const INSTRUCTIONS = `You are a fresh-context motion-design critic reviewing a rendered draft from contact sheets.

First, the template question: if you swapped this video's subject for another product or topic, would the pictures still fit? Answer it in "template" before anything else. If they would, that is a specificity finding (major when it holds for the hook): name what is generic and what from this subject should replace it. When an art direction or a motion thesis is given, judge the video against it.

Each sheet shows samples in time order, as pairs of tiles: left = the renderer's browser still, right = the same moment decoded from the encoded draft. The overview strip shows one frame every 1.5 s.

Judge what the pixels show: hook clarity, legibility on a phone, typography, hierarchy and composition, clipped or overlapping content, empty or near-identical frames, continuity across transitions, whether real product media (screenshots, recordings, logos) is used well, and whether the left and right tiles match (an encode defect if not).

Judge density and style too, not only polish:
- missed-opportunity: a line whose intent calls for a visual (a claim, a number, a list, a process, the product, proof, a quote, the hook or the call to action) plays with nothing on screen but the presenter.
- sparseness: a long stretch with no designed graphic, past what the format allows.
- brand-consistency: a scene that breaks the style (palette, type, caption treatment) or drops the brand frame the other scenes carry.
- acting and character-consistency (character stories only): a pose or expression that does not match its line, a character holding still while the story moves, or a character who looks different between shots.
- lip-sync (character stories only): a mouth that does not match its line: closed in every tile while that character speaks, open while it is silent, or the wrong character's mouth moving. You see stills, so report it only when the tiles of a spoken line show it.
- When reference sheets are attached, each one is how that character must look in every shot (hair, skin, clothes, build, what they wear or carry). A character who does not match their sheet is a character-consistency finding. Never cite a reference sheet as evidence; cite the tile that shows the mismatch.

Rules:
- Cite evidence ids exactly as listed for the tiles you are describing. Every finding needs at least one.
- Do not invent defects in moments you were not shown. Do not judge audio; you cannot hear it.
- verdict "ship" only with no blocking or major findings; "repair" for fixable scene-level problems; "replan" when the story or structure is wrong; "recapture" when the evidence itself is bad (blank or half-loaded tiles, left and right tiles that differ from a capture fault rather than an encode defect, samples missing): the sheets are rebuilt and the video is not touched.
- Keep each message actionable: what is wrong, where, and the smallest fix.
- keep: up to five things that work and must survive any repair (a moment, a move, a line of type), each with where it is.

Return only the JSON object.`;

const TOOLING_INSTRUCTIONS = `You are the same critic, second pass. You have already judged the contact sheets; your findings are listed. Tooling measured the findings below from the storyboard and the pixels. For each tooling finding, look at the tiles near its time and answer "agree" when the frames show it, or "false-positive" when they do not, with a one-line note on what you see. Judge every id listed and nothing else. Return only the JSON object.`;

const VERDICT_INSTRUCTIONS = `You are a fresh-context critic checking a repaired draft from contact sheets. An earlier review raised the findings listed; the video was changed and rendered again. You see only the new sheets.

For each listed finding, score it against the new tiles: "resolved" (the problem is gone), "partial" (better, still visible) or "unresolved". Cite the new evidence ids that show it. Then name at most three regressions: problems the repair introduced, each a finding with evidence ids. Do not hunt for new problems beyond regressions.

Each sheet shows samples in time order, as pairs of tiles: left = the renderer's browser still, right = the same moment decoded from the encoded draft. Do not judge audio. keep: up to five things that work and must survive any further repair.

Return only the JSON object.`;

const STAGING_INSTRUCTIONS = `You are a fresh-context story editor reviewing an animatic from contact sheets: the whole story drawn by the character rig at draft quality, before the delivery render. Problems found here are cheap to fix, so this review is about story, staging and acting only.

Each sheet shows samples in time order, as pairs of tiles: left = the renderer's browser still, right = the same moment decoded from the encoded draft. The overview strip shows one frame every 1.5 s. The shot list says who is in each shot, what is said during it, and the poses planned.

Judge:
- narrative: does the story read from the pictures alone: who wants what, what goes wrong, what changes? Is the opening shot a hook? Is a beat missing, or shown in the wrong order?
- works on mute: most viewers start with the sound off. Judge the opening seconds from the tiles and on-screen text only, as if the shot list's words were never heard: can a viewer tell where this is and what is about to go wrong by the end of the problem beat? If not, that is a major narrative finding on the shot that should show it.
- composition (staging): is the speaker on screen and easy to find, are the characters framed and facing each other, does the framing change when the story turns, is anyone cropped, hidden or standing on a caption?
- timing: a shot that outstays its line, or one too short to read.
- acting: a pose or expression that does not match its line, or a character holding still while the story moves.
- character-consistency: a character who looks different between shots, or unlike their reference sheet. Each attached reference sheet is how that character must look in every shot.
- lip-sync: a mouth closed in every tile of that character's line, open while silent, or the wrong character's mouth moving. You see stills, so report it only when the tiles of a spoken line show it.

Do not judge polish: draft encoding, type refinement, colour, music or sound. Do not judge audio; you cannot hear it.

Rules:
- Cite evidence ids exactly as listed for the tiles you are describing. Every finding needs at least one. Never cite a reference sheet as evidence.
- Do not invent defects in moments you were not shown.
- verdict "ship" only with no blocking or major findings; "repair" when one or a few shots need new staging or acting; "replan" when the story or the shot order is wrong.
- Keep each message actionable: which shot, what is wrong, and the smallest change to its poses, framing or set.

Return only the JSON object.`;

/**
 * options: {project, client, model, provider, maxSheets (default 12),
 * quality: the findings finish's coverage gate proved from the direction map
 * and the storyboard ([{category, severity, at, message}], src/quality_gates.js),
 * tells: finish's tells gate findings ([{rule, severity, at, detail}]).}
 * The final review is two calls (VIDEO_TELLS_RFC §4): pass A judges the
 * sheets blind to the tooling and answers the template question first; pass B
 * (only with tooling findings) marks each one agree or false-positive. The
 * quality findings land in qa/critic.json as findings, each citing the
 * evidence sample nearest its time; every check lands in tooling_checks.
 * prior: the critique a repair round answers. Its blocking and major findings
 * are scored resolved | partial | unresolved against the new sheets, with at
 * most three regressions and no new hunt (the verdict pass); anything short of
 * resolved stays a finding at its severity, so it forbids ship.
 * A partial set of sheets (a sheet missing on disk, a sample with no evidence)
 * never earns ship: it is recorded as recapture.
 * review: "final" (default; qa/critic.json) or "animatic" (the staging
 * review; qa/animatic-critic.json). referenceSheets: false leaves the show
 * bible's sheets out; shots: the shot list's shots (src/story_shots.js), given
 * to the model as text when present.
 * → {status: "written"|"skipped"|"failed", file, verdict, findings, keep, reviewed, warnings, usage, cost_usd, reference_sheets, reason?}
 */
export async function runHeadlessCritic({ project, client, model = null, provider = null, maxSheets = 12, quality = [], tells = [], prior = null, rules = null, review = "final", referenceSheets = true, shots = null } = {}) {
  if (!CRITIC_REVIEWS.includes(review)) throw new Error(`review must be one of ${CRITIC_REVIEWS.join(", ")}; got ${review}`);
  const staging = review === "animatic";
  const manifestFile = path.join(project, "qa/temporal-evidence/manifest.json");
  const indexFile = path.join(project, "qa/critic-sheets/index.json");
  if (!existsSync(manifestFile) || !existsSync(indexFile)) return { status: "skipped", reason: "finish wrote no temporal evidence or critic sheets" };
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const index = JSON.parse(await readFile(indexFile, "utf8"));
  const sheets = (index.sheets ?? []).slice(0, maxSheets);
  const bySample = new Map();
  for (const entry of manifest.entries ?? []) {
    const sample = entry.sample_id ?? String(entry.evidence_id).replace(/-[^-]+-[^-]+$/, "");
    if (!bySample.has(sample)) bySample.set(sample, []);
    bySample.get(sample).push(entry);
  }
  const images = [];
  const lines = [];
  const missing = [];
  // The sheets and the reference sheets are read together; the images and the lines keep the sheets' order.
  const sheetFiles = sheets.map((sheet) => path.join(project, "qa/critic-sheets", sheet.sheet));
  const references = referenceSheets ? await bibleReferenceSheets(project) : [];
  const [sheetUrls, referenceUrls] = await Promise.all([
    Promise.all(sheetFiles.map((file) => (existsSync(file) ? dataUrl(file) : null))),
    Promise.all(references.map((reference) => dataUrl(path.join(project, reference.file))))
  ]);
  for (const [index, sheet] of sheets.entries()) {
    if (!sheetUrls[index]) { missing.push(`sheet ${sheet.sheet} is not on disk`); continue; }
    images.push({ url: sheetUrls[index], detail: "high" });
    lines.push(`Sheet ${images.length} (${sheet.sheet}), tiles left to right, top to bottom:`);
    for (const sample of sheet.samples ?? []) {
      if (!bySample.has(sample)) missing.push(`sample ${sample} has no evidence`);
      for (const entry of bySample.get(sample) ?? []) lines.push(`  ${entry.evidence_id}  (${entry.source}, ${entry.role ?? "sample"} at ${entry.at_seconds}s${entry.boundary_id ? `, boundary ${entry.boundary_id}` : ""})`);
    }
  }
  const sheetCount = images.length;
  const overview = path.join(project, "qa/critic-sheets/overview-every-1.5s.jpg");
  if (existsSync(overview)) { images.push({ url: await dataUrl(overview), detail: "low" }); lines.push(`Image ${images.length}: the overview strip (context only; cite the sheet tiles)`); }
  if (!images.length) return { status: "skipped", reason: "no critic sheet images were found" };
  const sheetLines = [...lines];
  // The show bible's reference sheets, beside the frames (§4.7).
  if (references.length) lines.push("", "Reference sheets (how each character must look in every shot; not evidence, never cite them):");
  for (const [index, reference] of references.entries()) {
    images.push({ url: referenceUrls[index], detail: "high" });
    lines.push(`  Image ${images.length}: ${reference.name} (${reference.character})${reference.must_keep.length ? `; must keep: ${reference.must_keep.join(", ")}` : ""}${reference.flaw ? `; its fixed flaw, ${reference.flaw}, is in every shot it is in, on the same side: a shot that loses or moves it has drifted` : ""}`);
  }
  const shotLines = shotListLines(shots);
  if (shotLines.length) lines.push("", "The shot list (who is in each shot, what is said, the poses planned):", ...shotLines);
  if (!staging) lines.push(...await directionLines(project));
  if (rules && String(rules).trim()) lines.push("", `${RULES_HEADING.replace(/^## /, "")}. A breach you can see is a finding:`, "", String(rules).trim().slice(0, 8000));
  const shownSamples = new Set(sheets.flatMap((sheet) => sheet.samples ?? []));
  const reviewed = (manifest.entries ?? []).filter((entry) => shownSamples.has(entry.sample_id)).map((entry) => entry.evidence_id);
  const known = new Set((manifest.entries ?? []).map((entry) => entry.evidence_id));
  const warnings = [];
  const cite = (ids, label) => {
    const cited = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (known.has(id)) cited.push(id);
      else if (bySample.has(id)) cited.push(...bySample.get(id).map((entry) => entry.evidence_id));
      else warnings.push(`finding ${label} cited unknown evidence id ${id}; dropped`);
    }
    return [...new Set(cited.length ? cited : reviewed.slice(0, 2))];
  };
  const allowed = staging ? STAGING_CATEGORIES : CRITIC_CATEGORIES;
  const inRubric = (finding) => {
    if (allowed.includes(finding?.category)) return true;
    // A model without strict schemas can answer outside the rubric.
    warnings.push(`finding ${finding?.id ?? "?"} has category ${finding?.category ?? "none"}, which ${staging ? "the staging review does not judge" : "is not in the rubric"}; dropped`);
    return false;
  };
  const asFinding = (finding, i, prefix = "f") => ({ id: String(finding.id || `${prefix}${i + 1}`), severity: finding.severity, category: finding.category, message: String(finding.message ?? ""), evidence_ids: cite(finding.evidence_ids, finding.id ?? i + 1) });
  const usages = [];
  const call = async (request) => {
    const result = await client.runStructured({ images, maxOutputTokens: 6000, ...request });
    usages.push(result);
    return result;
  };
  // The verdict pass scores only what could block: a prior with no blocking or major finding (or a recapture) gets a fresh review.
  const scored = !staging && prior?.verdict !== "recapture" ? (prior?.findings ?? []).filter((finding) => finding?.severity === "blocking" || finding?.severity === "major") : [];
  let result;
  let value;
  try {
    if (scored.length) {
      const listed = ["", "The findings to score (from the review of the earlier cut):", ...scored.map((finding) => `  ${finding.id}  ${finding.severity} ${finding.category}: ${finding.message}`)];
      result = await call({ instructions: VERDICT_INSTRUCTIONS, input: `${lines.join("\n")}\n${listed.join("\n")}\n`, schema: VERDICT_PASS_SCHEMA, schemaName: "launchclip_make_critic_verdict" });
    } else {
      result = await call({ instructions: staging ? STAGING_INSTRUCTIONS : INSTRUCTIONS, input: `${lines.join("\n")}\n`, schema: staging ? STAGING_CRITIC_SCHEMA : MAKE_CRITIC_SCHEMA, schemaName: staging ? "launchclip_animatic_review" : "launchclip_make_critic" });
    }
  } catch (error) {
    return { status: "failed", reason: `critic model call failed: ${String(error?.message ?? error).split("\n")[0]}` };
  }
  value = result?.value ?? parseText(result?.text);
  let findings;
  let verdict;
  let template = null;
  let verdictPass = null;
  if (scored.length) {
    if (!value || !Array.isArray(value.scores)) return { status: "failed", reason: "the verdict pass returned no scores" };
    const scores = scored.map((finding) => {
      const answer = value.scores.find((score) => score?.id === finding.id);
      // An unscored finding is not resolved: only the new sheets can clear it.
      const status = VERDICT_SCORES.includes(answer?.status) ? answer.status : "unresolved";
      return { id: finding.id, status, evidence_ids: cite(answer?.evidence_ids, finding.id), note: String(answer?.note ?? "") };
    });
    findings = scores.filter((score) => score.status !== "resolved").map((score) => {
      const finding = scored.find((entry) => entry.id === score.id);
      return { id: finding.id, severity: finding.severity, category: finding.category, message: `${score.status}: ${finding.message}${score.note ? ` (${score.note})` : ""}`, evidence_ids: score.evidence_ids, status: score.status };
    });
    const regressions = (Array.isArray(value.regressions) ? value.regressions : []).filter(inRubric);
    if (regressions.length > MAX_REGRESSIONS) warnings.push(`the verdict pass named ${regressions.length} regressions; the first ${MAX_REGRESSIONS} are kept`);
    findings.push(...regressions.slice(0, MAX_REGRESSIONS).map((finding, i) => ({ ...asFinding(finding, i, "r"), regression: true })));
    verdict = findings.some((finding) => finding.severity === "blocking" || finding.severity === "major") ? "repair" : "ship";
    verdictPass = { prior_verdict: prior.verdict ?? null, scores };
  } else {
    const verdicts = staging ? CRITIC_VERDICTS.slice(0, 3) : CRITIC_VERDICTS;
    if (!value || !verdicts.includes(value.verdict)) return { status: "failed", reason: "the critic returned no valid verdict" };
    findings = (Array.isArray(value.findings) ? value.findings : []).filter(inRubric).map((finding, i) => asFinding(finding, i));
    verdict = value.verdict;
    if (!staging && value.template && typeof value.template === "object") template = { swappable: Boolean(value.template.swappable), why: String(value.template.why ?? "") };
  }
  const keep = (Array.isArray(value.keep) ? value.keep : scored.length ? prior?.keep ?? [] : []).map(String).filter((line) => line.trim()).slice(0, MAX_KEEP);
  const coverage = toolingFindings(quality, manifest.entries ?? [], reviewed);
  findings.push(...coverage);
  // Pass B: the critic, with its own findings in hand, marks each tooling finding.
  const tooling = staging ? [] : [
    ...coverage.map((finding) => ({ id: finding.id, source: "coverage", rule: finding.category, severity: finding.severity, at: Number(quality[Number(finding.id.slice(1)) - 1]?.at ?? 0), message: finding.message })),
    ...(tells ?? []).map((finding, i) => ({ id: `t${i + 1}`, source: "tells", rule: finding.rule, severity: finding.severity, at: Number(finding.at ?? 0), message: String(finding.detail ?? "") }))
  ];
  let toolingChecks = [];
  if (tooling.length) {
    const own = findings.filter((finding) => !finding.source).map((finding) => `  ${finding.id}  ${finding.severity} ${finding.category}: ${finding.message}`);
    const input = [...sheetLines, "", "Your findings:", ...(own.length ? own : ["  none"]), "", "The tooling findings to check:", ...tooling.map((entry) => `  ${entry.id}  ${entry.rule} (${entry.severity}) at ${entry.at} s: ${entry.message}`)].join("\n");
    let checks = null;
    try {
      const answer = await call({ instructions: TOOLING_INSTRUCTIONS, input: `${input}\n`, images: images.slice(0, sheetCount + (existsSync(overview) ? 1 : 0)), schema: TOOLING_CHECK_SCHEMA, schemaName: "launchclip_make_critic_check", maxOutputTokens: 3000 });
      checks = (answer?.value ?? parseText(answer?.text))?.checks;
    } catch (error) {
      warnings.push(`the tooling check (pass B) failed: ${String(error?.message ?? error).split("\n")[0]}; the tooling findings stand unchecked`);
    }
    toolingChecks = tooling.map((entry) => {
      const answer = Array.isArray(checks) ? checks.find((check) => check?.id === entry.id) : null;
      return { ...entry, check: TOOLING_CHECKS.includes(answer?.check) ? answer.check : "unchecked", ...(answer?.note ? { note: String(answer.note) } : {}) };
    });
  }
  const blocking = findings.some((finding) => finding.severity === "blocking" || finding.severity === "major");
  if (verdict === "ship" && blocking) { verdict = "repair"; warnings.push("the critic said ship with blocking or major findings; recorded as repair"); }
  if (!staging && missing.length && verdict === "ship") { verdict = "recapture"; warnings.push(`the evidence is partial (${missing.slice(0, 3).join("; ")}); a partial set of sheets cannot ship, recorded as recapture`); }
  const critique = {
    verdict,
    summary: String(value.summary ?? ""),
    ...(template ? { template } : {}),
    findings,
    ...(staging ? {} : { keep }),
    ...(verdictPass ? { verdict_pass: verdictPass } : {}),
    ...(toolingChecks.length ? { tooling_checks: toolingChecks } : {}),
    ...(missing.length ? { missing_evidence: missing } : {}),
    evidence_ids_reviewed: reviewed,
    reviewer: { kind: staging ? "launchclip-animatic-staging-review" : "launchclip-make-headless-critic", review, ...(staging ? {} : { pass: verdictPass ? "verdict" : "judge" }), model: result?.model ?? model, sheets: sheets.map((sheet) => sheet.sheet), ...(references.length ? { reference_sheets: references.map((reference) => ({ character: reference.character, file: reference.file })) } : {}), note: staging ? "Reviewed the animatic's contact sheets for story, staging and acting only (no audio, no full-motion playback, no polish)." : "Reviewed contact sheets only (no audio, no full-motion playback)." }
  };
  const file = path.join(project, staging ? ANIMATIC_REVIEW_FILE : CRITIC_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(critique, null, 2)}\n`);
  const usage = sumUsage(usages.map((entry) => entry?.usage ?? {}));
  const cost = usages.reduce((sum, entry) => sum + (estimateModelUsageCost(provider ?? client?.provider ?? "openai", entry?.model ?? model, entry?.usage ?? {}).estimated_usd ?? 0), 0);
  const unreviewed = [...known].filter((id) => !reviewed.includes(id));
  if (unreviewed.length) warnings.push(`${unreviewed.length} evidence id(s) were on sheets past --critic's sheet limit and were not reviewed`);
  return { status: "written", file, review, critique, verdict, findings: findings.length, keep, reviewed: reviewed.length, unreviewed: unreviewed.length, reference_sheets: references.map((reference) => reference.file), warnings, usage, cost_usd: cost, model: result?.model ?? model };
}

// The token counts of several calls, added field by field.
function sumUsage(list) {
  const out = {};
  for (const usage of list) for (const [key, value] of Object.entries(usage ?? {})) if (typeof value === "number") out[key] = (out[key] ?? 0) + value;
  return out;
}

// The storyboard's art direction and motion thesis (VIDEO_TELLS_RFC §3), as the critic reads them.
async function directionLines(project) {
  let story = null;
  try { story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8")); } catch { return []; }
  const out = [];
  if (story?.direction && typeof story.direction === "object") out.push("", "The art direction (the video should fit only this subject):", `  ${JSON.stringify(story.direction)}`);
  if (story?.motion?.thesis && typeof story.motion.thesis === "object") out.push("", "The motion thesis:", `  ${JSON.stringify(story.motion.thesis)}`);
  return out;
}

/**
 * The staging review of the animatic (§4.4): the critic over the animatic's
 * evidence for story, staging and acting, written to qa/animatic-critic.json,
 * with the verdict recorded in ANIMATIC.json's `review`. Takes
 * runHeadlessCritic's options; `critic` replaces the model call (tests, a host).
 * → runHeadlessCritic's result, plus `animatic` (the updated ANIMATIC.json, or null).
 */
export async function reviewAnimatic({ critic = runHeadlessCritic, ...options } = {}) {
  const result = await critic({ ...options, review: "animatic" });
  if (result.status !== "written") return result;
  const animatic = await recordAnimaticReview(options.project, { verdict: result.verdict });
  return { ...result, animatic };
}

/**
 * The reference sheets of the project's show bible that are on disk:
 * [{character, name, file (project-relative), must_keep, flaw}]. Empty with no bible.
 */
export async function bibleReferenceSheets(project) {
  let bible = null;
  try { bible = JSON.parse(await readFile(path.join(project, "BIBLE.json"), "utf8")); } catch { return []; }
  const cast = Array.isArray(bible?.cast) ? bible.cast : Array.isArray(bible?.cast?.characters) ? bible.cast.characters : [];
  return cast
    .filter((entry) => entry && typeof entry.id === "string" && typeof entry.sheet === "string" && !path.isAbsolute(entry.sheet) && !entry.sheet.split(/[\\/]/).includes("..") && existsSync(path.join(project, entry.sheet)))
    .map((entry) => ({ character: entry.id, name: String(entry.name ?? entry.id), file: entry.sheet, must_keep: Array.isArray(entry.must_keep) ? entry.must_keep.map(String) : [], flaw: FLAW_WORDS[entry.flaw] ?? null }));
}

// The shot list as the critic reads it: one line per shot, then what is said.
function shotListLines(shots) {
  const out = [];
  for (const shot of Array.isArray(shots) ? shots : []) {
    out.push(`  ${shot.id}  ${shot.start}–${shot.end} s  ${shot.framing ? `${shot.framing} shot, ` : ""}${shot.set ? `set ${shot.set}, ` : ""}who: ${(shot.who ?? []).join(", ") || "nobody"}`);
    for (const [who, poses] of Object.entries(shot.poses ?? {})) if (poses?.length) out.push(`    ${who}: ${poses.map((pose) => `${pose.at} ${pose.pose}${pose.expression ? `, ${pose.expression}` : ""}`).join(" → ")}`);
    for (const line of shot.lines ?? []) out.push(`    ${line.start}–${line.end}  ${line.speaker ?? "?"}${line.on_screen === false && line.speaker && line.speaker !== "narrator" ? " (off screen)" : ""}: "${line.text}"`);
  }
  return out;
}

/**
 * The coverage gate's findings in critic.json form, each citing the
 * evidence entries of the sample nearest its time (citations must exist).
 */
export function toolingFindings(quality, entries, reviewed = []) {
  return (quality ?? []).map((finding, index) => {
    const nearest = [...entries].filter((entry) => Number.isFinite(Number(entry.at_seconds))).sort((a, b) => Math.abs(Number(a.at_seconds) - Number(finding.at)) - Math.abs(Number(b.at_seconds) - Number(finding.at)))[0];
    const cited = nearest ? entries.filter((entry) => (entry.sample_id ?? entry.evidence_id) === (nearest.sample_id ?? nearest.evidence_id)).map((entry) => entry.evidence_id) : reviewed.slice(0, 2);
    return { id: `q${index + 1}`, severity: finding.severity ?? "major", category: finding.category, message: finding.message, evidence_ids: [...new Set(cited.length ? cited : reviewed.slice(0, 2))], source: "direction map and storyboard (launchclip finish coverage gate)" };
  });
}

async function dataUrl(file) {
  const ext = path.extname(file).toLowerCase();
  const type = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${type};base64,${(await readFile(file)).toString("base64")}`;
}

function parseText(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
