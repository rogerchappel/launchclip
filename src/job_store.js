import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRODUCTION_PATHS } from "./production_contracts.js";

export const JOB_STORE_VERSION = "launchclip.jobs.v1";

const JOB_STATUSES = new Set(["pending", "submitted", "running", "succeeded", "failed", "stale", "awaiting_approval"]);
const TRANSITIONS = new Map([
  ["pending", new Set(["submitted", "running", "failed", "stale"])],
  ["submitted", new Set(["running", "succeeded", "failed", "stale"])],
  ["running", new Set(["succeeded", "failed", "stale", "awaiting_approval"])],
  ["succeeded", new Set(["stale"])],
  ["failed", new Set(["pending", "stale"])],
  ["stale", new Set(["pending"])],
  ["awaiting_approval", new Set(["succeeded", "failed", "stale"])]]
);

export class ProductionJobStore {
  constructor(workspace, data) {
    this.workspace = path.resolve(workspace);
    this.filePath = safeWorkspacePath(this.workspace, PRODUCTION_PATHS.jobs);
    this.data = validateStore(data);
  }

  static async open(workspace, options = {}) {
    const resolved = path.resolve(workspace);
    const filePath = safeWorkspacePath(resolved, PRODUCTION_PATHS.jobs);
    let data;
    try {
      data = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT" || options.create === false) throw error;
      data = { schema_version: JOB_STORE_VERSION, revision: 0, jobs: [] };
    }
    return new ProductionJobStore(resolved, data);
  }

  list() {
    return structuredClone(this.data.jobs);
  }

  get(id) {
    const job = this.data.jobs.find((entry) => entry.id === id);
    return job ? structuredClone(job) : null;
  }

  ready() {
    const byId = new Map(this.data.jobs.map((job) => [job.id, job]));
    return this.data.jobs
      .filter((job) => job.status === "pending" && job.depends_on.every((dependency) => byId.get(dependency)?.status === "succeeded"))
      .map((job) => structuredClone(job));
  }

  async add(definition) {
    if (this.data.jobs.some((job) => job.id === definition.id)) throw new Error(`Job already exists: ${definition.id}`);
    const now = new Date().toISOString();
    const job = normalizeJob({
      ...definition,
      status: definition.status ?? "pending",
      attempt: definition.attempt ?? 0,
      max_attempts: definition.max_attempts ?? 3,
      remote: definition.remote ?? null,
      outputs: definition.outputs ?? [],
      usage: definition.usage ?? {},
      error: definition.error ?? null,
      created_at: definition.created_at ?? now,
      updated_at: now
    });
    this.data.jobs.push(job);
    validateDependencies(this.data.jobs);
    await this.save();
    return structuredClone(job);
  }

  async transition(id, status, patch = {}) {
    const job = this.require(id);
    if (!JOB_STATUSES.has(status)) throw new Error(`Unknown job status: ${status}`);
    if (job.status !== status && !TRANSITIONS.get(job.status)?.has(status)) throw new Error(`Invalid job transition: ${job.status} -> ${status}`);
    if ((status === "submitted" || status === "running") && job.attempt >= job.max_attempts) {
      throw new Error(`Job ${id} exhausted its ${job.max_attempts} attempts`);
    }
    if ((status === "submitted" || status === "running") && job.status === "pending") job.attempt += 1;
    Object.assign(job, patch, { status, updated_at: new Date().toISOString() });
    normalizeJob(job);
    await this.save();
    return structuredClone(job);
  }

  async markSubmitted(id, remote) {
    return this.transition(id, "submitted", { remote: normalizeRemote(remote), error: null });
  }

  async markRunning(id, remote = undefined) {
    return this.transition(id, "running", remote ? { remote: normalizeRemote(remote), error: null } : { error: null });
  }

  async markSucceeded(id, outputs = [], usage = {}) {
    return this.transition(id, "succeeded", { outputs: outputs.map(normalizeOutput), usage: usage ?? {}, error: null });
  }

  async markFailed(id, error, remote = undefined) {
    return this.transition(id, "failed", { error: sanitizeError(error), ...(remote ? { remote: normalizeRemote(remote) } : {}) });
  }

  async retry(id) {
    const job = this.require(id);
    if (job.status !== "failed" && job.status !== "stale") throw new Error(`Only failed or stale jobs can be retried: ${id}`);
    if (job.attempt >= job.max_attempts) throw new Error(`Job ${id} exhausted its ${job.max_attempts} attempts`);
    return this.transition(id, "pending", { remote: null, outputs: [], usage: {}, error: null });
  }

