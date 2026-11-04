#!/usr/bin/env node
// CPU-only container smoke: one footage-led make in Docker, sized like
// a host app's production worker (8 vCPU, 7.5 GB, no GPU), offline. Run it
// before a host app bumps its LaunchClip pin (docs/CONTAINER_SMOKE.md).
//
//   npm run smoke:container [-- --cpus 8 --memory 7.5g --budget 900 --repeat 3 --browser default|image --out .smoke/container --no-build]
//
// Builds scripts/container-smoke/Dockerfile from the checkout's tracked and
// unignored files, runs scripts/container-smoke/run.mjs in it with
// --network none, samples docker stats, and fails unless make finishes inside
// the time budget with every stage done or skipped, an MP4 comes out, no
// Whisper, Ollama or model download is attempted, and peak memory stays
// under the limit with no OOM kill.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { values: flags } = parseArgs({
  options: {
    cpus: { type: "string", default: "8" },
    memory: { type: "string", default: "7.5g" },
    budget: { type: "string", default: "900" },
    repeat: { type: "string", default: "3" },
    out: { type: "string", default: ".smoke/container" },
    image: { type: "string", default: "launchclip-container-smoke" },
    platform: { type: "string" },
    browser: { type: "string", default: "default" },
    "no-build": { type: "boolean", default: false }
  }
});
const out = path.resolve(ROOT, flags.out);
const budgetSeconds = Number(flags.budget);
const limitBytes = bytes(flags.memory);
const name = `launchclip-smoke-${process.pid}`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (!flags["no-build"]) {
  const t0 = Date.now();
  console.log(`building ${flags.image} from ${ROOT}`);
  await build();
  console.log(`built in ${Math.round((Date.now() - t0) / 1000)} s`);
}

const run = ["run", "--rm", "--name", name, "--cpus", flags.cpus, "--memory", flags.memory, "--memory-swap", flags.memory,
  "--network", "none", "--shm-size", "1g", "-v", `${out}:/out`, "-e", `SMOKE_REPEAT=${flags.repeat}`, "-e", `SMOKE_BROWSER=${flags.browser}`,
  ...(flags.platform ? ["--platform", flags.platform] : []), flags.image];
console.log(`docker ${run.join(" ")}`);
const started = Date.now();
const container = spawn("docker", run, { stdio: ["ignore", "inherit", "inherit"] });
let peakStats = 0;
const samples = [];
const sampler = setInterval(() => {
  try {
    const line = execFileSync("docker", ["stats", "--no-stream", "--format", "{{.MemUsage}}|{{.CPUPerc}}", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const [usage, cpu] = line.split("|");
    const used = bytes(usage.split("/")[0].trim());
    peakStats = Math.max(peakStats, used);
    samples.push({ t: Math.round((Date.now() - started) / 1000), mem: used, cpu: parseFloat(cpu) });
  } catch {}
}, 2000);
const timer = setTimeout(() => {
  console.error(`over the ${budgetSeconds} s budget: stopping ${name}`);
  try { execFileSync("docker", ["kill", name], { stdio: "ignore" }); } catch {}
}, (budgetSeconds + 60) * 1000);
const exitCode = await new Promise((resolve) => container.on("close", resolve));
clearInterval(sampler);
clearTimeout(timer);
const wallSeconds = Math.round((Date.now() - started) / 1000);
writeFileSync(path.join(out, "docker-stats.json"), JSON.stringify(samples));

const resultFile = path.join(out, "result.json");
const result = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, "utf8")) : null;
const tripwire = readLines(path.join(out, "tripwire.jsonl"));
const stub = readLines(path.join(out, "model-stub.jsonl")).filter((entry) => entry.schema !== undefined);
const peak = result?.cgroup?.memory_peak ?? null;
const ooms = result?.cgroup?.memory_events?.oom_kill ?? null;

