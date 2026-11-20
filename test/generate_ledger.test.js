import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MAX_ATTEMPTS, appendLedger, beforeCall, cacheKey, checkBudget, findAccepted, ledgerCosts, ledgerPath, nextAttempt, quoteBatch, readLedger, spentToday, spentTotal } from "../src/generate/ledger.js";

const withProject = async (run) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-ledger-"));
  try { await run(project); } finally { await rm(project, { recursive: true, force: true }); }
};
const attempt = (fields = {}) => ({ shot: "s1", step: "video", tier: "draft", attempt: 1, provider: "fake", model: "m1", seed: 7, brief_hash: "sha256:abc", cost: { amount: 0.5, unit: "usd" }, verdict: "rejected", ...fields });

test("an empty project has an empty ledger and no spend", () => withProject(async (project) => {
  assert.deepEqual(await readLedger(project), []);
  assert.deepEqual(await spentTotal(project), {});
  assert.equal(await nextAttempt(project, "s1", "video"), 1);
}));

test("appendLedger writes one line per attempt and stamps the time; a torn line is skipped", () => withProject(async (project) => {
  const line = await appendLedger(project, attempt(), { now: () => "2026-11-20T10:00:00.000Z" });
  assert.equal(line.at, "2026-11-20T10:00:00.000Z");
  await appendFile(ledgerPath(project), "{\"shot\": \"s2\", \"ste");
  const entries = await readLedger(project);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].shot, "s1");
  await assert.rejects(appendLedger(project, attempt({ cost: { amount: -1, unit: "usd" } })), /cost/);
  await assert.rejects(appendLedger(project, attempt({ attempt: 0 })), /attempt/);
  await assert.rejects(appendLedger(project, attempt({ step: undefined })), /step/);
}));

test("cacheKey covers brief hash, provider, model, step, tier and seed", () => {
  const base = { brief_hash: "sha256:abc", provider: "fake", model: "m1", step: "video", tier: "draft", seed: 7 };
  assert.match(cacheKey(base), /^sha256:[0-9a-f]{64}$/);
  assert.equal(cacheKey(base), cacheKey({ ...base, verdict: "accepted", attempt: 3 }));
  for (const field of Object.keys(base)) assert.notEqual(cacheKey(base), cacheKey({ ...base, [field]: "other" }), field);
});

test("findAccepted reuses the newest accepted attempt whose file is still there", () => withProject(async (project) => {
  const key = cacheKey(attempt());
  await appendLedger(project, attempt({ file: "assets/shots/s1.draft.1.mp4" }));
  assert.equal(await findAccepted(project, key), null, "rejected is not reused");
  await appendLedger(project, attempt({ attempt: 2, verdict: "accepted", file: "assets/shots/s1.draft.2.mp4" }));
  assert.equal(await findAccepted(project, key), null, "a missing file is not reused");
  await mkdir(path.join(project, "assets", "shots"), { recursive: true });
  await writeFile(path.join(project, "assets", "shots", "s1.draft.2.mp4"), "x");
  assert.equal((await findAccepted(project, key)).attempt, 2);
  assert.equal(await findAccepted(project, cacheKey(attempt({ seed: 8 }))), null);
}));

test("quoteBatch sums per unit and never across units; a bad quote throws", async () => {
  const provider = { id: "fake", quote: async (_brief, step) => step === "image" ? { amount: 0.04, unit: "usd" } : { amount: 20, unit: "credits" } };
  const items = ["s1", "s2"].flatMap((id) => [{ brief: { id }, step: "image", tier: "draft" }, { brief: { id }, step: "video", tier: "draft" }]);
  const { totals, lines } = await quoteBatch(items, provider);
  assert.deepEqual(totals, { usd: 0.08, credits: 40 });
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[1], { shot: "s1", step: "video", tier: "draft", amount: 20, unit: "credits" });
  await assert.rejects(quoteBatch(items, { id: "bad", quote: () => ({ amount: NaN, unit: "usd" }) }), /bad quote/);
});

