// launchclip research capture [research-dir] [--root .]: record every capture
// request research wrote, say plainly what could not be recorded and why, and
// attach the evidence data the recorded clips give. The same recorder `make`
// uses (src/make/captures.js), so an agent that ran `launchclip research`
// itself ends with the same files as a headless run.
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordCaptures } from "../make/captures.js";
import { CAPTURE_STATUS_FILE, captureStatus, captureStatusLines } from "./capture_status.js";
import { writeResearchEvidence } from "./evidence_data.js";
import { RESEARCH_PATHS } from "./schema.js";

/**
 * options: {root (the project the clips go under; default: the research dir's parent), command (--capture-cmd),
 *   concurrency, cwd}; adapters: {capture, spawn, env, log, attach}
 * → {stage, status, dir, root, requested, recorded, missing, captures, claims_without_capture, lines, file, evidence_data}
 */
export async function captureResearch(dir = RESEARCH_PATHS.dir, options = {}, adapters = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const researchDir = path.resolve(cwd, String(dir));
  const ledgerFile = path.join(researchDir, RESEARCH_PATHS.ledger);
  if (!existsSync(ledgerFile)) throw new Error(`no ${RESEARCH_PATHS.ledger} in ${researchDir}: run launchclip research first`);
  const root = path.resolve(cwd, String(options.root ?? path.dirname(researchDir)));
  const log = adapters.log ?? (() => {});
  const ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
  const requests = await readRequests(path.join(researchDir, RESEARCH_PATHS.captures));
  const result = requests.length
    ? await recordCaptures(requests, { project: root, command: options.command, concurrency: options.concurrency, capture: adapters.capture, spawn: adapters.spawn, env: adapters.env, say: log })
    : { recorded: [], failed: [], reused: 0 };
  const status = captureStatus(ledger, requests, result);
  const file = path.join(researchDir, CAPTURE_STATUS_FILE);
  await writeFile(file, `${JSON.stringify(status, null, 2)}\n`);
  const lines = captureStatusLines(status);
  for (const line of lines) log(`captures: ${line}`);
  // Post cards and PR cards read the recorded clips' sidecars.
  const attached = status.recorded ? await (adapters.attach ?? writeResearchEvidence)(researchDir, { root }).catch((error) => ({ error: error.message })) : null;
  return { stage: "research-capture", status: status.status, dir: researchDir, root, requested: status.requested, recorded: status.recorded, reused: result.reused ?? 0, missing: status.missing, captures: status.captures, claims_without_capture: status.claims_without_capture, lines, file, ...(attached ? { evidence_data: attached.report ?? attached } : {}) };
}

async function readRequests(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    try { out.push(JSON.parse(await readFile(path.join(dir, name), "utf8"))); } catch { /* a broken request is skipped */ }
  }
  return out;
}
