// Before a job writes into a library's storage it checks the target: the drive
// is mounted, the folder is writable, and it has storage.min_free_gb free
// (docs/COLLECTIONS_RFC.md §5.3). Each failure is one line naming the folder
// and what to do. storageGone() is the mid-job test: a job whose drive
// disappeared fails with a clear message instead of a stack of ENOENTs, and
// running the same command again resumes it.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = "StorageError";
    this.code = "LAUNCHCLIP_STORAGE";
  }
}

const GB = 1e9;

/**
 * The folder a removable drive mounts at, when target lives on one:
 * /Volumes/<name> (macOS), /media/<user>/<name>, /run/media/<user>/<name> or
 * /mnt/<name> (Linux). Null for anything else.
 */
export function mountPoint(target) {
  const parts = path.resolve(target).split(path.sep).filter(Boolean);
  const depth = parts[0] === "Volumes" || parts[0] === "mnt" ? 2
    : parts[0] === "media" ? 3
      : parts[0] === "run" && parts[1] === "media" ? 4
        : 0;
  if (!depth || parts.length < depth) return null;
  return path.join(path.sep, ...parts.slice(0, depth));
}

/**
 * Check that target can take a job. Creates target if its drive is there.
 * options: {minFreeGb, label (what the folder is, for messages), source (the library file)}
 * adapters: {statfs}
 * → {target, mount, free_gb, min_free_gb}; throws StorageError otherwise.
 */
export async function checkStorage(target, options = {}, adapters = {}) {
  const folder = path.resolve(target);
  const label = options.label ?? "storage";
  const hint = options.source ? ` (set in ${options.source})` : "";
  const mount = mountPoint(folder);
  if (mount && !existsSync(mount)) throw new StorageError(`${label}: ${mount} is not mounted; connect the drive or change the path${hint}`);
  try {
    await mkdir(folder, { recursive: true });
    const probe = path.join(folder, `.launchclip-write-check-${randomUUID()}`);
    await writeFile(probe, "");
    await rm(probe, { force: true });
  } catch (error) {
    throw new StorageError(`${label}: ${folder} is not writable (${error.code ?? error.message})${hint}`);
  }
  const minFreeGb = Number(options.minFreeGb ?? 0);
  const stats = await (adapters.statfs ?? statfs)(folder);
  const freeGb = (Number(stats.bavail) * Number(stats.bsize)) / GB;
  if (freeGb < minFreeGb) throw new StorageError(`${label}: ${folder} has ${formatGb(freeGb)} GB free; a job needs ${formatGb(minFreeGb)} GB (storage.min_free_gb${options.source ? ` in ${options.source}` : ""}). Free some space or move storage.projects`);
  return { target: folder, mount, free_gb: Math.round(freeGb * 10) / 10, min_free_gb: minFreeGb };
}

/**
 * Why target can no longer be written, or null while it is fine: its drive
 * was unmounted or the folder vanished.
 */
export function storageGone(target) {
  const folder = path.resolve(target);
  const mount = mountPoint(folder);
  if (mount && !existsSync(mount)) return `${mount} was disconnected`;
  if (!existsSync(folder)) return `${folder} disappeared`;
  return null;
}

/**
 * The StorageError for a job interrupted by storageGone(), naming the stage
 * and how to resume; null when the storage is still there.
 */
export function interruptedByStorage(target, { command, stage } = {}) {
  const reason = storageGone(target);
  if (!reason) return null;
  return new StorageError(`${command ?? "launchclip"} stopped${stage ? ` during ${stage}` : ""}: ${reason}. Reconnect it and run the same command again; finished stages are reused`);
}

function formatGb(value) {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}
