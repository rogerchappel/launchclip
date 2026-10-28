// The machine queue (docs/COLLECTIONS_RFC.md §5.3): one per machine, at
// $LAUNCHCLIP_HOME/queue/ (default ~/.launchclip/queue/), shared by every
// launchclip process — a batch, a make in another terminal, agent sessions.
//
//   <kind>-<n>.lock     a held slot: {pid, host, slot, n, project, label, started, token}
//   waiting/<…>.json    a job waiting for a slot, oldest first
//   .mutex/             held for the few milliseconds it takes to look and take
//
// A lock whose PID is gone (or was reused by a newer process) is stale and is
// removed. A job that can't get a slot waits and says so in one line; it never
// fails for lack of a slot. LAUNCHCLIP_QUEUE=off runs everything unqueued;
// LAUNCHCLIP_QUEUE_DIR moves the queue (the test runner points it at a
// temporary folder).
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { unlinkSync } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SLOT_KINDS, resolveSlots } from "./capacity.js";
import { pinnedHome } from "./state_dirs.js";

const MUTEX = ".mutex";
const MUTEX_STALE_MS = 10_000;
const DEFAULT_POLL_MS = 1000;
const held = new AsyncLocalStorage();
const owned = new Set();
let exitHookInstalled = false;

export function queueDir(env = process.env) {
  const pinned = pinnedHome("queue");
  if (pinned) return pinned;
  if (env.LAUNCHCLIP_QUEUE_DIR) return path.resolve(env.LAUNCHCLIP_QUEUE_DIR);
  return path.join(env.LAUNCHCLIP_HOME ?? path.join(os.homedir(), ".launchclip"), "queue");
}

export function queueEnabled(env = process.env) {
  return !["off", "0", "false"].includes(String(env.LAUNCHCLIP_QUEUE ?? "").toLowerCase());
}

/** "…/acme/launch" → "acme/launch": how a job is named to other jobs. */
export function projectLabel(project) {
  if (!project) return null;
  return path.resolve(project).split(path.sep).filter(Boolean).slice(-2).join("/");
}

/**
 * Run fn while holding a slot of this kind, waiting for one if needed. A
 * nested call for a kind this async context already holds runs straight away.
 * options: {project, label, count (default: the capacity slots), env, log, pollMs}
 */
export async function withSlot(kind, options, fn) {
  const env = options?.env ?? process.env;
  if (!queueEnabled(env) || held.getStore()?.has(kind)) return fn();
  const slot = await acquireSlot(kind, options);
  try {
    return await held.run(new Set([...(held.getStore() ?? []), kind]), fn);
  } finally {
    await slot.release();
  }
}

/** Take a slot, waiting as long as it takes. → {kind, n, file, release()} */
export async function acquireSlot(kind, options = {}) {
  if (!SLOT_KINDS.includes(kind)) throw new Error(`unknown slot "${kind}"; use ${SLOT_KINDS.join(", ")}`);
  const env = options.env ?? process.env;
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
  const count = options.count ?? resolveSlots({ env }).slots[kind];
  const pollMs = options.pollMs ?? (Number(env.LAUNCHCLIP_QUEUE_POLL_MS) || DEFAULT_POLL_MS);
  const dir = queueDir(env);
  const unqueued = { kind, n: null, file: null, release: async () => {} };
  try {
    await mkdir(path.join(dir, "waiting"), { recursive: true });
  } catch (error) {
    log(`queue: ${dir} is not writable (${error.code ?? error.message}); running without the machine queue`);
    return unqueued;
  }
  installExitHook();
  const token = randomBytes(6).toString("hex");
  const entry = { pid: process.pid, host: os.hostname(), slot: kind, project: options.project ? path.resolve(options.project) : null, label: options.label ?? projectLabel(options.project) ?? `pid ${process.pid}`, token };
  const queued = new Date().toISOString();
  const waiter = path.join(dir, "waiting", `${kind}-${Date.now().toString().padStart(15, "0")}-${process.pid}-${token}.json`);
  await writeFile(waiter, `${JSON.stringify({ ...entry, queued })}\n`);
  owned.add(waiter);
  let said = null;
  try {
    for (;;) {
      const outcome = await withMutex(dir, () => tryTake(dir, kind, count, entry, waiter));
      if (outcome.file) {
        owned.add(outcome.file);
        const release = async () => {
          owned.delete(outcome.file);
          await removeIfOurs(outcome.file, token);
        };
        return { kind, n: outcome.n, file: outcome.file, release };
      }
      const line = waitingLine(kind, count, outcome.holders, outcome.ahead);
      if (line !== said) log(line);
      said = line;
      await sleep(pollMs);
    }
  } finally {
    owned.delete(waiter);
    await rm(waiter, { force: true });
  }
}

