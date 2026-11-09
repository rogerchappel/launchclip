// A capture research wanted and did not get is never silent: the status, the
// gate, `launchclip research capture` and doctor each say which, why and the fix.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { diagnoseInstallation } from "../src/doctor.js";
import { runMake } from "../src/make/index.js";
import { captureFailureKind, captureRecorderStatus, captureStatus, captureStatusLines, gateWithCaptures } from "../src/research/capture_status.js";
import { captureResearch } from "../src/research/record.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const request = (id) => ({ schema: "launchclip.capture.v1", id, url: `https://nimbus.ai/${id}`, kind: "article", viewport: { width: 1600, height: 1000 }, theme: "dark", beats: [{ at: 0, action: "wait", target: null, dur: 1 }], out: `assets/evidence/${id}.mp4`, provenance: { source_title: id, fetched_at: "2026-11-10T00:00:00.000Z", publisher: "Nimbus AI" } });
const claim = (id, capture, status = "verified") => ({ id, text: `Claim ${id}.`, kind: "entity", status, confidence: 0.9, values: [], entities: [], ...(capture ? { capture } : {}), sources: status === "verified" ? [{ url: "https://nimbus.ai/a", publisher: "Nimbus AI", primary: true, supports: true, confidence: 0.9, fetched_at: "2026-11-10T00:00:00.000Z", quote: { text: `Claim ${id}.` } }] : [], ...(status === "verified" ? {} : { flag: { action: "cut", message: "m" } }) });
const LEDGER = { schema: "launchclip.evidence.v1", summary: { claims: 3, verified: 3, contradicted: 0, unverified: 0, sources_checked: 1, primary_sources: 1, web_search: null }, excerpts: [], claims: [claim("c001", "a"), claim("c002", "b"), claim("c003", "b")] };

test("a failure's reason is sorted into a kind, each with its fix", () => {
  assert.equal(captureFailureKind("no local recorder: the optional dependency playwright is not installed (npm install playwright)"), "no-recorder");
  assert.equal(captureFailureKind("no local recorder: ffmpeg is not on PATH"), "no-recorder");
  assert.equal(captureFailureKind("a paywall (\"subscribe to continue reading\")"), "paywall");
  assert.equal(captureFailureKind("a bot check or block page (\"Just a moment\")"), "bot-check");
  assert.equal(captureFailureKind("a sign-in wall (redirected to https://x.example/login)"), "sign-in");
  assert.equal(captureFailureKind("HTTP 404 from https://nimbus.ai/gone"), "http-error");
  assert.equal(captureFailureKind("no answer from the capture command in 240 s"), "timeout");
  assert.equal(captureFailureKind("beat 2: target \"71.4\" not found on the page"), "target-missing");
  assert.equal(captureFailureKind("something odd"), "other");
});

