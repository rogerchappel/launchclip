#!/usr/bin/env node
// Render capacity benchmark (docs/COLLECTIONS_RFC.md §5.2): peak RSS, CPU
// time and wall time per rendered second for one fixture, per renderer,
// quality and core share, plus two renders at once, so the render-slot rule
// in src/capacity.js can be fitted to measurements.
//
//   node benchmarks/render-capacity/run.mjs [--fixture examples/story/promo-16x9]
//     [--renderers remotion,hyperframes] [--qualities draft,high]
//     [--shares 5,10] [--parallel 2] [--out benchmarks/render-capacity/results]
//
// Each render runs as a child process; its whole process tree is sampled every
// 200 ms with ps. Chromium is launched detached (its own process group, and
// its helpers outlive a killed parent), so the tree is followed by parent PID
// and a process stays counted once seen. CPU time is each process's last
// cumulative CPU; peak RSS is the largest sum over the tree, where shared
// pages count once per process, so it overstates real use a little.
// Results go to <out>/<cpu>-<cores>c-<ram>gb-<date>.json and a table is printed. Record the
// numbers in benchmarks/RENDER_CAPACITY.md.
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureMachine, recommendSlots } from "../../src/capacity.js";
import { readProjectStory } from "../../src/story_loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const JOB = path.join(ROOT, "benchmarks/render-capacity/render-job.mjs");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, i, all) => (token.startsWith("--") ? [...pairs, [token.slice(2), all[i + 1]]] : pairs), []));
const fixture = path.resolve(ROOT, args.fixture ?? "examples/story/promo-16x9");
const renderers = (args.renderers ?? "remotion,hyperframes").split(",");
const qualities = (args.qualities ?? "draft,high").split(",");
const machine = measureMachine();
const shares = (args.shares ?? `${Math.floor(machine.cores / recommendSlots(machine).render)},${machine.cores}`).split(",").map(Number);
const parallel = Number(args.parallel ?? 2);
const outDir = path.resolve(ROOT, args.out ?? "benchmarks/render-capacity/results");

