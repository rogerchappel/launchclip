// The research stage inside `launchclip make` (--research on), motion lane:
// before the script pass the brief (prompt plus notes) is researched into
// <project>/research/, and the script pass gets researchNotes(): verified
// claims, what the primary sources state, and what not to state. After the
// script, its narration is audited against the ledger; anything the ledger
// does not back is a warning and holds the research gate at pending, so the
// video is ready for review rather than ready.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditScript, researchNotes, runResearch } from "./index.js";
import { RESEARCH_PATHS } from "./schema.js";

export const RESEARCH_MODES = Object.freeze(["on", "off"]);

/** --research on|off (default off: the stage makes network calls and takes a while). */
export function researchMode(value) {
  if (value == null || value === false) return "off";
  const mode = value === true ? "on" : String(value).toLowerCase();
  if (!RESEARCH_MODES.includes(mode)) throw new Error(`--research must be on or off; got ${value}`);
  return mode;
}

/**
 * Runs (or reuses) research for the brief. → {notes, ledger} or null when off.
 * ctx: make's context ({project, text, report, state, say, adapters, model}).
 */
export async function researchBrief(ctx, briefNotes = []) {
  if (researchMode(ctx.options.research) === "off") return null;
  const { project, report, state } = ctx;
  const dir = path.join(project, RESEARCH_PATHS.dir);
  const brief = [`# Brief`, "", ctx.text, ...briefNotes.map((note) => `\n${note}`)].join("\n");
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
  return { notes: researchNotes(ledger), ledger };
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
