// Headless critic for `launchclip make --critic` (src/make/index.js).
//
// After finish has written qa/temporal-evidence/manifest.json and
// qa/critic-sheets/ (build-evidence.mjs), a vision-capable model reviews the
// sheets and the overview strip and writes qa/critic.json in the cinematic
// format (skills-src/references/cinematic-production.md):
//   {verdict: ship|repair|replan, summary, findings: [{id, severity, category,
//    message, evidence_ids}], evidence_ids_reviewed}
// evidence_ids_reviewed is set by tooling: every manifest entry whose sample
// sits on a sheet the model was shown. Finding citations are checked against
// the manifest; a cited sample id expands to its two evidence ids, and an
// unknown id is dropped with a warning (a finding left with none is kept and
// cites the sheet's samples, so the citation gate still has evidence).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { RULES_HEADING } from "./script.js";
import { estimateModelUsageCost } from "../cost_tracker.js";

// The rubric (VIDEO_QUALITY_RFC §11.3): the craft categories, plus
// missed-opportunity (a line whose intent calls for a visual has none),
// sparseness (a run longer than the profile allows), brand-consistency (a
// scene that breaks the style or the brand frame), and for character stories
// acting (a pose or expression that does not match its line, or a character
// holding still while the story moves) and character-consistency (a character
// that looks different between shots).
export const CRITIC_CATEGORIES = Object.freeze(["narrative", "composition", "typography", "motion", "asset", "timing", "audio", "mount", "factual", "missed-opportunity", "sparseness", "brand-consistency", "acting", "character-consistency"]);

