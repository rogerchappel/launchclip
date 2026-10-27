import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runResearch } from "../src/research/index.js";

// The dry run on a real release (scripts/research-fixture.mjs recorded it):
// replaying its HTTP responses must rebuild the committed files exactly.
const FIXTURE = path.join(import.meta.dirname, "fixtures", "research", "deepseek-v4-1-flash");

test("the DeepSeek-V4.1-Flash-1017 dry run replays to the committed ledger, captures, data and assets", async () => {
  const recording = JSON.parse(await readFile(path.join(FIXTURE, "recording.json"), "utf8"));
  const fetch = async (url, init = {}) => {
    const hit = recording.responses.find((entry) => entry.url === url && entry.method === (init.method ?? "GET"));
    if (!hit) return new Response("", { status: 404 });
    return new Response(hit.body, { status: hit.status, headers: { "content-type": hit.content_type ?? "" } });
  };
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-research-"));
  const report = await runResearch(path.join(FIXTURE, "script.md"), { out, media: recording.media, now: recording.recorded_at, cwd: FIXTURE }, { fetch, env: {} });
  const committed = path.join(FIXTURE, "research");
  for (const file of ["evidence.json", "assets.json", "RESEARCH.md"]) {
    assert.equal(await readFile(path.join(out, file), "utf8"), await readFile(path.join(committed, file), "utf8"), file);
  }
  for (const dir of ["captures", "data"]) {
    const names = (await readdir(path.join(committed, dir))).sort();
    assert.deepEqual((await readdir(path.join(out, dir))).sort(), names, dir);
    for (const name of names) assert.equal(await readFile(path.join(out, dir, name), "utf8"), await readFile(path.join(committed, dir, name), "utf8"), `${dir}/${name}`);
  }
  // The seeded errors in script.md are caught, and the honest claims verify.
  assert.deepEqual(report.flagged.map((claim) => [claim.id, claim.status]), [["c005", "contradicted"], ["c007", "contradicted"], ["c008", "unverified"]]);
  assert.equal(report.summary.verified, 5);
});

test("script-pass hooks: notes list only sourced facts, and the audit catches what the ledger does not back", async () => {
  const { auditScript, researchNotes } = await import("../src/research/index.js");
  const ledger = JSON.parse(await readFile(path.join(FIXTURE, "research", "evidence.json"), "utf8"));
  const notes = researchNotes(ledger);
  assert.match(notes, /Verified claims:\n- \[c001\]/);
  assert.match(notes, /Facts from primary sources:/);
  assert.match(notes, /Do not state these as fact[\s\S]*\[contradicted\] On Terminal-Bench 4\.0/);
  const audit = auditScript("DeepSeek-V4.1-Flash-1017 scores 42.3 on Terminal-Bench 4.0, up from 31.2. It was trained on 40 trillion tokens. It runs on 3 million phones.", ledger);
  assert.deepEqual(audit.claims.map((claim) => claim.status), ["verified", "contradicted", "unverified"]);
  assert.equal(audit.ok, false);
});
