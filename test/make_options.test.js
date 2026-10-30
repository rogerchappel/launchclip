import assert from "node:assert/strict";
import test from "node:test";
import { parseFlags } from "../src/cli.js";
import { MAKE_FLAGS, MAKE_SETTING_FLAGS, makeOptionsFromFlags, settingsFromMakeReport, validateMakeOptions } from "../src/make/options.js";
import { USAGE } from "../src/cli_usage.js";

test("make's CLI flags map to runMake options in one place", () => {
  const options = makeOptionsFromFlags(parseFlags(["--aspect", "9:16", "--duration", "45", "--max-repairs", "2", "--no-critic", "--no-subject", "--voice-id", "af_heart", "--allow-host", "staging.example.test"]));
  assert.equal(options.aspect, "9:16");
  assert.equal(options.duration, "45");
  assert.equal(options.maxRepairs, 2);
  assert.equal(options.critic, false);
  assert.equal(options.subject, false);
  assert.equal(options.voiceId, "af_heart");
  assert.equal(options.allowHost, "staging.example.test");
  assert.equal(makeOptionsFromFlags({ critic: true }).critic, true);
  assert.equal(makeOptionsFromFlags({}).critic, undefined);
  assert.equal("subject" in makeOptionsFromFlags({}), false);
});

test("every make flag is in make's usage, and only per-video flags are left out of recipes", () => {
  const usage = USAGE.filter(([name]) => name === "make").map(([, line]) => line).join(" ");
  for (const [flag] of MAKE_FLAGS) assert.match(usage, new RegExp(`--${flag}\\b`), flag);
  for (const flag of ["assets", "out", "replan", "repo", "approve-demo", "redemo", "start", "url", "allow-host", "demo-plan"]) assert.ok(!MAKE_SETTING_FLAGS.includes(flag), flag);
  for (const flag of ["aspect", "duration", "format", "goal", "awareness", "style", "renderer", "voice"]) assert.ok(MAKE_SETTING_FLAGS.includes(flag), flag);
});

test("validateMakeOptions refuses what runMake cannot use, naming the flag", () => {
  assert.deepEqual(validateMakeOptions({}), { voice: "kokoro", renderer: "remotion", quality: "draft", script: { goal: null, format: null, awareness: null } });
  assert.throws(() => validateMakeOptions({ renderer: "blender" }), /--renderer must be remotion or hyperframes/);
  assert.throws(() => validateMakeOptions({ quality: "ultra" }), /--quality/);
  assert.throws(() => validateMakeOptions({ voice: "siri" }), /--voice/);
  assert.throws(() => validateMakeOptions({ music: "loud" }), /--music/);
  assert.throws(() => validateMakeOptions({ aspect: "4:3" }), /--aspect must be one of/);
  assert.throws(() => validateMakeOptions({ duration: 1500 }), /--duration must be between 3 and 1200/);
  assert.doesNotThrow(() => validateMakeOptions({ duration: 600 }));
  assert.throws(() => validateMakeOptions({ format: "sitcom" }), /format/);
  assert.throws(() => validateMakeOptions({ maxRepairs: -1 }), /--max-repairs/);
  assert.throws(() => validateMakeOptions({ seed: "7f3a91c2", style: "editorial-dark" }), /--seed or --style, not both/);
});

test("settingsFromMakeReport repeats what a finished video became, not only what was typed", () => {
  const report = {
    options: { aspect: null, duration: null, style: null, seed: null, voice: "kokoro", voice_id: null, music: "synth", renderer: "hyperframes", quality: "draft", critic: "auto", goal: null, format: null, awareness: null },
    model: { spec: "openai:gpt-5.6-luna", source: "default for OPENAI_API_KEY" },
    routing: { aspect: "9:16", format: { width: 1080, height: 1920, fps: 30, duration: 30 } },
    script: { plan: { format: "short-form", goal: "reach", awareness: "problem" } },
    style: { name: "seed-7f3a91c2", source: "generated", seed: "7f3a91c2" },
    profile: { id: "short-motion" }
  };
  const { flags, style, profile } = settingsFromMakeReport(report);
  assert.deepEqual(flags, { aspect: "9:16", duration: 30, format: "short-form", goal: "reach", awareness: "problem", voice: "kokoro", music: "synth", renderer: "hyperframes", quality: "draft" });
  assert.equal(style.name, "seed-7f3a91c2");
  assert.equal(profile, "short-motion");
  assert.equal(settingsFromMakeReport({ ...report, model: { spec: "anthropic:claude-sonnet-5-5", source: "--model" } }).flags.model, "anthropic:claude-sonnet-5-5");
});
