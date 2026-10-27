import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runMake } from "../src/make/index.js";
import { validateMakeOptions } from "../src/make/options.js";
import { auditNarration, researchMode } from "../src/research/make.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const LEDGER = {
  schema: "launchclip.evidence.v1",
  summary: { claims: 2, verified: 1, contradicted: 0, unverified: 1, sources_checked: 1, primary_sources: 1, web_search: null },
  excerpts: [{ text: "Ledgerly matches each Stripe payout to its invoice within 2 minutes.", url: "https://ledgerly.example/docs", publisher: "Ledgerly" }],
  claims: [
    { id: "c001", text: "Ledgerly reconciles Stripe payouts automatically.", kind: "entity", status: "verified", confidence: 0.9, values: [], entities: [], sources: [{ url: "https://ledgerly.example/docs", publisher: "Ledgerly", primary: true, supports: true, confidence: 0.9, quote: { text: "Ledgerly reconciles Stripe payouts automatically." } }] },
    { id: "c002", text: "Ledgerly is used by 10,000 teams.", kind: "number", status: "unverified", confidence: 0, values: [{ raw: "10,000", value: 10000, unit: null }], entities: [], sources: [], flag: { action: "soften-or-cite", message: "no fetched source states 10,000 in context" } }
  ]
};

test("--research on: the brief is researched once, the script pass writes from it, and the narration is audited", async () => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-research-"));
  try {
    const { calls, model } = fakeModel();
    const researchCalls = [];
    const research = async (briefFile, options) => {
      researchCalls.push(briefFile);
      await mkdir(options.out, { recursive: true });
      await writeFile(path.join(options.out, "evidence.json"), JSON.stringify(LEDGER));
      return { summary: LEDGER.summary };
    };
    const adapters = { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), notice: () => {}, research };
    const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, research: "on" }, adapters);
    assert.equal(researchCalls.length, 1);
    assert.match(researchCalls[0], /research\/brief\.md$/);
    assert.equal(report.options.research, "on");
    assert.equal(report.research.ledger, "research/evidence.json");
    const scriptInput = calls.find((call) => call.schemaName === "launchclip_make_script").input;
    assert.match(scriptInput, /Verified claims:\n- \[c001\] Ledgerly reconciles Stripe payouts automatically/);
    assert.match(scriptInput, /Facts from primary sources:\n- Ledgerly matches each Stripe payout/);
    assert.match(scriptInput, /Do not state these as fact[\s\S]*Ledgerly is used by 10,000 teams/);
    assert.ok(report.warnings.some((line) => /the brief's claim "Ledgerly is used by 10,000 teams\." is unverified/.test(line)));
    assert.equal(report.gates.research.status, "passed");
    // A rerun with the same brief reuses the research.
    const again = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, research: "on" }, adapters);
    assert.equal(researchCalls.length, 1);
    assert.equal(again.research.reused, true);
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a narration claim the ledger does not back holds the research gate at pending", () => {
  const ctx = { report: { warnings: [], research: {} } };
  auditNarration(ctx, { ledger: LEDGER }, "Ledgerly is used by 10,000 teams. Ledgerly matches each Stripe payout to its invoice within 2 minutes.");
  assert.equal(ctx.researchGate.status, "pending");
  assert.deepEqual(ctx.researchGate.claims, ["Ledgerly is used by 10,000 teams."]);
  assert.deepEqual(ctx.report.research.audit.unbacked, [{ text: "Ledgerly is used by 10,000 teams.", status: "unverified" }]);
  assert.ok(ctx.report.warnings[0].includes("do not back"));
});

test("--research takes on or off, default off", () => {
  assert.equal(researchMode(undefined), "off");
  assert.equal(researchMode(true), "on");
  assert.throws(() => researchMode("maybe"), /--research must be on or off/);
  assert.throws(() => validateMakeOptions({ research: "maybe" }), /--research must be on or off/);
});