  async markStaleFrom(ids) {
    const stale = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const job of this.data.jobs) {
        if (!stale.has(job.id) && job.depends_on.some((dependency) => stale.has(dependency))) {
          stale.add(job.id);
          changed = true;
        }
      }
    }
    const now = new Date().toISOString();
    for (const job of this.data.jobs) {
      if (!stale.has(job.id)) continue;
      if (job.status === "stale") continue;
      if (!TRANSITIONS.get(job.status)?.has("stale")) throw new Error(`Cannot mark ${job.id} stale from ${job.status}`);
      Object.assign(job, { status: "stale", remote: null, outputs: [], error: null, updated_at: now });
    }
    await this.save();
    return [...stale];
  }

  async verifyOutputs(id) {
    const job = this.require(id);
    const results = [];
    for (const output of job.outputs) {
      const filePath = safeWorkspacePath(this.workspace, output.path);
      try {
        const info = await stat(filePath);
        const sha256 = info.isFile() ? await sha256File(filePath) : null;
        results.push({ path: output.path, exists: true, sha256, matches: sha256 === output.sha256 });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        results.push({ path: output.path, exists: false, sha256: null, matches: false });
      }
    }
    return { ok: results.every((entry) => entry.matches), outputs: results };
  }

  async save() {
    validateStore(this.data);
    this.data.revision += 1;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, this.filePath);
  }

  require(id) {
    const job = this.data.jobs.find((entry) => entry.id === id);
    if (!job) throw new Error(`Unknown job: ${id}`);
    return job;
  }
}

export async function withProductionLease(workspace, fn, options = {}) {
  const resolved = path.resolve(workspace);
  const lockPath = safeWorkspacePath(resolved, "production/.launchclip.lock");
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const info = await stat(lockPath);
    const ttlMs = Number(options.ttlMs ?? 30 * 60 * 1000);
    if (Date.now() - info.mtimeMs <= ttlMs) throw new Error(`Production workspace is already locked: ${resolved}`);
    await unlink(lockPath);
    handle = await open(lockPath, "wx", 0o600);
  }
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`);
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(lockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export function semanticHash(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export async function describeJobOutput(workspace, filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(path.resolve(workspace), resolved);
  const checked = safeWorkspacePath(workspace, relative);
  const info = await stat(checked);
  if (!info.isFile()) throw new Error(`Job output must be a file: ${filePath}`);
  return { path: relative.split(path.sep).join("/"), sha256: await sha256File(checked), size_bytes: info.size };
}

function validateStore(data) {
  if (!data || data.schema_version !== JOB_STORE_VERSION || !Array.isArray(data.jobs)) throw new Error(`Invalid job store; expected ${JOB_STORE_VERSION}`);
  if (!Number.isInteger(data.revision) || data.revision < 0) throw new Error("Job store revision must be a non-negative integer");
  const ids = new Set();
  data.jobs.forEach((job) => {
    normalizeJob(job);
    if (ids.has(job.id)) throw new Error(`Duplicate job id: ${job.id}`);
    ids.add(job.id);
  });
  validateDependencies(data.jobs);
  return data;
}

function normalizeJob(job) {
  if (!job?.id || !job?.kind || !job?.input_hash) throw new Error("Jobs require id, kind, and input_hash");
  if (!JOB_STATUSES.has(job.status)) throw new Error(`Unknown job status: ${job.status}`);
  if (!Array.isArray(job.depends_on)) throw new Error(`Job ${job.id} depends_on must be an array`);
  if (!Number.isInteger(job.attempt) || job.attempt < 0) throw new Error(`Job ${job.id} attempt must be a non-negative integer`);
  if (!Number.isInteger(job.max_attempts) || job.max_attempts < 1) throw new Error(`Job ${job.id} max_attempts must be positive`);
  if (job.attempt > job.max_attempts) throw new Error(`Job ${job.id} attempt exceeds max_attempts`);
  job.outputs = (job.outputs ?? []).map(normalizeOutput);
  job.usage = job.usage ?? {};
  job.remote = job.remote ? normalizeRemote(job.remote) : null;
  job.error = job.error == null ? null : sanitizeError(job.error);
  return job;
}

function validateDependencies(jobs) {
  const ids = new Set(jobs.map((job) => job.id));
  for (const job of jobs) {
    for (const dependency of job.depends_on) {
      if (!ids.has(dependency)) throw new Error(`Job ${job.id} depends on unknown job: ${dependency}`);
      if (dependency === job.id) throw new Error(`Job ${job.id} cannot depend on itself`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`Job graph contains a cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.depends_on ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const job of jobs) visit(job.id);
}

function normalizeRemote(remote) {
  if (!remote?.provider) throw new Error("Remote job metadata requires provider");
  return {
    provider: String(remote.provider),
    response_id: remote.response_id == null ? null : String(remote.response_id),
    status: remote.status == null ? null : String(remote.status)
  };
}

function normalizeOutput(output) {
  if (!output?.path || !output?.sha256) throw new Error("Job outputs require path and sha256");
  return { path: String(output.path), sha256: String(output.sha256), size_bytes: Number(output.size_bytes ?? 0) };
}

function sanitizeError(error) {
  const value = typeof error === "string" ? error : error?.message ?? String(error);
  return String(value).replace(/(?:sk-|xi-api-key\s*[:=]\s*)[a-z0-9_-]{12,}/gi, "[REDACTED]").slice(0, 4000);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const ignored = new Set(["created_at", "updated_at", "submitted_at", "completed_at"]);
  return Object.fromEntries(Object.keys(value).filter((key) => !ignored.has(key)).sort().map((key) => [key, canonicalize(value[key])]))
}

function safeWorkspacePath(workspace, relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error(`Production path must be relative: ${relativePath}`);
  const root = path.resolve(workspace);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Production path escapes workspace: ${relativePath}`);
  return resolved;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
