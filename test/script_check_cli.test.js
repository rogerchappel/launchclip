// `launchclip script check`: input files, brief files, readable and JSON
// output, and the exit code (bin/launchclip.js exits 1 when runCli rejects).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runCli } from "../src/cli.js";
import { parseScriptFile, readBriefs } from "../src/script_check_cli.js";

const run = promisify(execFile);
const BIN = path.resolve(import.meta.dirname, "../bin/launchclip.js");
const GOOD = "Month-end close should not take a week. Ledgerly matches every payout to its invoice. Teams closed forty per cent faster. Try Ledgerly free today.";
const BAD = "Hey guys, welcome back. Ledgerly is trusted by 10,000 teams. Try Ledgerly free today.";

async function workspace() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-script-check-"));
  await writeFile(path.join(dir, "good.txt"), GOOD);
  await writeFile(path.join(dir, "bad.txt"), BAD);
  await writeFile(path.join(dir, "brief.md"), "# Ledgerly\n\nLedgerly matches payouts to invoices. Beta teams closed 40% faster.\n\n## Narration (already synthesised)\n\nTeams closed ninety per cent faster.\n\n## Notes\n\nNo other figures.\n");
  return dir;
}

async function cli(argv) {
  const out = [];
  await runCli(argv, { stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} } });
  return out.join("");
}

test("script check prints a readable report and resolves on a clean script", async () => {
  const dir = await workspace();
  try {
    const text = await cli(["script", "check", path.join(dir, "good.txt"), "--duration", "10", "--brief", path.join(dir, "brief.md")]);
    assert.match(text, /^launchclip script check: ok/);
    assert.match(text, /24 words, 4 sentences, 144 wpm over 10s/);
    const json = JSON.parse(await cli(["script", "check", path.join(dir, "good.txt"), "--duration", "10", "--brief", path.join(dir, "brief.md"), "--format", "promo", "--json"]));
    assert.equal(json.ok, true);
    assert.equal(json.stats.format, "promo");
    assert.equal(json.input, "text");
    assert.deepEqual(json.brief_files, [path.join(dir, "brief.md")]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("script check rejects with the error count, and the binary exits 1", async () => {
  const dir = await workspace();
  try {
    const out = [];
    await assert.rejects(runCli(["script", "check", path.join(dir, "bad.txt"), "--duration", "10", "--brief", path.join(dir, "brief.md")], { stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} } }), /launchclip script check: 3 error\(s\)/);
    assert.match(out.join(""), /error: \[opener-filler\]/);
    assert.match(out.join(""), /error: \[fact-trace\] "10,000"/);
    assert.match(out.join(""), /error: \[social-proof\]/);
    const failed = await run(process.execPath, [BIN, "script", "check", path.join(dir, "bad.txt"), "--duration", "10", "--brief", path.join(dir, "brief.md")]).catch((error) => error);
    assert.equal(failed.code, 1);
    assert.match(failed.stdout, /launchclip script check: failed/);
    const passed = await run(process.execPath, [BIN, "script", "check", path.join(dir, "good.txt"), "--duration", "10", "--brief", path.join(dir, "brief.md")]);
    assert.match(passed.stdout, /launchclip script check: ok/);
    // Bad input names the fix.
    await assert.rejects(cli(["script", "check", path.join(dir, "good.txt"), "--format", "reel"]), /Unknown format "reel"; use one of: short-form/);
    await assert.rejects(cli(["script", "check", path.join(dir, "missing.txt")]), /script file not found/);
    await assert.rejects(cli(["script", "check"]), /needs a script/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("script check reads the narration out of storyboard, NARRATION and SCRIPT JSON", () => {
  assert.deepEqual(parseScriptFile("storyboard.json", JSON.stringify({ format: { duration: 12 }, audio: { narration: { text: GOOD } } })), { kind: "storyboard", narration: GOOD, duration: 12 });
  assert.equal(parseScriptFile("story.json", JSON.stringify({ audio: { narration: { lines: [{ speaker: "a", text: "One." }, { speaker: "b", text: "Two." }] } } })).narration, "One. Two.");
  assert.deepEqual(parseScriptFile("NARRATION.json", JSON.stringify({ text: GOOD, duration_seconds: 9.4 })), { kind: "narration", narration: GOOD, duration: 9.4 });
  assert.deepEqual(parseScriptFile("SCRIPT.json", JSON.stringify({ narration: GOOD, take: { seconds: 10.2 } })), { kind: "script", narration: GOOD, duration: 10.2 });
  assert.equal(parseScriptFile("script.txt", GOOD).duration, null);
  assert.throws(() => parseScriptFile("other.json", "{}"), /has no narration/);
});

test("brief files: a narration section is dropped; JSON briefs keep their fields", async () => {
  const dir = await workspace();
  try {
    const md = await readBriefs([path.join(dir, "brief.md")]);
    assert.doesNotMatch(md.notes.join("\n"), /ninety/);
    assert.match(md.notes.join("\n"), /No other figures/);
    await writeFile(path.join(dir, "brief.json"), JSON.stringify({ prompt: "Ledgerly", notes: ["40% faster"], transcripts: ["We saved 12 hours."] }));
    const json = await readBriefs([path.join(dir, "brief.json"), path.join(dir, "brief.md")]);
    assert.deepEqual(json.transcripts, ["We saved 12 hours."]);
    assert.equal(json.notes[0], "Ledgerly");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