export const MAKE_CRITIC_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "findings"],
  properties: {
    verdict: { type: "string", enum: ["ship", "repair", "replan"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "severity", "category", "message", "evidence_ids"],
        properties: {
          id: { type: "string" },
          severity: { type: "string", enum: ["blocking", "major", "minor"] },
          category: { type: "string", enum: CRITIC_CATEGORIES },
          message: { type: "string" },
          evidence_ids: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
});

const INSTRUCTIONS = `You are a fresh-context motion-design critic reviewing a rendered draft from contact sheets.

Each sheet shows samples in time order, as pairs of tiles: left = the renderer's browser still, right = the same moment decoded from the encoded draft. The overview strip shows one frame every 1.5 s.

Judge what the pixels show: hook clarity, legibility on a phone, typography, hierarchy and composition, clipped or overlapping content, empty or near-identical frames, continuity across transitions, whether real product media (screenshots, recordings, logos) is used well, and whether the left and right tiles match (an encode defect if not).

Judge density and style too, not only polish:
- missed-opportunity: a line whose intent calls for a visual (a claim, a number, a list, a process, the product, proof, a quote, the hook or the call to action) plays with nothing on screen but the presenter.
- sparseness: a long stretch with no designed graphic, past what the format allows.
- brand-consistency: a scene that breaks the style (palette, type, caption treatment) or drops the brand frame the other scenes carry.
- acting and character-consistency (character stories only): a pose or expression that does not match its line, a character holding still while the story moves, or a character who looks different between shots.

Rules:
- Cite evidence ids exactly as listed for the tiles you are describing. Every finding needs at least one.
- Do not invent defects in moments you were not shown. Do not judge audio; you cannot hear it.
- verdict "ship" only with no blocking or major findings; "repair" for fixable scene-level problems; "replan" when the story or structure is wrong.
- Keep each message actionable: what is wrong, where, and the smallest fix.

Return only the JSON object.`;

/**
 * options: {project, client, model, provider, maxSheets (default 12),
 * quality: the findings finish's coverage gate proved from the direction map
 * and the storyboard ([{category, severity, at, message}], src/quality_gates.js).
 * They go to the model as known facts and into qa/critic.json as tooling
 * findings, each citing the evidence sample nearest its time.}
 * → {status: "written"|"skipped"|"failed", file, verdict, findings, reviewed, warnings, usage, cost_usd, reason?}
 */
export async function runHeadlessCritic({ project, client, model = null, provider = null, maxSheets = 12, quality = [], rules = null } = {}) {
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
  for (const sheet of sheets) {
    const file = path.join(project, "qa/critic-sheets", sheet.sheet);
    if (!existsSync(file)) continue;
    images.push({ url: await dataUrl(file), detail: "high" });
    lines.push(`Sheet ${images.length} (${sheet.sheet}), tiles left to right, top to bottom:`);
    for (const sample of sheet.samples ?? []) {
      for (const entry of bySample.get(sample) ?? []) lines.push(`  ${entry.evidence_id}  (${entry.source}, ${entry.role ?? "sample"} at ${entry.at_seconds}s${entry.boundary_id ? `, boundary ${entry.boundary_id}` : ""})`);
    }
  }
  const overview = path.join(project, "qa/critic-sheets/overview-every-1.5s.jpg");
  if (existsSync(overview)) { images.push({ url: await dataUrl(overview), detail: "low" }); lines.push(`Image ${images.length}: the overview strip (context only; cite the sheet tiles)`); }
  if (!images.length) return { status: "skipped", reason: "no critic sheet images were found" };
  if (quality.length) {
    lines.push("", "Measured from the direction map and the storyboard (already proven; look for more of the same, and do not repeat these):");
    for (const finding of quality) lines.push(`  ${finding.category} at ${finding.at} s: ${finding.message}`);
  }
  if (rules && String(rules).trim()) lines.push("", `${RULES_HEADING.replace(/^## /, "")}. A breach you can see is a finding:`, "", String(rules).trim().slice(0, 8000));
  const shownSamples = new Set(sheets.flatMap((sheet) => sheet.samples ?? []));
  const reviewed = (manifest.entries ?? []).filter((entry) => shownSamples.has(entry.sample_id)).map((entry) => entry.evidence_id);
  const known = new Set((manifest.entries ?? []).map((entry) => entry.evidence_id));
  let result;
  try {
    result = await client.runStructured({ instructions: INSTRUCTIONS, input: `${lines.join("\n")}\n`, images, schema: MAKE_CRITIC_SCHEMA, schemaName: "launchclip_make_critic", maxOutputTokens: 6000 });
  } catch (error) {
    return { status: "failed", reason: `critic model call failed: ${String(error?.message ?? error).split("\n")[0]}` };
  }
  const value = result?.value ?? parseText(result?.text);
  if (!value || !["ship", "repair", "replan"].includes(value.verdict)) return { status: "failed", reason: "the critic returned no valid verdict" };
  const warnings = [];
  const findings = (Array.isArray(value.findings) ? value.findings : []).map((finding, i) => {
    const cited = [];
    for (const id of Array.isArray(finding.evidence_ids) ? finding.evidence_ids : []) {
      if (known.has(id)) cited.push(id);
      else if (bySample.has(id)) cited.push(...bySample.get(id).map((entry) => entry.evidence_id));
      else warnings.push(`finding ${finding.id ?? i + 1} cited unknown evidence id ${id}; dropped`);
    }
    return { id: String(finding.id || `f${i + 1}`), severity: finding.severity, category: finding.category, message: String(finding.message ?? ""), evidence_ids: [...new Set(cited.length ? cited : reviewed.slice(0, 2))] };
  });
  findings.push(...toolingFindings(quality, manifest.entries ?? [], reviewed));
  const blocking = findings.some((finding) => finding.severity === "blocking" || finding.severity === "major");
  let verdict = value.verdict;
  if (verdict === "ship" && blocking) { verdict = "repair"; warnings.push("the critic said ship with blocking or major findings; recorded as repair"); }
  const critique = {
    verdict,
    summary: String(value.summary ?? ""),
    findings,
    evidence_ids_reviewed: reviewed,
    reviewer: { kind: "launchclip-make-headless-critic", model: result?.model ?? model, sheets: sheets.map((sheet) => sheet.sheet), note: "Reviewed contact sheets only (no audio, no full-motion playback)." }
  };
  const file = path.join(project, "qa/critic.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(critique, null, 2)}\n`);
  const usage = result?.usage ?? {};
  const cost = estimateModelUsageCost(provider ?? client?.provider ?? "openai", result?.model ?? model, usage);
  const unreviewed = [...known].filter((id) => !reviewed.includes(id));
  if (unreviewed.length) warnings.push(`${unreviewed.length} evidence id(s) were on sheets past --critic's sheet limit and were not reviewed`);
  return { status: "written", file, verdict, findings: findings.length, reviewed: reviewed.length, unreviewed: unreviewed.length, warnings, usage, cost_usd: cost.estimated_usd, model: result?.model ?? model };
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
