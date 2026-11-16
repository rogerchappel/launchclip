// Sample libraries on disk (docs/IMMERSIVE_SOUND_RFC.md §1): where they live,
// `launchclip sound fetch`, the local index, and decoding a zone for the
// sampler (kit/core/sound/sampler.mjs). Libraries are downloaded only when
// asked for, into $LAUNCHCLIP_CACHE/instruments/<library>/, and every file is
// checked against the SHA-256 pinned in kit/core/sound/instruments.mjs. A
// render never downloads: an instrument that is not installed plays synth.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SAMPLED_INSTRUMENTS, SAMPLE_LIBRARIES, SAMPLE_SETS } from "@launchclip/core/sound/instruments.mjs";
import { RATE } from "@launchclip/core/sound/dsp.mjs";
import { pinnedCache } from "../state_dirs.js";

const run = promisify(execFile);
const INDEX = "index.json";

/** $LAUNCHCLIP_CACHE/instruments, else ~/.cache/launchclip/instruments. */
export function instrumentsDir(env = process.env) {
  return pinnedCache("instruments") ?? (env.LAUNCHCLIP_CACHE ? path.join(env.LAUNCHCLIP_CACHE, "instruments") : path.join(os.homedir(), ".cache", "launchclip", "instruments"));
}

const zonePath = (dir, library, file) => path.join(dir, library, ...file.split("/"));
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** A fetch target (core, all, a library or an instrument) → instrument names. */
export function resolveTarget(target) {
  if (SAMPLE_SETS[target]) return SAMPLE_SETS[target];
  if (SAMPLE_LIBRARIES[target]) return Object.keys(SAMPLED_INSTRUMENTS).filter((name) => SAMPLED_INSTRUMENTS[name].library === target);
  if (SAMPLED_INSTRUMENTS[target]) return [target];
  throw new Error(`Unknown sound fetch target "${target}". Use ${Object.keys(SAMPLE_SETS).join(", ")}, a library (${Object.keys(SAMPLE_LIBRARIES).join(", ")}) or an instrument (${Object.keys(SAMPLED_INSTRUMENTS).join(", ")})`);
}

/**
 * Write <dir>/index.json from what is on disk: an instrument is installed when
 * every one of its zones is there at its pinned size. Returns the index
 * {schema_version, instruments: {name: {library, kind, release, zones}}, libraries}.
 */
export async function buildSampleIndex(dir) {
  const instruments = {};
  for (const [name, spec] of Object.entries(SAMPLED_INSTRUMENTS)) {
    const present = spec.zones.every(([file, , bytes]) => { try { return statSync(zonePath(dir, spec.library, file)).size === bytes; } catch { return false; } });
    if (present) instruments[name] = { library: spec.library, kind: spec.kind, release: spec.release, zones: spec.zones.map(([file, , , root, vel, rr]) => ({ file, root, vel, rr })) };
  }
  const libraries = [...new Set(Object.values(instruments).map((entry) => entry.library))].sort().map((id) => ({ id, title: SAMPLE_LIBRARIES[id].title, licence: SAMPLE_LIBRARIES[id].licence }));
  const index = { schema_version: "launchclip.sample-index.v1", instruments, libraries };
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, INDEX), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/** The index, or null when nothing was ever fetched. */
export function readSampleIndex(dir) {
  try { return JSON.parse(readFileSync(path.join(dir, INDEX), "utf8")); } catch { return null; }
}

/** Instruments the index lists whose files are still on disk. */
export function installedInstruments(dir) {
  const index = readSampleIndex(dir);
  const names = Object.entries(index?.instruments ?? {})
    .filter(([name, entry]) => SAMPLED_INSTRUMENTS[name] && entry.zones.every((zone) => existsSync(zonePath(dir, entry.library, zone.file))))
    .map(([name]) => name);
  return new Set(names);
}

/** The bytes still to download for these instruments: {files: [{library, zone}], archives: [library], bytes}. */
export function fetchPlan(instruments, dir) {
  const files = [];
  const archives = new Set();
  let bytes = 0;
  for (const name of instruments) {
    const spec = SAMPLED_INSTRUMENTS[name];
    const source = SAMPLE_LIBRARIES[spec.library].source;
    for (const zone of spec.zones) {
      const [file, , size] = zone;
      let ok = false;
      try { ok = statSync(zonePath(dir, spec.library, file)).size === size; } catch { ok = false; }
      if (ok) continue;
      if (source.kind === "archive") {
        if (!archives.has(spec.library)) bytes += source.bytes;
        archives.add(spec.library);
      } else {
        files.push({ library: spec.library, zone });
        bytes += size;
      }
    }
  }
  return { files, archives: [...archives], bytes };
}