// Inside the mutex: clear stale locks and waiters, then take the lowest free
// slot if this job is next in line.
async function tryTake(dir, kind, count, entry, waiter) {
  const locks = await liveEntries(dir, (name) => name.startsWith(`${kind}-`) && name.endsWith(".lock"), { prune: true });
  const waiters = (await liveEntries(path.join(dir, "waiting"), (name) => name.startsWith(`${kind}-`) && name.endsWith(".json"), { prune: true })).sort((a, b) => a.name.localeCompare(b.name));
  const ahead = Math.max(0, waiters.findIndex((item) => item.file === waiter));
  const holders = locks.map((item) => item.data);
  if (locks.length >= count || ahead >= count - locks.length) return { holders, ahead };
  const taken = new Set(locks.map((item) => item.data.n));
  let n = 1;
  while (taken.has(n)) n += 1;
  const file = path.join(dir, `${kind}-${n}.lock`);
  let handle;
  try {
    handle = await open(file, "wx");
  } catch (error) {
    // A lock too new to read yet holds that number: look again next time.
    if (error.code === "EEXIST") return { holders, ahead };
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ ...entry, n, started: new Date().toISOString() })}\n`);
  } finally {
    await handle.close();
  }
  return { file, n };
}

function waitingLine(kind, count, holders, ahead) {
  const who = holders.map((item) => item.label ?? `pid ${item.pid}`).join(", ");
  return `waiting for a${kind === "io" ? "n" : ""} ${kind} slot: ${holders.length} of ${count} in use${who ? ` by ${who}` : ""}${ahead ? `; ${ahead} job${ahead === 1 ? "" : "s"} ahead` : ""}`;
}

/**
 * Everything in the queue, across the machine, without changing it.
 * → {dir, slots, running: [...], waiting: [...]} with stale entries marked.
 */
export async function readQueue({ env = process.env, now = Date.now() } = {}) {
  const dir = queueDir(env);
  const { slots } = resolveSlots({ env });
  const age = (iso) => Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const running = (await liveEntries(dir, (name) => name.endsWith(".lock"), { keepStale: true }))
    .map(({ data, stale }) => ({ slot: data.slot, n: data.n, label: data.label, project: data.project, pid: data.pid, host: data.host, started: data.started, seconds: age(data.started), ...(stale ? { stale: true } : {}) }))
    .sort((a, b) => a.slot.localeCompare(b.slot) || a.n - b.n);
  const waiting = (await liveEntries(path.join(dir, "waiting"), (name) => name.endsWith(".json"), { keepStale: true }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ data, stale }) => ({ slot: data.slot, label: data.label, project: data.project, pid: data.pid, host: data.host, queued: data.queued, seconds: age(data.queued), ...(stale ? { stale: true } : {}) }));
  return { stage: "queue", dir, enabled: queueEnabled(env), slots, running, waiting };
}

export function formatQueue(report) {
  const lines = [`queue: ${report.dir}${report.enabled ? "" : " (off: LAUNCHCLIP_QUEUE)"}`];
  for (const kind of SLOT_KINDS) {
    const running = report.running.filter((item) => item.slot === kind && !item.stale);
    const waiting = report.waiting.filter((item) => item.slot === kind && !item.stale);
    lines.push(`${kind}: ${running.length} of ${report.slots[kind]} in use${waiting.length ? `, ${waiting.length} waiting` : ""}`);
    for (const item of running) lines.push(`  running  ${item.label}  pid ${item.pid}  ${duration(item.seconds)}`);
    for (const item of waiting) lines.push(`  waiting  ${item.label}  pid ${item.pid}  ${duration(item.seconds)}`);
  }
  const stale = [...report.running, ...report.waiting].filter((item) => item.stale).length;
  if (stale) lines.push(`${stale} stale entr${stale === 1 ? "y" : "ies"} (process gone); the next job to queue removes ${stale === 1 ? "it" : "them"}`);
  return `${lines.join("\n")}\n`;
}

function duration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m${String(seconds % 60).padStart(2, "0")}s` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

// Entries whose process is alive. prune: remove the rest (inside the mutex
// only); keepStale: return them marked stale.
async function liveEntries(dir, match, { prune = false, keepStale = false } = {}) {
  let names;
  try {
    names = (await readdir(dir)).filter(match);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let data;
    try {
      data = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      // A half-written or corrupt entry: stale once it is a few seconds old.
      data = null;
      const info = await stat(file).catch(() => null);
      if (info && Date.now() - info.mtimeMs < MUTEX_STALE_MS) continue;
    }
    const alive = data != null && processAlive(data.pid, data.host, data.started ?? data.queued);
    if (alive) out.push({ name, file, data });
    else if (prune) await rm(file, { force: true });
    else if (keepStale && data) out.push({ name, file, data, stale: true });
  }
  return out;
}

/**
 * Whether the process that wrote an entry is still running. Another host's
 * entry (a shared queue folder) counts as alive. A PID that now belongs to a
 * process started after the entry was written was reused: not alive.
 */
export function processAlive(pid, host = os.hostname(), since = null) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (host && host !== os.hostname()) return true;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== "EPERM") return false;
  }
  const started = since ? processStartedAt(pid) : null;
  return !(started && started - Date.parse(since) > 5000);
}

function processStartedAt(pid) {
  if (process.platform === "win32") return null;
  try {
    const text = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    const time = Date.parse(text);
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

// mkdir is atomic: whoever creates .mutex holds it. One left behind by a
// killed process is broken after MUTEX_STALE_MS (the work inside takes
// milliseconds).
async function withMutex(dir, fn) {
  const mutex = path.join(dir, MUTEX);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await mkdir(mutex);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const info = await stat(mutex).catch(() => null);
      if (info && Date.now() - info.mtimeMs > MUTEX_STALE_MS) await rm(mutex, { recursive: true, force: true });
      else await sleep(Math.min(100, 5 + attempt * 5));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(mutex, { recursive: true, force: true });
  }
}

async function removeIfOurs(file, token) {
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    if (data.token === token) await unlink(file);
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
}

// A process that exits without releasing (an uncaught error, process.exit)
// removes its own entries; one killed by a signal leaves them stale, and the
// next job to queue removes them.
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const file of owned) {
      try { unlinkSync(file); } catch { /* already gone */ }
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
