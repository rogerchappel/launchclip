import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PRODUCTION_PATHS } from "./production_contracts.js";
import { writeMotionReport } from "./render_motion_analysis.js";
import { critiqueProduction } from "./production_critic.js";

const execFileAsync = promisify(execFile);

export async function verifyProduction(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const project = path.join(workspace, PRODUCTION_PATHS.hyperframes);
  const qaDir = path.join(workspace, PRODUCTION_PATHS.qa);
  const snapshots = path.join(qaDir, "snapshots");
  const plan = JSON.parse(await readFile(path.join(workspace, PRODUCTION_PATHS.plan), "utf8"));
  const run = adapters.run ?? runCommand;
  await Promise.all([mkdir(qaDir, { recursive: true }), mkdir(snapshots, { recursive: true })]);

  const checks = {};
  for (const [name, args] of [
    ["lint", ["hyperframes", "lint", "--json", project]],
    ["validate", ["hyperframes", "validate", "--json", "--timeout", String(options.timeoutMs ?? 8000), project]],
    ["inspect", ["hyperframes", "inspect", "--json", "--samples", String(options.inspectSamples ?? 15), "--at-transitions", project]]
  ]) {
    checks[name] = await capture(run, "npx", args, { cwd: project });
    if (name === "lint" && options.strictAll !== false) {
      const findings = checks[name].stdout?.findings ?? [];
      const warningCount = Number(checks[name].stdout?.warningCount ?? findings.filter((entry) => entry.severity === "warning").length);
      if (warningCount > 0) {
        checks[name].ok = false;
        checks[name].strict_warning_count = warningCount;
      }
    }
    await writeFile(path.join(qaDir, `${name}.json`), `${JSON.stringify(checks[name], null, 2)}\n`);
  }
  checks.snapshot = await capture(run, "npx", ["hyperframes", "snapshot", "--frames", String(options.snapshotFrames ?? 12), "--output", snapshots, project], { cwd: project });
  await writeFile(path.join(qaDir, "snapshot.json"), `${JSON.stringify(checks.snapshot, null, 2)}\n`);
  const failed = Object.entries(checks).filter(([, result]) => !result.ok).map(([name]) => name);
  const summary = {
    schema_version: "launchclip.production-verification.v1",
    project,
    plan: { duration_seconds: plan.format.duration_seconds, width: plan.format.width, height: plan.format.height },
    checks: Object.fromEntries(Object.entries(checks).map(([name, result]) => [name, { ok: result.ok, exit_code: result.exit_code, strict_warning_count: result.strict_warning_count ?? 0 }])),
    failed,
    snapshots
  };
  await writeFile(path.join(qaDir, "verification.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (failed.length) throw new Error(`HyperFrames verification failed: ${failed.join(", ")}. Review ${qaDir}.`);
  return { stage: "production-verify", status: "ready", workspace, project, qa: qaDir, snapshots, checks: summary.checks };
}

export async function renderProduction(workspacePath, options = {}, adapters = {}) {
  if (!options.approve) throw new Error("Final production render requires explicit --approve after reviewing the assembled project and snapshots");
  const workspace = path.resolve(workspacePath);
  const verification = await verifyProduction(workspace, options, adapters);
  const project = verification.project;
  const qaDir = verification.qa;
  const renderDir = path.join(workspace, "production", "renders");
  const output = path.resolve(options.output ?? path.join(renderDir, "final.mp4"));
  await mkdir(path.dirname(output), { recursive: true });
  const run = adapters.run ?? runCommand;
  const render = await capture(run, "npx", [
    "hyperframes", "render", "--output", output,
    "--quality", String(options.quality ?? "high"),
    "--workers", String(options.workers ?? "auto"),
    "--strict-all", "--skill", "product-launch-video", project
  ], { cwd: project });
  await writeFile(path.join(qaDir, "render.json"), `${JSON.stringify(render, null, 2)}\n`);
  if (!render.ok) throw new Error(`HyperFrames render failed. Review ${path.join(qaDir, "render.json")}.`);

  const plan = JSON.parse(await readFile(path.join(workspace, PRODUCTION_PATHS.plan), "utf8"));
  const motionPath = path.join(qaDir, "motion.json");
  const motion = adapters.writeMotionReport
    ? await adapters.writeMotionReport(output, motionPath, motionOptions(plan, options))
    : await writeMotionReport(output, motionPath, motionOptions(plan, options), adapters.motion);
  if (!motion.quality.ok) throw new Error(`Rendered video failed motion quality gates. Review ${motionPath}.`);
  const critique = adapters.critiqueProduction
    ? await adapters.critiqueProduction(workspace, criticOptions(options))
    : await critiqueProduction(workspace, criticOptions(options), adapters.critic);
  return {
    stage: "production-render",
    status: critique.verdict === "ship" ? "awaiting-human-review" : "needs-repair",
    workspace,
    video: output,
    verification,
    motion: motionPath,
    family: motion.family,
    critique
  };
}

function motionOptions(plan, options) {
  return {
    references: values(options.references).map((entry) => path.resolve(entry)),
    expected: {
      duration_seconds: plan.format.duration_seconds,
      width: plan.format.width,
      height: plan.format.height,
      duration_tolerance_seconds: Number(options.durationToleranceSeconds ?? .15),
      maximum_hold_ratio: Number(options.maximumHoldRatio ?? .985),
      minimum_bursts_per_minute: Number(options.minimumBurstsPerMinute ?? 4)
    }
  };
}

function criticOptions(options) {
  return {
    model: options.criticModel ?? "gpt-5.6",
    reasoning: options.criticReasoning ?? "xhigh",
    pro: Boolean(options.criticPro),
    background: options.background !== false,
    maxSnapshots: Number(options.maxCriticSnapshots ?? 12)
  };
}

async function capture(run, command, args, options) {
  try {
    const result = await run(command, args, options);
    return { ok: true, exit_code: Number(result.exitCode ?? result.exit_code ?? 0), stdout: parseOutput(result.stdout), stderr: String(result.stderr ?? "") };
  } catch (error) {
    return {
      ok: false,
      exit_code: Number(error.code ?? error.exitCode ?? 1),
      stdout: parseOutput(error.stdout),
      stderr: String(error.stderr ?? error.message ?? "").slice(0, 20_000)
    };
  }
}

function parseOutput(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text.slice(0, 40_000); }
}

function values(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

async function runCommand(command, args, options) {
  return execFileAsync(command, args, { ...options, maxBuffer: 1024 * 1024 * 128 });
}
