#!/usr/bin/env node
// The container side of the smoke test (scripts/container-smoke.mjs runs it
// in the image from scripts/container-smoke/Dockerfile). It runs one
// footage-led make the way a host app's production worker runs it as a
// subprocess of a pinned checkout: an already edited
// talking-head clip with the app's word transcript, --no-subject, Remotion,
// synth music, --json. Planning goes to the local model stub; Whisper and
// Ollama are tripwires. Everything it measures goes to /out/result.json.
//
//   node scripts/container-smoke/run.mjs [--repeat 3]
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = fileURLToPath(new URL("../..", import.meta.url));
const SMOKE = path.join(HOME, "scripts/container-smoke");
const OUT = process.env.SMOKE_OUT ?? "/out";
const WORK = process.env.SMOKE_WORK ?? "/tmp/smoke";
const PORT = 18711;
const repeatAt = process.argv.indexOf("--repeat");
const REPEAT = Math.max(1, Number(repeatAt > 0 ? process.argv[repeatAt + 1] : process.env.SMOKE_REPEAT ?? 3));
const EXAMPLE = path.join(HOME, "examples/story/footage");
// The example recording has a false start at 8–10 s (scripts/make-footage-example.mjs);
// cutting it gives the edited clip NARRATION.json is timed against.
const CUT = [8, 10], EDITED = 20;

mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(WORK, "assets"), { recursive: true });
const tripwire = path.join(OUT, "tripwire.jsonl");
writeFileSync(tripwire, "");
writeFileSync(path.join(OUT, "model-stub.jsonl"), "");

