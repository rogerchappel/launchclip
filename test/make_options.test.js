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
  assert.deepEqual(validateMakeOptions({}), { voice: "kokoro", renderer: "remotion", quality: "draft", script: { goal: null, format: null, awareness: null, pace: null } });
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

test("--min-shots parses as a value into options.minShots, and is validated", () => {
  assert.deepEqual(parseFlags(["--min-shots", "3", "--asset-provider-cmd", "./shots.sh"]), { "min-shots": "3", "asset-provider-cmd": "./shots.sh" });
  assert.deepEqual(parseFlags(["--min-shots", "0", "--replan"]), { "min-shots": "0", replan: true });
  assert.throws(() => parseFlags(["--min-shots", "--replan"]), /Missing value for --min-shots/);
  assert.equal(makeOptionsFromFlags(parseFlags(["--min-shots", "3"])).minShots, "3");
  assert.equal(makeOptionsFromFlags({}).minShots, undefined);
  assert.ok(MAKE_FLAGS.some(([flag]) => flag === "min-shots"));
  assert.ok(!MAKE_SETTING_FLAGS.includes("min-shots"));
  for (const value of ["0", "3", "12", 2]) assert.doesNotThrow(() => validateMakeOptions({ minShots: value }), String(value));
  for (const value of ["-1", "2.5", "three", "", -1, 1.5, true]) assert.throws(() => validateMakeOptions({ minShots: value }), /--min-shots must be a whole number of 0 or more/, String(value));
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

test("--music-volume parses into options.musicVolume, takes a gain from 0 to 1, and a recipe may save it", () => {
  assert.equal(makeOptionsFromFlags(parseFlags(["--music-volume", "0.15"])).musicVolume, "0.15");
  assert.equal(makeOptionsFromFlags({}).musicVolume, undefined);
  assert.ok(MAKE_SETTING_FLAGS.includes("music-volume"));
  for (const value of ["0", "0.15", "1", 0.3]) assert.doesNotThrow(() => validateMakeOptions({ musicVolume: value }), String(value));
  for (const value of ["-0.1", "1.5", "loud", "", true]) assert.throws(() => validateMakeOptions({ musicVolume: value }), /--music-volume must be a number from 0 to 1/, String(value));
});

test("--music-duck and --music-prompt are make settings, validated and saved", () => {
  for (const flag of ["music-duck", "music-prompt"]) assert.ok(MAKE_SETTING_FLAGS.includes(flag), flag);
  const options = makeOptionsFromFlags({ "music-duck": "0.42", "music-prompt": "warm acoustic guitar" });
  assert.equal(options.musicDuck, "0.42");
  assert.equal(options.musicPrompt, "warm acoustic guitar");
  validateMakeOptions(options);
  assert.throws(() => validateMakeOptions({ musicDuck: "1.5" }), /--music-duck must be a number from 0 to 1/);
  assert.throws(() => validateMakeOptions({ musicPrompt: "" }), /--music-prompt needs/);
  const { flags } = settingsFromMakeReport({ options: { music: "elevenlabs", music_volume: 0.38, music_duck: 0.42, music_prompt: "warm acoustic guitar" } });
  assert.deepEqual([flags["music-volume"], flags["music-duck"], flags["music-prompt"]], [0.38, 0.42, "warm acoustic guitar"]);
});

test("--pace, --cta-keyword/--cta-offer and --episode/--choices reach runMake and are validated", () => {
  const options = makeOptionsFromFlags({ pace: "fast", "cta-keyword": "deck", "cta-offer": "our checklist", episode: "Job 1", choices: "ROSA,LOU,IKE" });
  assert.deepEqual([options.pace, options.ctaKeyword, options.ctaOffer, options.episode, options.choices], ["fast", "deck", "our checklist", "Job 1", "ROSA,LOU,IKE"]);
  for (const flag of ["pace", "cta-keyword", "cta-offer", "episode", "choices"]) assert.ok(MAKE_FLAGS.some(([name]) => name === flag), flag);
  for (const flag of ["pace", "cta-keyword", "cta-offer"]) assert.ok(MAKE_SETTING_FLAGS.includes(flag), flag);
  assert.equal(validateMakeOptions({ pace: "Fast" }).script.pace, "fast");
  assert.throws(() => validateMakeOptions({ pace: "warp" }), /--pace must be one of calm, standard, fast/);
  assert.throws(() => validateMakeOptions({ ctaKeyword: "two words" }), /--cta-keyword must be one word/);
  assert.throws(() => validateMakeOptions({ choices: "A" }), /--choices must list two to four options/);
  const { flags } = settingsFromMakeReport({ options: { pace: "calm", cta_keyword: "DECK", cta_offer: "our checklist" } });
  assert.deepEqual([flags.pace, flags["cta-keyword"], flags["cta-offer"]], ["calm", "DECK", "our checklist"]);
});