async function download(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`sound fetch: ${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function writeVerified(file, buffer, expected, label) {
  const actual = sha256(buffer);
  if (actual !== expected) throw new Error(`sound fetch: ${label} has SHA-256 ${actual}, expected ${expected}; nothing was kept`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.part`, buffer);
  await rename(`${file}.part`, file);
}

/** Unpack an archive with the system's bsdtar (macOS tar reads 7z), else 7z. */
async function extract(archive, into) {
  try {
    await run("tar", ["-xf", archive, "-C", into]);
  } catch {
    try {
      await run("7z", ["x", "-y", `-o${into}`, archive]);
    } catch {
      throw new Error("sound fetch: cannot unpack a .7z archive; install p7zip (7z) or libarchive's bsdtar");
    }
  }
}

/**
 * Download what `target` needs into dir, verify every file, rebuild the index.
 * options: {dir, fetch, log, confirm(plan) → boolean}. Returns
 * {target, dir, instruments, downloaded_bytes, index} or {cancelled: true}.
 */
export async function fetchSamples(target, options = {}) {
  const dir = options.dir ?? instrumentsDir();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const log = options.log ?? (() => {});
  const instruments = resolveTarget(target);
  const plan = fetchPlan(instruments, dir);
  if (plan.bytes > 0 && options.confirm && !(await options.confirm(plan))) return { cancelled: true, target, dir, bytes: plan.bytes };
  let done = 0;
  for (const { library, zone } of plan.files) {
    const [file, hash] = zone;
    const url = SAMPLE_LIBRARIES[library].source.base + file.split("/").map(encodeURIComponent).join("/");
    await writeVerified(zonePath(dir, library, file), await download(fetchImpl, url), hash, `${library}/${file}`);
    done += 1;
    if (done % 20 === 0 || done === plan.files.length) log(`sound fetch: ${done}/${plan.files.length} files`);
  }
  for (const library of plan.archives) {
    const source = SAMPLE_LIBRARIES[library].source;
    const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-samples-"));
    try {
      const archive = path.join(temp, path.basename(new URL(source.url).pathname));
      log(`sound fetch: ${library} archive (${(source.bytes / 1e6).toFixed(1)} MB)`);
      await writeVerified(archive, await download(fetchImpl, source.url), source.sha256, `${library} archive`);
      const unpacked = path.join(temp, "x");
      await mkdir(unpacked);
      await extract(archive, unpacked);
      // Keep only the zones (audio) the manifest lists, each verified.
      for (const spec of Object.values(SAMPLED_INSTRUMENTS).filter((entry) => entry.library === library)) {
        for (const [file, hash] of spec.zones) await writeVerified(zonePath(dir, library, file), await readFile(path.join(unpacked, ...`${source.prefix}${file}`.split("/"))), hash, `${library}/${file}`);
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  const index = await buildSampleIndex(dir);
  return { target, dir, instruments, downloaded_bytes: plan.bytes, index };
}

const decoded = new Map();

/** A zone's audio as [L, R] Float32Array at RATE (decoded once per process). */
export async function loadZone(dir, library, file) {
  const full = zonePath(dir, library, file);
  if (!decoded.has(full)) {
    decoded.set(full, run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", full, "-ac", "2", "-ar", String(RATE), "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 1 << 30 }).then(({ stdout }) => {
      const interleaved = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 4));
      const frames = interleaved.length / 2;
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      for (let i = 0; i < frames; i++) { left[i] = interleaved[2 * i]; right[i] = interleaved[2 * i + 1]; }
      return [left, right];
    }));
  }
  return decoded.get(full);
}

/** `launchclip sound fetch <target> [--yes] [--dir path]`. */
export async function runSoundCommand(action, target, flags, io = {}) {
  if (action !== "fetch") throw new Error(`Unknown sound action: ${action ?? "(none)"}; use fetch`);
  if (!target) throw new Error(`Missing what to fetch, e.g. launchclip sound fetch core (${Object.keys(SAMPLE_SETS).join(", ")}, a library or an instrument)`);
  const dir = flags.dir ? path.resolve(String(flags.dir)) : instrumentsDir(io.env ?? process.env);
  const log = io.log ?? (() => {});
  const confirm = async (plan) => {
    const what = `${(plan.bytes / 1e6).toFixed(1)} MB (${plan.files.length} files${plan.archives.length ? ` + ${plan.archives.join(", ")} archive` : ""}) into ${dir}`;
    if (flags.yes) { log(`sound fetch: downloading ${what}`); return true; }
    if (!io.ask) throw new Error(`sound fetch would download ${what}; pass --yes to confirm`);
    return /^y(es)?$/i.test(String(await io.ask(`Download ${what}? [y/N] `)).trim());
  };
  return fetchSamples(target, { dir, fetch: io.fetch, log, confirm });
}
