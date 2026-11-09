// The research stage inside `launchclip make`, motion lane. --research auto
// (the default) researches a brief that is news or research shaped
// (src/research/auto.js); on always does, off never does. Before the script pass the brief (prompt plus notes, without their
// direction sections) is researched into
// <project>/research/, and the script pass gets researchNotes(): verified
// claims, what the primary sources state, and what not to state. After the
// script, its narration is audited against the ledger; anything the ledger
// does not back is a warning and holds the research gate at pending, so the
// video is ready for review rather than ready.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { autoResearch } from "./auto.js";
import { auditScript, researchNotes, runResearch } from "./index.js";
import { CAPTURE_STATUS_FILE, captureStatus, captureStatusLines, gateWithCaptures } from "./capture_status.js";
import { RESEARCH_PATHS } from "./schema.js";

export const RESEARCH_MODES = Object.freeze(["auto", "on", "off"]);

/** --research auto|on|off (default auto: on for a news or research shaped brief, off otherwise). */
export function researchMode(value) {
  if (value == null) return "auto";
  if (value === false) return "off";
  const mode = value === true ? "on" : String(value).toLowerCase();
  if (!RESEARCH_MODES.includes(mode)) throw new Error(`--research must be auto, on or off; got ${value}`);
  return mode;
}

/**
 * Whether this run researches its brief, decided once and written to the
 * report as research_decision: {mode, run, reason, signals}. on and off are
 * the user's word; auto reads the brief (prompt plus notes).
 */
export function researchDecision(ctx, briefNotes = []) {
  if (ctx.researchDecision) return ctx.researchDecision;
  const mode = researchMode(ctx.options?.research);
  const lane = ctx.routing?.lane ?? "motion";
  let decision;
  if (mode === "off") decision = { run: false, reason: "--research off", signals: [] };
  else if (mode === "on") decision = { run: true, reason: lane === "motion" ? "--research on" : `--research on: the ${lane} lane takes its words from the recording, so nothing new is researched; capture requests already in ${RESEARCH_PATHS.dir}/ are recorded`, signals: [] };
  // Outside the motion lane nothing is researched, but research the user ran into the project beforehand is used.
  else if (lane !== "motion") decision = ctx.project && existsSync(path.join(ctx.project, RESEARCH_PATHS.dir, RESEARCH_PATHS.captures))
    ? { run: true, reason: `the project already holds ${RESEARCH_PATHS.dir}/${RESEARCH_PATHS.captures} (from launchclip research); its capture requests are recorded`, signals: [] }
    : { run: false, reason: `the ${lane} lane takes its words from the supplied recording, and research checks a script before it is written`, signals: [] };
  else decision = autoResearch({ text: [ctx.text, ...briefNotes].map(withoutDirection).join("\n\n"), lane, media: ctx.routing?.media?.length ?? 0 });
  ctx.researchDecision = { mode, ...decision };
  if (ctx.report) ctx.report.research_decision = ctx.researchDecision;
  ctx.say?.(`research: ${decision.run ? "on" : "off"}${mode === "auto" ? " (auto)" : ""}: ${decision.reason}`);
  return ctx.researchDecision;
}

/** Whether research ran or will run for this make (src/make/index.js asks before reading the ledger and captures). */
export function researchEnabled(ctx) {
  return researchDecision(ctx).run;
}

/**
 * Runs (or reuses) research for the brief. → {notes, ledger} or null when off.
 * ctx: make's context ({project, text, report, state, say, adapters, model}).
 */
export async function researchBrief(ctx, briefNotes = []) {
  if (!researchDecision(ctx, briefNotes).run) return null;
  const { project, report, state } = ctx;
  const dir = path.join(project, RESEARCH_PATHS.dir);
  const brief = [`# Brief`, "", withoutDirection(ctx.text), ...briefNotes.map((note) => `\n${withoutDirection(note)}`)].join("\n");
  const hash = createHash("sha256").update(brief).digest("hex").slice(0, 16);
  const ledgerFile = path.join(dir, RESEARCH_PATHS.ledger);
  let summary;
  if (state.research?.hash === hash && existsSync(ledgerFile)) {
    summary = { reused: true };
  } else {
    await mkdir(dir, { recursive: true });
    const briefFile = path.join(dir, "brief.md");
    await writeFile(briefFile, `${brief}\n`);
    ctx.say("research: checking the brief's claims against primary sources (public APIs; web search only with a key)");
    const result = await (ctx.adapters.research ?? runResearch)(briefFile, { out: dir, cwd: project }, { env: ctx.env, fetch: ctx.adapters.fetch, log: ctx.say });
    summary = result.summary;
    state.research = { hash };
  }
  const ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
  report.research = { dir: RESEARCH_PATHS.dir, ledger: path.join(RESEARCH_PATHS.dir, RESEARCH_PATHS.ledger), summary: ledger.summary, reused: Boolean(summary.reused) };
  for (const claim of ledger.claims.filter((entry) => entry.status !== "verified")) report.warnings.push(`research: the brief's claim "${claim.text}" is ${claim.status}: ${claim.flag?.message ?? ""}`);
  // Old news in a brief that asks for the latest (the ledger's freshness window).
  for (const claim of ledger.claims.filter((entry) => entry.status === "verified" && (entry.stale || entry.undated) && !entry.headline)) report.warnings.push(`research: the brief's claim "${claim.text}" is ${claim.stale ? "old news" : "undated"}: ${claim.flag?.message ?? ""}`);
  return { notes: researchNotes(ledger), ledger };
}