// The edited talking-head clip, REPEAT times over, and its word transcript.
const clip = path.join(WORK, "assets/talking-head.mp4");
const once = path.join(WORK, "edited-once.mp4");
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
ff(["-i", path.join(EXAMPLE, "assets/recording.mp4"), "-filter_complex",
  `[0:v]trim=0:${CUT[0]},setpts=PTS-STARTPTS[v0];[0:v]trim=${CUT[1]},setpts=PTS-STARTPTS[v1];[0:a]atrim=0:${CUT[0]},asetpts=PTS-STARTPTS[a0];[0:a]atrim=${CUT[1]},asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", once]);
if (REPEAT === 1) copyFileSync(once, clip);
else {
  const list = path.join(WORK, "concat.txt");
  writeFileSync(list, Array.from({ length: REPEAT }, () => `file '${once}'\n`).join(""));
  ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", clip]);
}
const words = JSON.parse(readFileSync(path.join(EXAMPLE, "NARRATION.json"), "utf8")).words;
const transcript = path.join(WORK, "transcript.json");
writeFileSync(transcript, JSON.stringify({ words: Array.from({ length: REPEAT }, (_, n) => words.map((word) => ({ text: word.text, start: round(word.start + n * EDITED), end: round(word.end + n * EDITED) }))).flat() }));

// The recorded storyboard: the example's scenes on every copy of the clip.
// Repeats drop word hits, which would anchor to the first copy's words.
const example = JSON.parse(readFileSync(path.join(EXAMPLE, "storyboard.json"), "utf8"));
const storyboard = {
  ...example,
  title: "Container smoke: footage-led",
  format: { ...example.format, duration: EDITED * REPEAT },
  base: "assets/talking-head.mp4",
  scenes: Array.from({ length: REPEAT }, (_, n) => example.scenes.map((scene) => {
    const { hits, ...rest } = scene;
    return { ...rest, id: `${scene.id}-${n + 1}`, start: round(scene.start + n * EDITED), end: round(scene.end + n * EDITED), ...(n === 0 && hits ? { hits } : {}) };
  })).flat()
};
const storyboardFile = path.join(WORK, "recorded-storyboard.json");
writeFileSync(storyboardFile, JSON.stringify(storyboard, null, 2));

const stub = spawn(process.execPath, [path.join(SMOKE, "model-stub.mjs"), String(PORT), storyboardFile, path.join(OUT, "model-stub.jsonl")], { stdio: "inherit" });
await waitForPort();

// make's command line, as a host app builds it for a footage-led job.
const project = path.join(WORK, "project");
const args = [path.join(HOME, "bin/launchclip.js"), "make", "Dress my founder clip for a launch Short",
  "--out", project, "--aspect", "9:16", "--duration", String(EDITED * REPEAT), "--format", "short-form",
  "--renderer", "remotion", "--quality", "high", "--music", "synth", "--max-cost-usd", "10", "--json",
  "--research", "off", "--assets", path.join(WORK, "assets"), "--no-subject",
  "--base-edited", "--base-transcript", transcript, "--model", "compatible:smoke-stub"];
const env = {
  PATH: `${path.join(SMOKE, "bin")}:${process.env.PATH}`,
  HOME: process.env.HOME,
  LANG: "C.UTF-8",
  TMPDIR: process.env.TMPDIR ?? "/tmp",
  LAUNCHCLIP_TELEMETRY: "off",
  OPENAI_COMPATIBLE_BASE_URL: `http://127.0.0.1:${PORT}`,
  OPENAI_COMPATIBLE_API_KEY: "smoke-no-key",
  NODE_OPTIONS: `--import ${path.join(SMOKE, "tripwire.mjs")}`,
  SMOKE_TRIPWIRE: tripwire,
  // --browser image points Remotion at the Chrome the image fetched at build
  // time. Unset (the default), Remotion resolves its browser from make's cwd,
  // as it does under a host app that runs make from a job folder.
  ...(process.env.SMOKE_BROWSER === "image" ? { LAUNCHCLIP_REMOTION_BROWSER: imageBrowser() } : {})
};
const started = Date.now();
const child = spawn(process.execPath, args, { cwd: WORK, env, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
const exit = await new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
const seconds = round((Date.now() - started) / 1000);
stub.kill();

let report = null;
try { report = JSON.parse(stdout); } catch { writeFileSync(path.join(OUT, "make-stdout.txt"), stdout); }
if (report) writeFileSync(path.join(OUT, "MAKE.json"), JSON.stringify(report, null, 2));
const video = report?.output && existsSync(path.resolve(project, report.output)) ? path.resolve(project, report.output) : findMp4(project);
if (video) copyFileSync(video, path.join(OUT, "smoke.mp4"));

writeFileSync(path.join(OUT, "result.json"), JSON.stringify({
  exit,
  seconds,
  repeat: REPEAT,
  browser: env.LAUNCHCLIP_REMOTION_BROWSER ?? "remotion default (resolved from make's cwd)",
  duration_seconds: EDITED * REPEAT,
  status: report?.status ?? null,
  failed_stage: report?.failed_stage ?? null,
  stages: report?.stages ?? null,
  finish_stages: report?.finish?.stages ?? null,
  timings: report?.timings ?? null,
  next_steps: report?.next_steps ?? null,
  video: video ? { file: path.relative(project, video), bytes: statSync(video).size, probe: probe(video) } : null,
  model_cache: modelFiles(),
  cgroup: cgroup()
}, null, 2));
process.exit(0);

function imageBrowser() {
  const root = path.join(HOME, "node_modules/.remotion/chrome-headless-shell");
  for (const platform of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const dir of readdirSync(path.join(root, platform.name))) {
      const file = path.join(root, platform.name, dir, "headless_shell");
      if (existsSync(file)) return file;
    }
  }
  throw new Error(`no headless_shell under ${root}`);
}

function round(value) { return Math.round(value * 1000) / 1000; }

async function waitForPort() {
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`http://127.0.0.1:${PORT}/health`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error("model stub did not start");
}

function findMp4(dir) {
  const found = [];
  const walk = (d) => { for (const entry of readdirSync(d, { withFileTypes: true })) {
    const file = path.join(d, entry.name);
    if (entry.isDirectory() && !["assets", "node_modules"].includes(entry.name)) walk(file);
    else if (entry.isFile() && file.endsWith(".mp4")) found.push(file);
  } };
  if (existsSync(dir)) walk(dir);
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

function probe(file) {
  try {
    const json = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", file], { encoding: "utf8" }));
    return { duration: Number(json.format?.duration), streams: json.streams };
  } catch (error) { return { error: String(error.message) }; }
}

// Local model weights anywhere a downloader would put them.
function modelFiles() {
  const roots = [path.join(process.env.HOME ?? "/tmp", ".cache"), "/root/.cache", path.join(HOME, "node_modules/@huggingface/transformers/.cache")];
  const hits = [];
  const walk = (d, depth) => { if (depth > 8) return; for (const entry of readdirSync(d, { withFileTypes: true })) {
    const file = path.join(d, entry.name);
    if (entry.isDirectory()) walk(file, depth + 1);
    else if (/\.(onnx|pt|bin|gguf|safetensors)$/i.test(entry.name) || /whisper/i.test(file)) hits.push(file);
  } };
  for (const root of roots) { try { if (existsSync(root)) walk(root, 0); } catch {} }
  return hits;
}

// cgroup v2 inside the container: the limit, the peak and any OOM kills.
function cgroup() {
  const read = (name) => { try { return readFileSync(`/sys/fs/cgroup/${name}`, "utf8").trim(); } catch { return null; } };
  const events = Object.fromEntries((read("memory.events") ?? "").split("\n").filter(Boolean).map((line) => { const [k, v] = line.split(" "); return [k, Number(v)]; }));
  const num = (v) => (v == null || v === "max" ? v : Number(v));
  return { memory_max: num(read("memory.max")), memory_peak: num(read("memory.peak")), cpu_max: read("cpu.max"), memory_events: events };
}