const work = await mkdtemp(path.join(os.tmpdir(), "launchclip-bench-"));
try {
  const project = path.join(work, "project");
  await cp(fixture, project, { recursive: true });
  const story = await readProjectStory(project);
  const seconds = Number(story.resolved?.resolved?.duration ?? story.format.duration);
  const prepared = { remotion: project };
  if (renderers.includes("hyperframes")) {
    const { compileStoryToHyperFrames } = await import("../../kit/hyperframes/story-compiler.mjs");
    prepared.hyperframes = path.join(work, "hyperframes");
    await compileStoryToHyperFrames(story.resolved, { projectDir: prepared.hyperframes, sourceDir: project });
  }
  // One untimed render per renderer first: bundles, browser downloads and caches.
  for (const renderer of renderers) await measure([{ renderer, quality: "draft", share: shares[0] }]);

  const runs = [];
  for (const renderer of renderers) {
    for (const quality of qualities) {
      for (const share of shares) runs.push(await record([{ renderer, quality, share }]));
    }
    // Two (or --parallel) renders at once at the shared core split, against one alone.
    if (parallel > 1) runs.push(await record(Array.from({ length: parallel }, () => ({ renderer, quality: "draft", share: Math.max(1, Math.floor(machine.cores / parallel)) }))));
  }
  const result = { fixture: path.relative(ROOT, fixture), rendered_seconds: seconds, format: story.format, machine, when: new Date().toISOString(), runs };
  await mkdir(outDir, { recursive: true });
  // Named by the hardware, not the host name.
  const slug = `${String(machine.cpu_model ?? machine.arch).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${machine.cores}c-${Math.round(machine.ram_gb)}gb`;
  const file = path.join(outDir, `${slug}-${result.when.slice(0, 10)}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(table(result));
  process.stdout.write(`\nwrote ${path.relative(ROOT, file)}\n`);

  async function record(jobs) {
    const label = `${jobs.length > 1 ? `${jobs.length}× ` : ""}${jobs[0].renderer} ${jobs[0].quality} @${jobs[0].share}`;
    process.stderr.write(`render: ${label} ...\n`);
    const measured = await measure(jobs);
    const cpu = measured.cpu;
    const videoSeconds = seconds * jobs.length;
    const run = {
      label, renderer: jobs[0].renderer, quality: jobs[0].quality, share: jobs[0].share, parallel: jobs.length,
      load_before: measured.load,
      wall_s: round(measured.wall), cpu_s: round(cpu), peak_rss_gb: round(measured.peakRssKb / 1024 / 1024),
      wall_per_rendered_s: round(measured.wall / videoSeconds), cpu_per_rendered_s: round(cpu / videoSeconds),
      cores_busy: round(cpu / measured.wall),
      peak_rss_per_render_gb: round(measured.peakRssKb / 1024 / 1024 / jobs.length)
    };
    process.stderr.write(`  ${run.wall_s} s wall, ${run.cpu_s} s CPU, ${run.peak_rss_gb} GB peak\n`);
    return run;
  }

  // Start the jobs together and sample their process trees.
  async function measure(jobs) {
    const load = os.loadavg()[0];
    const started = performance.now();
    const children = jobs.map(({ renderer, quality, share }, i) => {
      const out = path.join(work, `out-${renderer}-${quality}-${share}-${i}.mp4`);
      const child = spawn(process.execPath, [JOB, prepared[renderer], renderer, quality, String(share), out], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const exited = new Promise((resolve, reject) => child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${renderer} ${quality} exited ${code}:\n${stderr.slice(-2000)}`))));
      return { child, exited };
    });
    const tree = new Set(children.map(({ child }) => child.pid));
    const cpu = new Map();
    let peakRssKb = 0;
    const sample = () => {
      let rows;
      try {
        rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,time="], { encoding: "utf8" }).trim().split("\n").map((row) => row.trim().split(/\s+/));
      } catch { return; }
      // Grow the tree until no new descendant turns up.
      for (let grew = true; grew;) {
        grew = false;
        for (const [pid, ppid] of rows) if (tree.has(Number(ppid)) && !tree.has(Number(pid))) { tree.add(Number(pid)); grew = true; }
      }
      let rss = 0;
      for (const [pid, , kb, time] of rows) {
        if (!tree.has(Number(pid))) continue;
        rss += Number(kb);
        cpu.set(Number(pid), cpuSeconds(time));
      }
      peakRssKb = Math.max(peakRssKb, rss);
    };
    const timer = setInterval(sample, 200);
    try {
      await Promise.all(children.map(({ exited }) => exited));
      return { wall: (performance.now() - started) / 1000, cpu: [...cpu.values()].reduce((sum, value) => sum + value, 0), peakRssKb, load: round(load) };
    } finally {
      clearInterval(timer);
    }
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

// ps cumulative CPU: "1:02.53" (macOS) or "00:01:02" (Linux) → seconds.
function cpuSeconds(text) {
  return String(text).split(":").reduce((sum, part) => sum * 60 + Number(part.replace(/^(\d+)-/, (_, days) => { throw new Error(`a render ran ${days} days`); })), 0);
}

function table(result) {
  const head = `${result.fixture}: ${result.rendered_seconds} s at ${result.format.width}×${result.format.height} ${result.format.fps} fps; ${result.machine.cpu_model}, ${result.machine.cores} cores, ${result.machine.ram_gb} GB\n\n`;
  const rows = [["run", "wall s", "CPU s", "cores busy", "wall/rendered s", "CPU/rendered s", "peak RSS GB", "per render GB", "load before"],
    ...result.runs.map((run) => [run.label, run.wall_s, run.cpu_s, run.cores_busy, run.wall_per_rendered_s, run.cpu_per_rendered_s, run.peak_rss_gb, run.peak_rss_per_render_gb, run.load_before])];
  return head + rows.map((row, i) => `| ${row.join(" | ")} |${i === 0 ? `\n|${row.map(() => "---").join("|")}|` : ""}`).join("\n") + "\n";
}

function round(value) {
  return Math.round(value * 100) / 100;
}