// A brief's direction sections ("## Direction", "## House style", "## Style",
// "## Instructions", "## Rules", "# Brand voice", "## Copy brief",
// "## Guardrails") tell the writer how to write; they state nothing to check,
// and researching them searches for "CTA", "AI sounding" and "carousel/image".
// "# Brand facts" is the brand's own account of itself: the script states it
// as the brand's, so research does not mark it unverified either.
const DIRECTION_HEADING = /^#{1,6}\s+(?:direction|house style|style|instructions|rules|brand voice|copy ?brief|(?:brand )?guardrails|brand facts)\b/i;

/** The brief without its direction sections: up to the next heading of the same or a higher level. */
export function withoutDirection(text) {
  const out = [];
  let skipping = 0;
  for (const line of String(text ?? "").split("\n")) {
    const heading = line.trim().match(/^(#{1,6})\s+/);
    if (heading && skipping && heading[1].length <= skipping) skipping = 0;
    if (!skipping && heading && DIRECTION_HEADING.test(line.trim())) { skipping = heading[1].length; continue; }
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The final narration against the ledger → the research gate. */
export function auditNarration(ctx, research, narration) {
  if (!research) return;
  const audit = auditScript(narration, research.ledger);
  const unbacked = audit.claims.filter((claim) => claim.status !== "verified" && claim.status !== "sourced");
  ctx.report.research = { ...ctx.report.research, audit: { ok: audit.ok, claims: audit.claims.length, unbacked: unbacked.map((claim) => ({ text: claim.text, status: claim.status })) } };
  for (const claim of unbacked) ctx.report.warnings.push(`research: the script says "${claim.text}", which the sources ${claim.status === "contradicted" ? "contradict" : "do not back"}; cut, soften or source it (research/RESEARCH.md)`);
  ctx.researchGate = audit.ok
    ? { status: "passed", reason: `every claim in the narration is backed by ${RESEARCH_PATHS.dir}/${RESEARCH_PATHS.ledger}` }
    : { status: "pending", reason: `${unbacked.length} claim(s) in the narration are not backed by a source`, claims: unbacked.map((claim) => claim.text) };
}

/**
 * After make's captures settle: which verified claims have no page to show
 * and why, in the report (captures.status, .missing, .claims_without_capture),
 * in research/capture-status.json, as warnings with the fix, and in the
 * research gate (missing captures hold it at pending).
 * result: recordCaptures' {recorded, failed}; requests: every capture request.
 */
export async function noteCaptures(ctx, result, requests) {
  if (!result) return null;
  const dir = path.join(ctx.project, RESEARCH_PATHS.dir);
  let ledger = null;
  try { ledger = JSON.parse(await readFile(path.join(dir, RESEARCH_PATHS.ledger), "utf8")); } catch { /* captures without a ledger are still counted */ }
  const status = captureStatus(ledger, requests, result);
  ctx.report.captures = { ...ctx.report.captures, status: status.status, missing: status.missing, claims_without_capture: status.claims_without_capture, file: `${RESEARCH_PATHS.dir}/${CAPTURE_STATUS_FILE}` };
  await writeFile(path.join(dir, CAPTURE_STATUS_FILE), `${JSON.stringify(status, null, 2)}\n`).catch(() => {});
  for (const line of captureStatusLines(status)) {
    ctx.report.warnings.push(`captures: ${line}`);
    ctx.say?.(`captures: ${line}`);
  }
  ctx.researchGate = gateWithCaptures(ctx.researchGate, status);
  return status;
}