test("checkBudget refuses a batch over budget and a money unit with no budget, but not local seconds", () => {
  assert.equal(checkBudget({ quote: { usd: 4 }, budget: { usd: 5 } }).ok, true);
  const over = checkBudget({ quote: { usd: 4 }, budget: { usd: 5 }, spent: { usd: 2 } });
  assert.equal(over.ok, false);
  assert.match(over.reasons[0], /6 usd would pass the budget of 5 usd/);
  assert.deepEqual(over.remaining, { usd: 3 });
  assert.match(checkBudget({ quote: { credits: 10 }, budget: { usd: 5 } }).reasons[0], /no budget in credits/);
  assert.equal(checkBudget({ quote: { seconds: 300 }, budget: {} }).ok, true);
  assert.equal(checkBudget({ quote: { seconds: 300 }, budget: { seconds: 100 } }).ok, false);
});

test("spend comes from the ledger, per project and per UTC day, every attempt counted", () => withProject(async (project) => {
  await appendLedger(project, attempt({ at: "2026-11-19T23:00:00.000Z" }));
  await appendLedger(project, attempt({ attempt: 2, at: "2026-11-20T01:00:00.000Z", cost: { amount: 0.25, unit: "usd" } }));
  await appendLedger(project, attempt({ attempt: 3, at: "2026-11-20T02:00:00.000Z", cost: { amount: 20, unit: "credits" } }));
  assert.deepEqual(await spentTotal(project), { usd: 0.75, credits: 20 });
  assert.deepEqual(await spentToday(project, { now: () => "2026-11-20T12:00:00.000Z" }), { usd: 0.25, credits: 20 });
}));

test("beforeCall stops when the next call would pass the budget on recorded spend", () => withProject(async (project) => {
  const now = () => "2026-11-20T12:00:00.000Z";
  assert.equal((await beforeCall({ project, budget: { usd: 1 }, nextQuote: { amount: 0.5, unit: "usd" }, now })).ok, true);
  // The provider charged more than it quoted: the recorded cost is what counts.
  await appendLedger(project, attempt({ cost: { amount: 0.9, unit: "usd" } }), { now });
  const stop = await beforeCall({ project, budget: { usd: 1 }, nextQuote: { amount: 0.5, unit: "usd" }, now });
  assert.equal(stop.ok, false);
  assert.deepEqual(stop.spent, { usd: 0.9 });
  const daily = await beforeCall({ project, budget: { usd: 10 }, daily: { usd: 1 }, nextQuote: { amount: 0.5, unit: "usd" }, now });
  assert.equal(daily.ok, false);
  assert.match(daily.reasons[0], /^today: /);
  await assert.rejects(beforeCall({ project, budget: { usd: 1 }, nextQuote: null }), /quote/);
}));

test("nextAttempt counts per shot and step and stops after three attempts", () => withProject(async (project) => {
  for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
    assert.equal(await nextAttempt(project, "s1", "video"), n);
    await appendLedger(project, attempt({ attempt: n }));
  }
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(await nextAttempt(project, "s1", "video"), null);
  assert.equal(await nextAttempt(project, "s1", "image"), 1);
  assert.equal(await nextAttempt(project, "s2", "video"), 1);
  // Per model: m1 is out, m2 gets a fresh cap at the next number; asked_model wins over the model a call reported.
  assert.equal(await nextAttempt(project, "s1", "video", "m1"), null);
  assert.equal(await nextAttempt(project, "s1", "video", "m2"), 4);
  await appendLedger(project, attempt({ attempt: 4, asked_model: "m2", model: "m2-v1.0", verdict: "failed" }));
  assert.equal(await nextAttempt(project, "s1", "video", "m2"), 5);
}));

test("ledgerCosts gives cost-tracker line items: usd priced, credits flagged, local free", () => withProject(async (project) => {
  await appendLedger(project, attempt());
  await appendLedger(project, attempt({ attempt: 2, cost: { amount: 20, unit: "credits" } }));
  // A line the ComfyUI path already writes.
  await appendFile(ledgerPath(project), `${JSON.stringify({ shot: "s3", tier: "plate", provider: "comfy", model: "flux", cost: { amount: 0, unit: "local" }, seconds: 12 })}\n`);
  const { line_items: items, by_unit: byUnit } = await ledgerCosts(project);
  assert.deepEqual(byUnit, { usd: 0.5, credits: 20, local: 0 });
  assert.equal(items[0].estimated_usd, 0.5);
  assert.equal(items[0].product, "generation-video");
  assert.equal(items[1].estimated_usd, null);
  assert.match(items[1].warning, /credits/);
  assert.equal(items[2].estimated_usd, 0);
}));