test("the status names every verified claim left without its page, and the gate holds at pending", () => {
  const result = { recorded: [request("a")], failed: [{ id: "b", url: "https://nimbus.ai/b", reason: "a paywall (\"subscribe to continue reading\")" }] };
  const status = captureStatus(LEDGER, [request("a"), request("b")], result);
  assert.deepEqual([status.status, status.requested, status.recorded, status.missing], ["partial", 2, 1, 1]);
  assert.deepEqual(status.claims_without_capture.map((entry) => [entry.id, entry.kind]), [["c002", "paywall"], ["c003", "paywall"]]);
  assert.match(status.claims_without_capture[0].fix, /never bypassed: give another public source with --url/);
  const lines = captureStatusLines(status);
  assert.equal(lines[0], "1 of 2 source pages research wanted on screen was not recorded, so 2 verified claims have no page to show");
  assert.match(lines[1], /^paywall \(b\): the page is behind a paywall, which is never bypassed/);
  const gate = gateWithCaptures({ status: "passed", reason: "every claim in the narration is backed" }, status);
  assert.equal(gate.status, "pending");
  assert.deepEqual(gate.captures, { requested: 2, recorded: 1, missing: 1 });
  // A gate already pending keeps its reason and gains the captures'.
  assert.match(gateWithCaptures({ status: "pending", reason: "1 claim(s) in the narration are not backed by a source" }, status).reason, /not backed by a source; 1 of 2 source pages/);
  // Everything recorded: the gate passes and says so.
  const clean = captureStatus(LEDGER, [request("a")], { recorded: [request("a")], failed: [] });
  assert.deepEqual(captureStatusLines(clean), []);
  assert.deepEqual(gateWithCaptures({ status: "passed", reason: "ok" }, clean), { status: "passed", reason: "ok", captures: { requested: 1, recorded: 1, missing: 0 } });
  // A recorder that never started fails every request.
  const none = captureStatus(LEDGER, [request("a"), request("b")], { recorded: [], failed: [{ id: "a", url: null, reason: "no local recorder: no Chromium found" }, { id: "b", url: null, reason: "no local recorder: no Chromium found" }] });
  assert.equal(none.status, "missing");
  assert.match(captureStatusLines(none)[1], /^no recorder on this machine \(a, b\): install the recorder \(npm install playwright && npx playwright install chromium/);
  assert.equal(captureStatus(LEDGER, [request("a")], null).status, "not-attempted");
  assert.equal(captureStatus(LEDGER, [], null).status, "none");
});

test("launchclip research capture records every request, writes capture-status.json and reports what is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-research-capture-"));
  try {
    const dir = path.join(root, "research");
    await mkdir(path.join(dir, "captures"), { recursive: true });
    await writeFile(path.join(dir, "evidence.json"), JSON.stringify(LEDGER));
    for (const id of ["a", "b"]) await writeFile(path.join(dir, "captures", `${id}.json`), JSON.stringify(request(id)));
    const lines = [];
    const capture = async (entry, { root: project }) => {
      if (entry.id === "b") throw new Error("a bot check or block page (\"Just a moment\")");
      await mkdir(path.join(project, "assets", "evidence"), { recursive: true });
      await writeFile(path.join(project, "assets", "evidence", `${entry.id}.mp4`), "x");
      await writeFile(path.join(project, "assets", "evidence", `${entry.id}.evidence.json`), "{}");
    };
    const report = await captureResearch("research", { cwd: root }, { capture, log: (line) => lines.push(line), attach: async () => ({ report: { attached: 1 } }) });
    assert.deepEqual([report.status, report.requested, report.recorded, report.missing], ["partial", 2, 1, 1]);
    assert.deepEqual(report.claims_without_capture.map((entry) => entry.id), ["c002", "c003"]);
    assert.deepEqual(report.evidence_data, { attached: 1 });
    assert.ok(lines.some((line) => /^captures: bot check \(b\): the site refused an automated browser, which is never worked round/.test(line)), lines.join("\n"));
    const written = JSON.parse(await readFile(path.join(dir, "capture-status.json"), "utf8"));
    assert.equal(written.schema, "launchclip.research-captures.v1");
    assert.deepEqual(written.captures.map((entry) => [entry.id, entry.status]), [["a", "recorded"], ["b", "missing"]]);
    await assert.rejects(captureResearch("nowhere", { cwd: root }), /run launchclip research first/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("make: a capture that cannot be recorded is in the report with its fix and holds the research gate", async () => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-capture-status-"));
  try {
    const { model } = fakeModel();
    const ledger = { ...LEDGER, claims: [{ ...claim("c001", "a"), text: "Ledgerly reconciles Stripe payouts automatically." }] };
    const research = async (briefFile, options) => {
      await mkdir(path.join(options.out, "captures"), { recursive: true });
      await writeFile(path.join(options.out, "evidence.json"), JSON.stringify(ledger));
      await writeFile(path.join(options.out, "captures", "a.json"), JSON.stringify(request("a")));
      return { summary: ledger.summary };
    };
    const lines = [];
    const capture = async () => { throw new Error("a paywall (\"subscribe to continue reading\")"); };
    const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, research: "on" }, { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), notice: (line) => lines.push(line), research, capture });
    assert.deepEqual([report.captures.status, report.captures.requested, report.captures.recorded, report.captures.missing], ["missing", 1, 0, 1]);
    assert.deepEqual(report.captures.claims_without_capture.map((entry) => [entry.id, entry.kind]), [["c001", "paywall"]]);
    assert.equal(report.gates.research.status, "pending");
    assert.match(report.gates.research.reason, /1 of 1 source page research wanted on screen was not recorded, so 1 verified claim has no page to show/);
    assert.ok(report.warnings.some((line) => /^captures: paywall \(a\): the page is behind a paywall, which is never bypassed/.test(line)));
    assert.ok(lines.some((line) => /^captures: 1 of 1 source page/.test(line)));
    assert.equal(JSON.parse(await readFile(path.join(report.project, "research", "capture-status.json"), "utf8")).status, "missing");
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("doctor says whether source pages can be recorded, with the fix", async () => {
  const missing = await captureRecorderStatus({ recorderAvailability: async () => ({ ok: false, reasons: ["the optional dependency playwright is not installed (npm install playwright)"] }) });
  assert.equal(missing.available, false);
  assert.match(missing.hint, /cannot be recorded: the optional dependency playwright is not installed[^.]*\. Fix: install the recorder \(npm install playwright && npx playwright install chromium/);
  assert.equal((await captureRecorderStatus({ recorderAvailability: async () => ({ ok: true, reasons: [] }) })).hint, undefined);
  const report = await diagnoseInstallation({ env: { TAVILY_API_KEY: "x" }, commandAvailable: async () => true, fileAvailable: async () => true, subjectStatus: async () => ({ available: true }), captureStatus: async () => missing });
  assert.equal(report.tools.evidence_capture.available, false);
  assert.deepEqual(report.notes, [missing.hint]);
  assert.equal(report.credentials.web_search_key, "tavily");
  assert.equal(report.status, "ready");
});
