import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { envSearchDirectories, loadCliEnv, loadDotEnv, parseDotEnv } from "../src/env.js";
import { create as createElevenLabsMusic, musicCacheDir, musicCacheKey } from "../src/music/elevenlabs.js";
import { MUSIC_PROVIDERS, getMusicProvider, parseMusicSpec, resolveMusicChoice } from "../src/music/index.js";
import { buildMusicRequest, energyArc, normalizeHints, planSections, storyEnergySegments } from "../src/music/prompt.js";
import { buildElevenLabsMusicPayload, generateMusic, resolveElevenLabsMusicModel, resolveMusicPrompt, shouldAutoGenerateMusic } from "../src/music.js";

test("music prompt resolution prefers override, then script, then default", () => {
  assert.equal(resolveMusicPrompt({ override: "custom bed" }), "custom bed");
  assert.equal(resolveMusicPrompt({ script: { music_prompt: "script bed" } }), "script bed");
  assert.match(resolveMusicPrompt(), /Retro 80s synthwave/);
});

test("direct music auto-generation only runs when enabled and keyed", () => {
  assert.equal(shouldAutoGenerateMusic({}, { ELEVENLABS_API_KEY: "key" }), true);
  assert.equal(shouldAutoGenerateMusic({ music: "music/manual.mp3" }, { ELEVENLABS_API_KEY: "key" }), false);
  assert.equal(shouldAutoGenerateMusic({ "no-music": true }, { ELEVENLABS_API_KEY: "key" }), false);
  assert.equal(shouldAutoGenerateMusic({}, {}), false);
});

test("ElevenLabs music payload is bounded and model-selectable", () => {
  assert.equal(resolveElevenLabsMusicModel({}, { ELEVENLABS_MUSIC_MODEL: "music_v2" }), "music_v2");
  assert.equal(resolveElevenLabsMusicModel({ "music-model": "music_v1" }, { ELEVENLABS_MUSIC_MODEL: "music_v2" }), "music_v1");
  assert.deepEqual(buildElevenLabsMusicPayload({ prompt: "tight tutorial bed", durationSeconds: 12, modelId: "music_v2" }), {
    prompt: "tight tutorial bed",
    music_length_ms: 13500,
    model_id: "music_v2",
    force_instrumental: true
  });
  assert.equal(buildElevenLabsMusicPayload({ durationSeconds: 999 }).music_length_ms, 600000);
});

