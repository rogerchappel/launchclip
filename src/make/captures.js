// Recording research's capture requests inside `launchclip make`
// (docs/MAKE_SKILL_PARITY.md, phase 5). Research writes one
// launchclip.capture.v1 request per source chosen to appear on screen
// (research/captures/<id>.json); this records each into the clip its `out`
// names (assets/evidence/<id>.mp4, with <id>.poster.png and
// <id>.evidence.json beside it), so the director can put the page itself on
// screen. A clip already recorded is kept.
//
// Two recorders:
// - local (default): src/evidence/capture.js in this process, a few at a
//   time. Needs the optional playwright dependency, a Chromium and ffmpeg;
//   without them make goes on with no captures and says why.
// - --capture-cmd "<cmd>": an app's own recorder (another machine, a sandboxed
//   service). The command is started once and kept running; each request is
//   one JSON line on its stdin, {"id", "request", "out_dir"}, and it answers
//   one JSON line per request on stdout, {"id", "ok": true, "files": {"clip",
//   "poster", "sidecar"}} or {"id", "ok": false, "reason"}. Several requests
//   are in flight at once and answers may come in any order (matched by id).
//   A request with no answer in time, or a command that exits, is a failed
//   capture, never a failed video.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { RESEARCH_PATHS } from "../research/schema.js";

export const CAPTURE_TIMEOUT_MS = 240_000;
export const CAPTURE_CONCURRENCY = { local: 2, command: 4 };

/** The research dir's capture requests, in id order. */
export async function readCaptureRequests(project) {
  const dir = path.join(project, RESEARCH_PATHS.dir, RESEARCH_PATHS.captures);
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const out = [];
  for (const name of names) {
    try { out.push(JSON.parse(await readFile(path.join(dir, name), "utf8"))); } catch { /* a broken request is skipped */ }
  }
  return out;
}

/** The files a request records into, relative to the project: {clip, poster, sidecar}. */
export function captureFiles(request) {
  const clip = request.out ?? `assets/evidence/${request.id}.mp4`;
  const base = path.join(path.dirname(clip), request.id);
  return { clip, poster: `${base}.poster.png`, sidecar: `${base}.evidence.json` };
}

/**
 * Record every request whose clip is missing. options: {project, command,
 * concurrency, timeoutMs, env, say, capture (local recorder, for tests),
 * spawn (for tests)}. → {recorded: [request], failed: [{id, url, reason}], reused,
 * usage: the sums of what the app's recorder reported per capture ({seconds, …}), for billing}
 */
export async function recordCaptures(requests, options = {}) {
  const { project, say = () => {} } = options;
  const todo = [], recorded = [];
  let reused = 0;
  for (const request of requests) {
    if (existsSync(path.join(project, captureFiles(request).clip)) && existsSync(path.join(project, captureFiles(request).sidecar))) { recorded.push(request); reused += 1; }
    else todo.push(request);
  }
  const failed = [];
  const usage = {};
  if (!todo.length) return { recorded, failed, reused, usage };
  const recorder = options.command ? commandRecorder(options) : await localRecorder(options);
  if (!recorder.ok) {
    for (const request of todo) failed.push({ id: request.id, url: request.url, reason: recorder.reason });
    return { recorded, failed, reused, usage };
  }
  const size = Math.max(1, Number(options.concurrency) || (options.command ? CAPTURE_CONCURRENCY.command : CAPTURE_CONCURRENCY.local));
  say(`captures: recording ${todo.length} source page${todo.length === 1 ? "" : "s"} (${options.command ? "app recorder" : "local Chromium"}, ${size} at a time)`);
  let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(size, todo.length) }, async () => {
      while (next < todo.length) {
        const request = todo[next++];
        try {
          const answer = await recorder.record(request);
          for (const [key, value] of Object.entries(answer?.usage ?? {})) if (Number.isFinite(value)) usage[key] = (usage[key] ?? 0) + value;
          recorded.push(request);
          say(`captures: ${request.id} recorded (${request.url})`);
        } catch (error) {
          failed.push({ id: request.id, url: request.url, reason: error.message });
          say(`captures: ${request.id} not recorded (${error.message})`);
        }
      }
    }));
  } finally {
    await recorder.close?.();
  }
  const order = new Map(requests.map((request, index) => [request.id, index]));
  recorded.sort((a, b) => order.get(a.id) - order.get(b.id));
  return { recorded, failed, reused, usage };
}

async function localRecorder({ project, capture, say = () => {} }) {
  const recorder = capture ?? await import("../evidence/capture.js").then((module) => module.captureEvidence);
  if (!capture) {
    const { recorderAvailability } = await import("../demo/record.js");
    const available = await recorderAvailability();
    if (!available.ok) return { ok: false, reason: `no local recorder: ${available.reasons.join("; ")}` };
  }
  return { ok: true, record: (request) => recorder(request, { root: project, log: (line) => say(`captures: ${line}`) }) };
}

function commandRecorder({ project, command, timeoutMs = CAPTURE_TIMEOUT_MS, env = process.env, say = () => {}, spawn: spawnFn = spawn }) {
  const child = spawnFn(command, { shell: true, cwd: project, env, stdio: ["pipe", "pipe", "pipe"] });
  const open = new Map();
  let exited = null;
  const fail = (reason) => { for (const [, entry] of open) entry.reject(new Error(reason)); open.clear(); };
  child.on("exit", (code, signal) => { exited = `the capture command exited (${signal ?? code})`; fail(exited); });
  child.on("error", (error) => { exited = `the capture command failed to start (${error.message})`; fail(exited); });
  createInterface({ input: child.stderr }).on("line", (line) => say(`captures: ${line}`));
  createInterface({ input: child.stdout }).on("line", (line) => {
    let answer;
    try { answer = JSON.parse(line); } catch { say(`captures: ignored a line that is not JSON from the capture command`); return; }
    const entry = open.get(String(answer?.id ?? ""));
    if (!entry) return;
    open.delete(String(answer.id));
    if (answer.ok) entry.resolve(answer); else entry.reject(new Error(answer.reason || "the capture command could not record it"));
  });
  return {
    ok: true,
    async record(request) {
      if (exited) throw new Error(exited);
      const files = captureFiles(request);
      const outDir = path.join(project, path.dirname(files.clip));
      await mkdir(outDir, { recursive: true });
      const answer = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { open.delete(request.id); reject(new Error(`no answer from the capture command in ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
        open.set(request.id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
        child.stdin.write(`${JSON.stringify({ id: request.id, request, out_dir: outDir })}\n`);
      });
      // The command may write anywhere it was told; the project keeps the clip where the request names it.
      for (const key of ["clip", "poster", "sidecar"]) {
        const from = answer.files?.[key];
        const to = path.join(project, files[key]);
        if (!from) { if (key === "poster") continue; throw new Error(`the capture command returned no ${key}`); }
        if (path.resolve(from) !== to) await copyFile(path.resolve(project, from), to);
      }
      return answer;
    },
    async close() {
      if (exited) return;
      child.stdin.end();
      await new Promise((resolve) => { const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.on("exit", () => { clearTimeout(timer); resolve(); }); });
    }
  };
}
