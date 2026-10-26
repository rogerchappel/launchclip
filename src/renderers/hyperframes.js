import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hyperframesInvocation } from "../toolchain.js";
import { adapterError, captureCommand, runCommand, structuredOk } from "./command.js";

// HyperFrames renderer adapter (docs/KIT_CONTRACTS.md "Renderer adapter").
// It wraps the same CLI invocations used by production_render.js,
// temporal_evidence.js and cinematic_check.js.
// HyperFrames kills an ffmpeg frame extraction after FFMPEG_PROCESS_TIMEOUT_MS
// (5 minutes by default) and then renders that video as black, with no error.
// A long 4K recording takes longer than that to decode, so renders give it
// 30 minutes unless the caller set the variable.
export const HYPERFRAMES_FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;

export function hyperframesRenderEnv(env = process.env) {
  return env.FFMPEG_PROCESS_TIMEOUT_MS ? env : { ...env, FFMPEG_PROCESS_TIMEOUT_MS: String(HYPERFRAMES_FFMPEG_TIMEOUT_MS) };
}

export function createHyperframesRenderer(defaults = {}) {
  const runner = (opts) => opts.run ?? defaults.run ?? runCommand;
  const hf = (run, args, options) => {
    const invocation = hyperframesInvocation(args);
    return captureCommand(run, invocation.command, invocation.args, options);
  };

  return {
    name: "hyperframes",

    renderArgs(projectDir, outFile, { quality = "draft", fps, workers = "auto", strictAll = false } = {}) {
      const args = ["render", "--output", path.resolve(outFile), "--quality", String(quality), "--workers", String(workers)];
      if (fps) args.push("--fps", String(fps));
      if (strictAll) args.push("--strict-all");
      args.push(path.resolve(projectDir));
      return args;
    },

    async render(projectDir, outFile, opts = {}) {
      const project = path.resolve(projectDir);
      await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
      const result = await hf(runner(opts), this.renderArgs(project, outFile, opts), { cwd: project, env: hyperframesRenderEnv() });
      if (!result.ok) throw adapterError("HyperFrames render", result);
      return { renderer: "hyperframes", output: path.resolve(outFile), raw: result };
    },

    async still(projectDir, seconds, outFile, opts = {}) {
      const project = path.resolve(projectDir);
      const at = Number(seconds);
      if (!Number.isFinite(at) || at < 0) throw new Error(`Invalid still time: ${seconds}`);
      const frames = await mkdtemp(path.join(os.tmpdir(), "launchclip-hf-still-"));
      try {
        const args = ["snapshot", "--at", snapshotTime(at), "--no-end", "--output", frames, "--describe", "false", project];
        const result = await hf(runner(opts), args, { cwd: project });
        if (!result.ok) throw adapterError("HyperFrames snapshot", result);
        const files = (await readdir(frames)).filter((name) => /^frame-.*\.(?:png|jpe?g|webp)$/i.test(name)).sort();
        if (!files.length) throw new Error(`HyperFrames snapshot produced no frame for t=${at}s`);
        await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
        await copyFile(path.join(frames, files[0]), path.resolve(outFile));
        return { renderer: "hyperframes", output: path.resolve(outFile), seconds: at, raw: result };
      } finally {
        await rm(frames, { recursive: true, force: true });
      }
    },

    // lint --json plus check --json --strict --snapshots --at-transitions,
    // exactly the pair cinematic-check ran before the adapter existed.
    async check(projectDir, opts = {}) {
      const project = path.resolve(projectDir);
      const strict = opts.strict ?? true;
      const run = runner(opts);
      const checks = {};
      for (const [name, args] of [
        ["lint", ["lint", "--json", project]],
        ["check", ["check", "--json", ...(strict ? ["--strict"] : []), "--snapshots", "--at-transitions", project]]
      ]) {
        const result = await hf(run, args, { cwd: project });
        checks[name] = { ...result, ok: result.ok && structuredOk(result.stdout) };
      }
      const findings = Object.entries(checks)
        .filter(([, value]) => !value.ok)
        .map(([name, value]) => ({ source: `hyperframes-${name}`, severity: "error", message: `hyperframes ${name} failed (exit ${value.exit_code})` }));
      return { status: findings.length ? "failed" : "passed", findings, raw: { renderer: "hyperframes", checks } };
    },

    previewCommand(projectDir, { port, open = true } = {}) {
      const args = ["preview"];
      if (port != null) args.push("--port", String(port));
      if (open === false) args.push("--no-open");
      args.push(path.resolve(projectDir));
      const invocation = hyperframesInvocation(args);
      return [invocation.command, ...invocation.args];
    }
  };
}

export const hyperframesRenderer = createHyperframesRenderer();

// `hyperframes snapshot --at` floors seconds × fps, so 9.0 can land on frame
// 269 through float error. A nudge far below one frame keeps the intended frame.
export function snapshotTime(seconds) {
  return String(Math.round((Number(seconds) + 1e-4) * 1e6) / 1e6);
}