test("existing generated music still wires into a motion timeline", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-music-"));
  try {
    await mkdir(path.join(temp, "video"), { recursive: true });
    const timelinePath = path.join(temp, "video", "motion-timeline.json");
    await writeFile(
      timelinePath,
      `${JSON.stringify({ version: "motion.timeline.v1", duration_seconds: 12, audio: { music: "" } }, null, 2)}\n`
    );
    const target = path.join(temp, "video", "public", "music", "unit-test-bed.mp3");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "not a real mp3, just an existing file sentinel");

    const result = await generateMusic(temp, { timeline: timelinePath, output: "music/unit-test-bed.mp3", volume: 0.11 });
    const timeline = JSON.parse(await readFile(timelinePath, "utf8"));
    assert.equal(result.skipped, "exists (use --force to regenerate)");
    assert.equal(result.music, target);
    assert.equal(timeline.audio.music, "music/unit-test-bed.mp3");
    assert.equal(timeline.audio.music_volume, 0.11);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("music output cannot escape the workspace public directory", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-music-"));
  try {
    await assert.rejects(
      generateMusic(temp, { duration: 12, output: "../../outside.mp3" }),
      /must stay inside the workspace/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
// ---------------------------------------------------------------------------
// .env loading

test("parseDotEnv reads plain, exported, quoted and commented lines (both parsers)", () => {
  const text = "# comment\nA=1\nexport B=two\nC=\"quoted value\"\nD='single'\nE=bare # trailing comment\n\nBROKEN LINE\n";
  for (const native of [true, false]) {
    const parsed = parseDotEnv(text, { native });
    assert.equal(parsed.A, "1");
    assert.equal(parsed.B, "two");
    assert.equal(parsed.C, "quoted value");
    assert.equal(parsed.D, "single");
    assert.equal(parsed.E, "bare");
  }
});

test("loadDotEnv never overrides variables that are already set", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-env-"));
  try {
    await writeFile(path.join(dir, ".env"), "ELEVENLABS_API_KEY=from-file\nNEW_ONE=added\n");
    const env = { ELEVENLABS_API_KEY: "from-shell" };
    const set = loadDotEnv(dir, { env });
    assert.deepEqual(set, ["NEW_ONE"]);
    assert.equal(env.ELEVENLABS_API_KEY, "from-shell");
    assert.equal(env.NEW_ONE, "added");
    assert.equal(loadDotEnv(path.join(dir, "missing"), { env }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadCliEnv reads the working directory first, then a project command's directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-env-cli-"));
  try {
    const project = path.join(dir, "project");
    await mkdir(project);
    await writeFile(path.join(dir, ".env"), "SHARED=cwd\nONLY_CWD=1\n");
    await writeFile(path.join(project, ".env"), "SHARED=project\nONLY_PROJECT=1\n");
    const env = {};
    const loaded = loadCliEnv(["finish", "project"], { cwd: dir, env });
    assert.deepEqual(loaded, [path.join(dir, ".env"), path.join(project, ".env")]);
    assert.deepEqual(env, { SHARED: "cwd", ONLY_CWD: "1", ONLY_PROJECT: "1" });
    // Non-project commands only read the working directory.
    const other = {};
    assert.deepEqual(loadCliEnv(["doctor"], { cwd: dir, env: other }), [path.join(dir, ".env")]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadCliEnv walks up from the project to the repo root without overriding", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-env-walk-"));
  try {
    // dir/outside/.env must never load: dir/repo holds .git (a worktree file).
    const repo = path.join(dir, "repo");
    const project = path.join(repo, "launch", "landscape");
    const elsewhere = path.join(dir, "elsewhere");
    await mkdir(project, { recursive: true });
    await mkdir(elsewhere);
    await writeFile(path.join(dir, ".env"), "ABOVE_REPO=leak\n");
    await writeFile(path.join(repo, ".git"), "gitdir: /somewhere/else\n");
    await writeFile(path.join(repo, ".env"), "ELEVENLABS_API_KEY=from-repo\nSHELL_SET=file\n");
    await writeFile(path.join(repo, "launch", ".env"), "MIDDLE=1\n");
    const env = { SHELL_SET: "shell" };
    const loaded = loadCliEnv(["finish", project], { cwd: elsewhere, env });
    assert.deepEqual(loaded, [path.join(repo, "launch", ".env"), path.join(repo, ".env")]);
    assert.equal(env.ELEVENLABS_API_KEY, "from-repo");
    assert.equal(env.MIDDLE, "1");
    assert.equal(env.SHELL_SET, "shell");
    assert.equal(env.ABOVE_REPO, undefined);
    // Running from inside the project dir (finish .) finds the repo .env too.
    const fromProject = {};
    loadCliEnv(["finish", "."], { cwd: project, env: fromProject });
    assert.equal(fromProject.ELEVENLABS_API_KEY, "from-repo");
    // The walk is capped: 6 levels above the project at most.
    const deep = path.join(dir, "a", "b", "c", "d", "e", "f", "g", "h");
    assert.equal(envSearchDirectories(deep).length, 7);
    assert.equal(envSearchDirectories(project).at(-1), repo);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Music providers

const SECRET = "sk_test_DO_NOT_LEAK_1234567890";

function arcStory() {
  return {
    title: "Relay product promo",
    lane: "motion",
    format: { width: 1920, height: 1080, fps: 30, duration: 20 },
    brand: { colors: { bg: "#0b1020" }, fonts: { display: "anton" } },
    resolved: { duration: 20 },
    scenes: [
      { id: "s1", start: 0, end: 4, energy: 0 },
      { id: "s2", start: 4, end: 9, energy: 1 },
      { id: "s3", start: 9, end: 11, energy: "build" },
      { id: "s4", start: 11, end: 15, energy: 3 },
      { id: "s5", start: 15, end: 20, energy: 3 },
      { id: "o1", start: 2, end: 5, energy: 3, track: 1 }
    ]
  };
}

function fakeFetch({ status = 200, body = Buffer.from("ID3fake-mp3-bytes"), headers = { "song-id": "song_123" } } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.length); },
      // A hostile or buggy server that echoes the key back.
      async text() { return `error echo ${init.headers["xi-api-key"]}`; }
    };
  };
  impl.calls = calls;
  return impl;
}

test("the energy arc and composition-plan sections follow the story", () => {
  const story = arcStory();
  const segments = storyEnergySegments(story);
  assert.deepEqual(segments.map((segment) => [segment.energy, segment.start, segment.end]), [[0, 0, 4], [1, 4, 9], ["build", 9, 11], [3, 11, 20]]);
  assert.equal(energyArc(segments), "calm intro → light section → build → full payoff");
  const sections = planSections(segments, 22000);
  assert.equal(sections.reduce((sum, section) => sum + section.duration_ms, 0), 22000);
  for (const section of sections) assert.ok(section.duration_ms >= 3000 && section.duration_ms <= 120000, JSON.stringify(section));
  // The 2 s build is shorter than a section can be, so it merges into a neighbour.
  assert.equal(sections.length, 3);
  assert.equal(sections.at(-1).duration_ms, 11000, "the tail after the story joins the payoff");
});

test("buildMusicRequest maps the story to an instrumental plan or prompt at the target BPM", () => {
  const story = arcStory();
  const plan = buildMusicRequest(story, { seconds: 20, bpm: 112, seed: 7 });
  assert.equal(plan.mode, "plan");
  assert.equal(plan.length_ms, 22000);
  assert.equal(plan.body.model_id, "music_v1");
  assert.equal(plan.body.seed, 7);
  assert.equal(plan.body.prompt, undefined, "a plan cannot be combined with a prompt");
  assert.ok(plan.body.composition_plan.positive_global_styles.includes("112 BPM"));
  assert.ok(plan.body.composition_plan.positive_global_styles.includes("instrumental"));
  assert.ok(plan.body.composition_plan.negative_global_styles.includes("vocals"));
  assert.ok(plan.body.composition_plan.sections.every((section) => Array.isArray(section.lines) && section.lines.length === 0));
  assert.match(plan.body.composition_plan.sections[0].section_name, /^Intro \(calm\)/);
  assert.ok(plan.body.composition_plan.positive_global_styles.some((style) => /product launch/.test(style)));

  const prompt = buildMusicRequest(story, { seconds: 20, bpm: 112, prompt: "Warm lo-fi house", seed: 7 });
  assert.equal(prompt.mode, "prompt");
  assert.equal(prompt.body.force_instrumental, true);
  assert.equal(prompt.body.music_length_ms, 22000);
  assert.equal(prompt.body.seed, undefined, "seed is not allowed with a prompt");
  assert.match(prompt.body.prompt, /^Warm lo-fi house\. 112 BPM/);
  assert.match(prompt.body.prompt, /no vocals/i);
  assert.match(prompt.body.prompt, /calm intro → light section → build → full payoff/);

  // music_v2 takes a different plan schema, so it always uses a prompt.
  assert.equal(buildMusicRequest(story, { seconds: 20, bpm: 100, model: "music_v2" }).mode, "prompt");
  // One energy section: a prompt.
  assert.equal(buildMusicRequest({ ...story, scenes: [{ id: "s1", start: 0, end: 20, energy: 2 }] }, { seconds: 20, bpm: 100 }).mode, "prompt");
});

test("style-pack hints join the brief and clamp the tempo", () => {
  assert.deepEqual(normalizeHints({ prompt_hints: "analog, warm tape", bpm_range: [90, 100], energy_curve: [0, 1, 3] }), { promptHints: ["analog", "warm tape"], bpmRange: [90, 100], energyCurve: "0 → 1 → 3" });
  assert.deepEqual(normalizeHints(null), { promptHints: [], bpmRange: null, energyCurve: null });
  const request = buildMusicRequest(arcStory(), { seconds: 20, bpm: 120, hints: { prompt_hints: ["analog synthwave"], bpm_range: [90, 104], energy_curve: "slow burn" } });
  assert.equal(request.bpm, 104);
  assert.equal(request.tone[0], "analog synthwave");
  assert.ok(request.body.composition_plan.positive_global_styles.includes("104 BPM"));
  assert.ok(request.body.composition_plan.positive_global_styles.includes("energy curve: slow burn"));
});

test("parseMusicSpec and resolveMusicChoice: flag, story, then the key decide", () => {
  assert.deepEqual(MUSIC_PROVIDERS, ["synth", "elevenlabs", "file"]);
  assert.deepEqual(parseMusicSpec(undefined), { provider: null, sync: "auto" });
  assert.deepEqual(parseMusicSpec("none"), { provider: "none", sync: "off" });
  assert.deepEqual(parseMusicSpec("assets/audio/song.mp3"), { provider: "file", file: "assets/audio/song.mp3", sync: "auto" });
  assert.deepEqual(parseMusicSpec({ source: "synth", bpm: 90 }), { provider: "synth", sync: "auto", bpm: 90 });
  assert.deepEqual(parseMusicSpec({ provider: "elevenlabs", prompt: "x", sync: "cuts" }), { provider: "elevenlabs", sync: "cuts", prompt: "x" });
  const keyed = { ELEVENLABS_API_KEY: SECRET };
  assert.equal(resolveMusicChoice({}, { env: keyed }).provider, "elevenlabs");
  assert.equal(resolveMusicChoice({}, { env: {} }).provider, "synth");
  assert.equal(resolveMusicChoice({ music: "synth" }, { env: keyed }).provider, "synth");
  assert.equal(resolveMusicChoice({ music: { bpm: 100 } }, { env: keyed }).provider, "elevenlabs");
  assert.equal(resolveMusicChoice({ music: "elevenlabs" }, { flag: "none", env: keyed }).provider, "none");
  const fallback = resolveMusicChoice({ music: { provider: "elevenlabs" } }, { env: {} });
  assert.equal(fallback.provider, "synth");
  assert.match(fallback.warnings[0], /ELEVENLABS_API_KEY is not set/);
  assert.throws(() => resolveMusicChoice({}, { flag: "elevenlabs", env: {} }), /needs ELEVENLABS_API_KEY/);
  assert.throws(() => resolveMusicChoice({}, { flag: "lofi", env: {} }), /--music must be one of/);
});

test("ElevenLabs music: one request, then cache hits; no network in tests", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-music-cache-"));
  try {
    assert.equal(musicCacheDir({ LAUNCHCLIP_CACHE: dir }), path.join(dir, "elevenlabs", "music"));
    assert.equal(musicCacheDir({}), path.join(os.homedir(), ".cache", "launchclip", "elevenlabs", "music"));
    const fetch = fakeFetch();
    const provider = await getMusicProvider("elevenlabs", { env: { ELEVENLABS_API_KEY: SECRET, LAUNCHCLIP_CACHE: dir }, fetch });
    assert.equal(provider.paid, true);
    const outFile = path.join(dir, "project", "assets", "audio", "music.mp3");
    const first = await provider.generate(arcStory(), { seconds: 20, bpm: 112 }, { outFile });
    assert.equal(first.cached, false);
    assert.equal(fetch.calls.length, 1);
    assert.equal(fetch.calls[0].url, "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128");
    assert.equal(fetch.calls[0].init.method, "POST");
    assert.equal(fetch.calls[0].init.headers["xi-api-key"], SECRET);
    assert.ok(fetch.calls[0].body.composition_plan);
    assert.equal(first.song_id, "song_123");
    assert.equal(first.generated_seconds, 22);
    assert.equal(first.cost_usd, 0.055);
    assert.equal(await readFile(outFile, "utf8"), "ID3fake-mp3-bytes");
    const meta = await readFile(first.cache_file.replace(/\.mp3$/, ".json"), "utf8");
    assert.ok(!meta.includes(SECRET), "the cache metadata never stores the key");

    const again = await provider.generate(arcStory(), { seconds: 20, bpm: 112 }, { outFile });
    assert.equal(again.cached, true);
    assert.equal(again.cache_file, first.cache_file);
    assert.equal(fetch.calls.length, 1, "a cached track is never generated again");
    // A changed request is a cache miss.
    await provider.generate(arcStory(), { seconds: 20, bpm: 100 }, { outFile });
    assert.equal(fetch.calls.length, 2);
    // A cached track is reused even without a key.
    const keyless = createElevenLabsMusic({ env: { LAUNCHCLIP_CACHE: dir }, fetch });
    assert.equal((await keyless.generate(arcStory(), { seconds: 20, bpm: 112 }, { outFile })).cached, true);
    assert.equal(musicCacheKey({ prompt: "a", music_length_ms: 3000 }), musicCacheKey({ music_length_ms: 3000, prompt: "a" }));
    assert.notEqual(musicCacheKey({ prompt: "a", music_length_ms: 3000 }), musicCacheKey({ prompt: "a", music_length_ms: 3000, seed: 1 }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ElevenLabs music never puts the key in errors or logs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-music-key-"));
  const logged = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...args) => logged.push(args.join(" "));
  try {
    const failing = createElevenLabsMusic({ env: { ELEVENLABS_API_KEY: SECRET, LAUNCHCLIP_CACHE: dir }, fetch: fakeFetch({ status: 401 }) });
    await assert.rejects(failing.generate(arcStory(), { seconds: 20, bpm: 112 }, { outFile: path.join(dir, "m.mp3") }), (error) => {
      assert.match(error.message, /ElevenLabs music request failed \(401\)/);
      assert.ok(!error.message.includes(SECRET), "the echoed key is redacted");
      assert.ok(!String(error.stack).includes(SECRET));
      return true;
    });
    const throwing = createElevenLabsMusic({ env: { ELEVENLABS_API_KEY: SECRET, LAUNCHCLIP_CACHE: dir }, fetch: async () => { throw new Error(`socket closed for ${SECRET}`); } });
    await assert.rejects(throwing.generate(arcStory(), { seconds: 20, bpm: 112 }, { outFile: path.join(dir, "m.mp3") }), (error) => !error.message.includes(SECRET));
    const keyless = createElevenLabsMusic({ env: { LAUNCHCLIP_CACHE: dir }, fetch: fakeFetch() });
    await assert.rejects(keyless.generate(arcStory(), { seconds: 20, bpm: 113 }, { outFile: path.join(dir, "m.mp3") }), /needs ELEVENLABS_API_KEY\. Nothing was sent/);
    assert.ok(logged.every((line) => !line.includes(SECRET)));
  } finally {
    Object.assign(console, original);
    await rm(dir, { recursive: true, force: true });
  }
});
