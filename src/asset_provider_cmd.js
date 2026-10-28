// An asset provider (src/asset_provider.js) that runs as an app's own
// command: `launchclip make --asset-provider-cmd "<cmd>"`. The command is
// started once, through the shell, and kept running for the plan; each
// findShot(request) writes the request as one JSON line to its stdin and
// reads one JSON line from its stdout: a shot, or null. Requests go one at a
// time. An answer that echoes the request's `id` is matched by it (so a late
// answer to a request that timed out is dropped); one without is the answer
// to the oldest open request. A line that is not JSON, a command that exits,
// or no answer within timeoutMs counts as no shot for that request (the
// planner then designs the scene without one). stderr goes to notice().
// close() ends the command.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export const ASSET_PROVIDER_TIMEOUT_MS = 120_000;

export function createCommandAssetProvider(command, { timeoutMs = ASSET_PROVIDER_TIMEOUT_MS, notice = (line) => process.stderr.write(`${line}\n`), env = process.env, cwd = process.cwd() } = {}) {
  if (!String(command ?? "").trim()) throw new Error("--asset-provider-cmd needs a command");
  let child = null;
  let exited = null;
  let lines = null;
  const waiting = [];
  let queue = Promise.resolve();

  function start() {
    if (child) return;
    child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"], env, cwd });
    child.on("error", (error) => finish(`could not start: ${error.message}`));
    child.on("exit", (code, signal) => finish(`exited (${signal ?? code})`));
    child.stdin.on("error", () => {});
    lines = createInterface({ input: child.stdout });
    lines.on("line", onLine);
    createInterface({ input: child.stderr }).on("line", (line) => notice(`asset provider: ${line}`));
  }

  // waiting: [{id, answer(line|null) | null (timed out: drop its answer)}].
  function onLine(line) {
    let id = null;
    try { id = JSON.parse(line)?.id ?? null; } catch {}
    const byId = id == null ? -1 : waiting.findIndex((entry) => entry.id === id);
    const [entry] = waiting.splice(byId >= 0 ? byId : 0, 1);
    entry?.answer?.(line);
  }

  function finish(reason) {
    if (exited) return;
    exited = reason;
    notice(`asset provider ${reason}`);
    while (waiting.length) waiting.shift().answer?.(null);
  }

  function ask(request) {
    start();
    if (exited) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Keep the slot: a late answer is this request's, and is dropped.
        const slot = waiting.find((entry) => entry.answer === answer);
        if (slot) slot.answer = null;
        notice(`asset provider: no answer for ${request.id} within ${Math.round(timeoutMs / 1000)} s`);
        resolve(null);
      }, timeoutMs);
      function answer(line) {
        clearTimeout(timer);
        if (line == null) return resolve(null);
        try {
          resolve(JSON.parse(line));
        } catch {
          notice(`asset provider: not JSON for ${request.id}: ${String(line).slice(0, 200)}`);
          resolve(null);
        }
      }
      waiting.push({ id: request.id ?? null, answer });
      child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  return {
    findShot(request) {
      const next = queue.then(() => ask(request));
      queue = next.catch(() => null);
      return next;
    },
    async close() {
      if (!child || exited) return;
      child.stdin.end();
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
  };
}