const checks = [];
const check = (ok, label, detail) => checks.push({ ok: Boolean(ok), label, detail });
check(exitCode === 0 && result, "container ran to the end", `docker exit ${exitCode}`);
check(result?.exit?.code === 0, "make exited 0", JSON.stringify(result?.exit));
check(result && result.seconds <= budgetSeconds, `make finished inside ${budgetSeconds} s`, `${result?.seconds ?? "?"} s`);
const stages = Object.entries(result?.stages ?? {});
check(stages.length && stages.every(([, stage]) => ["done", "skipped"].includes(stage.status)), "every make stage done (or skipped)", stages.map(([stage, s]) => `${stage}=${s.status}${s.error ? ` (${s.error.split("\n")[0].slice(0, 200)})` : ""}`).join(", "));
const finishStages = result?.finish_stages ?? [];
check(finishStages.length && finishStages.every((stage) => ["done", "skipped", "reused"].includes(stage.status)), "every finish stage done (or skipped)", finishStages.map((stage) => `${stage.name}=${stage.status}`).join(", "));
const video = result?.video;
check(video?.bytes > 0 && video.probe?.streams?.some((stream) => stream.codec_type === "video"), "an MP4 came out", video ? `${video.file}, ${(video.bytes / 1e6).toFixed(1)} MB, ${video.probe?.duration?.toFixed?.(1)} s` : "none");
check(!tripwire.length, "no Whisper, Ollama or network/model download", tripwire.map((entry) => entry.command ?? entry.url).join(", ") || "none");
check(!(result?.model_cache ?? []).length, "no model weights on disk", (result?.model_cache ?? []).join(", ") || "none");
check(stub.length && stub.every((entry) => entry.answered), "only stubbed model passes", stub.map((entry) => entry.schema).join(", "));
check(peak != null && peak < limitBytes, `peak memory under ${flags.memory}`, `cgroup memory.peak ${gb(peak)}, docker stats peak ${gb(peakStats)}`);
check(ooms === 0, "no OOM kill in the container", `memory.events oom_kill=${ooms}`);

const summary = {
  limits: { cpus: flags.cpus, memory: flags.memory, network: "none" },
  wall_seconds: wallSeconds,
  make_seconds: result?.seconds ?? null,
  video_seconds: result?.duration_seconds ?? null,
  timings: result?.timings ?? null,
  finish_stages: finishStages.map((stage) => ({ name: stage.name, status: stage.status, seconds: stage.seconds })),
  memory_peak_bytes: peak,
  docker_stats_peak_bytes: peakStats,
  oom_kill: ooms,
  checks
};
writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));

console.log("\ncontainer smoke");
console.log(`  limits      --cpus ${flags.cpus} --memory ${flags.memory} --network none`);
console.log(`  make        ${result?.seconds ?? "?"} s for a ${result?.duration_seconds ?? "?"} s video (container wall ${wallSeconds} s)`);
if (result?.timings) console.log(`  stages      ${Object.entries(result.timings).map(([stage, s]) => `${stage} ${s}s`).join(", ")}`);
if (finishStages.length) console.log(`  finish      ${finishStages.map((stage) => `${stage.name} ${stage.seconds ?? "?"}s`).join(", ")}`);
console.log(`  browser     ${result?.browser ?? "?"}`);
console.log(`  memory      peak ${gb(peak)} (cgroup), ${gb(peakStats)} (docker stats), limit ${gb(limitBytes)}, oom_kill ${ooms}`);
for (const item of checks) console.log(`  ${item.ok ? "ok  " : "FAIL"}  ${item.label}${item.detail ? ` — ${item.detail}` : ""}`);
const written = ["summary.json", "result.json", "MAKE.json", "smoke.mp4", "docker-stats.json", "tripwire.jsonl", "model-stub.jsonl", "make-stdout.txt"].filter((file) => existsSync(path.join(out, file)));
console.log(`  files       ${path.relative(process.cwd(), out)}/ (${written.join(", ")})`);
process.exit(checks.every((item) => item.ok) ? 0 : 1);

async function build() {
  // The build context is what a pinned git checkout holds: tracked and
  // unignored files, never node_modules or local renders.
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT }).toString().split("\0").filter((file) => file && existsSync(path.join(ROOT, file)));
  const list = path.join(out, ".context-files");
  writeFileSync(list, files.join("\0"));
  // COPYFILE_DISABLE keeps macOS tar from adding AppleDouble ._ files.
  const tar = spawn("tar", ["--null", "-T", list, ...(process.platform === "darwin" ? ["--no-mac-metadata", "--no-xattrs"] : []), "--format", "ustar", "-cf", "-"], { cwd: ROOT, env: { ...process.env, COPYFILE_DISABLE: "1" }, stdio: ["ignore", "pipe", "inherit"] });
  const docker = spawn("docker", ["build", ...(flags.platform ? ["--platform", flags.platform] : []), "-t", flags.image, "-f", "scripts/container-smoke/Dockerfile", "-"], { stdio: [tar.stdout, "inherit", "inherit"] });
  const code = await new Promise((resolve) => docker.on("close", resolve));
  rmSync(list, { force: true });
  if (code !== 0) { console.error("docker build failed"); process.exit(1); }
}

function readLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } });
}

function bytes(text) {
  const match = /^([\d.]+)\s*([kmgt]?)i?b?$/i.exec(String(text).trim());
  if (!match) return NaN;
  return Number(match[1]) * 1024 ** "_kmgt".indexOf((match[2] || "_").toLowerCase());
}

function gb(value) { return value == null || Number.isNaN(value) ? "?" : `${(value / 1024 ** 3).toFixed(2)} GB`; }
