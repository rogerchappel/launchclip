// The SFX library: a locked set of processed sound files per cue family,
// described by library.json (launchclip.sfx-library.v1). `launchclip sfx seed`
// writes it once; `finish` resolves every cue through it so the sound of a
// project stays the same across videos until the user rerolls a family.
//
// Resolution order for a cue family:
//   1. an explicit library path (finish --sfx-library, or a style pack's
//      sound.sfx_library)
//   2. the project library      <project>/.launchclip/sfx/library.json
//   3. the user library         ~/.launchclip/sfx/library.json
//   4. the procedural kit       synth-audio-kit.mjs output (always present)
// The first source that has the family wins; families missing from a library
// fall through to the next source.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "../atomic_write.js";
import { densityValue } from "@launchclip/core/sound/options.mjs";

export const LIBRARY_SCHEMA = "launchclip.sfx-library.v1";
export const LIBRARY_FILE = "library.json";
export const PROJECT_LIBRARY_DIR = ".launchclip/sfx";
export const SFX_DENSITIES = Object.freeze(["low", "normal", "high"]);

// Family aliases accepted by --only / --reroll.
export const FAMILY_ALIASES = Object.freeze({
  typing: ["keystroke", "keystroke-space", "keystroke-enter"],
  keys: ["keystroke", "keystroke-space", "keystroke-enter"],
  keyboard: ["keystroke", "keystroke-space", "keystroke-enter"],
  ui: ["click", "tick", "pop"]
});

/** "whoosh,typing" or ["whoosh", "typing"] → unique family names (aliases expanded). */
export function expandFamilies(list) {
  if (list === undefined || list === null || list === true) return null;
  const names = (Array.isArray(list) ? list : [list]).flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return [...new Set(names.flatMap((name) => FAMILY_ALIASES[name] ?? [name]))];
}

export function userLibraryDir({ home = os.homedir(), env = process.env } = {}) {
  return env.LAUNCHCLIP_SFX_HOME ? path.resolve(env.LAUNCHCLIP_SFX_HOME) : path.join(home, ".launchclip", "sfx");
}

export function emptyManifest(now = new Date().toISOString()) {
  return { schema_version: LIBRARY_SCHEMA, created_at: now, updated_at: now, sample_rate: 48000, generations: 0, families: {} };
}

/** Read <dir>/library.json; null when absent. Throws on a malformed manifest. */
export async function readLibrary(dir) {
  const file = path.join(path.resolve(dir), LIBRARY_FILE);
  if (!existsSync(file)) return null;
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (manifest?.schema_version !== LIBRARY_SCHEMA) throw new Error(`${file} is not a ${LIBRARY_SCHEMA} manifest`);
  if (!manifest.families || typeof manifest.families !== "object") throw new Error(`${file} has no families`);
  return { dir: path.resolve(dir), file, manifest };
}

export async function writeLibrary(dir, manifest) {
  const file = path.join(path.resolve(dir), LIBRARY_FILE);
  await writeFileAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

export function hashOf(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

/**
 * The ordered libraries finish consults: [{scope, dir, file, manifest}].
 * library: an explicit library directory (or its library.json) that wins over
 * the project and user libraries; it must exist when given.
 */
export async function resolveLibraries({ project, library, home, env = process.env } = {}) {
  const found = [];
  const seen = new Set();
  const add = async (scope, dir, required = false) => {
    if (!dir) return;
    const resolved = path.resolve(path.basename(dir) === LIBRARY_FILE ? path.dirname(dir) : dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    const loaded = await readLibrary(resolved);
    if (!loaded) {
      if (required) throw new Error(`SFX library not found: ${path.join(resolved, LIBRARY_FILE)}. Seed it with: launchclip sfx seed --dir ${resolved}`);
      return;
    }
    found.push({ scope, ...loaded });
  };
  await add("explicit", library ? path.resolve(project ?? ".", library) : null, true);
  if (project) await add("project", path.join(project, PROJECT_LIBRARY_DIR));
  await add("user", userLibraryDir({ home, env }));
  return found;
}

/**
 * The procedural kit as a pseudo-library: {scope: "kit", dir, families:
 * {family: [file names]}} from AUDIO-KIT.json, or the historic single file
 * per family when the kit manifest lists none.
 */
export function kitLibrary(sfxDir, kitManifest = null) {
  const families = kitManifest?.families && typeof kitManifest.families === "object" ? kitManifest.families : {};
  return { scope: "kit", dir: sfxDir, families };
}

/** Variants of a family from the first source that has it, or null. */
export function familySource(family, libraries = [], kit = null) {
  for (const library of libraries) {
    const variants = libraryVariants(library, family);
    const entry = library.manifest.families?.[family];
    if (variants.length) {
      return {
        scope: library.scope,
        dir: library.dir,
        source: entry.source ?? variants[0].source ?? "unknown",
        files: variants.map((variant) => path.resolve(library.dir, variant.file)),
        measurements: variants.map((variant) => variant.measurements ?? null)
      };
    }
  }
  if (!kit) return null;
  const names = kit.families?.[family]?.length ? kit.families[family] : [`${family}.wav`];
  return { scope: "kit", dir: kit.dir, source: "procedural", files: names.map((name) => path.resolve(kit.dir, name)), measurements: names.map(() => null) };
}

/** A family's variants in a library whose files exist on disk (a deleted file never resolves). */
export function libraryVariants(library, family) {
  const entry = library?.manifest?.families?.[family];
  return (entry?.variants ?? []).filter((variant) => variant?.file && existsSync(path.resolve(library.dir, variant.file)));
}

/** Families of `known` that a library has no usable variant for. */
export function missingFamilies(library, known) {
  return known.filter((family) => !libraryVariants(library, family).length);
}

/**
 * Families `used` that no library has, so they fall back to the procedural
 * kit, when there is at least one library to miss them from. → [family]
 */
export function libraryFallbacks(used, libraries = []) {
  if (!libraries.length) return [];
  return [...new Set(used)].filter((family) => !libraries.some((library) => libraryVariants(library, family).length)).sort();
}

/** A deterministic number in [0, 1) from a key. */
export function unitHash(key) {
  return parseInt(hashOf(String(key)).slice(0, 12), 16) / 2 ** 48;
}

/** Deterministic variant index in [0, count) for a key. */
export function pickVariant(count, key) {
  if (!(count > 0)) return -1;
  return Math.floor(unitHash(key) * count);
}

/**
 * Resolve one bound cue to a file: {file, scope, source, variant (1-based),
 * measurements}. key: the stable per-event key (story id + event id). turn:
 * the cue's place among its family's repeats; with it, the key seeds where
 * the rotation starts and repeats take the variants in turn.
 */
export function resolveCueFile(cue, { libraries = [], kit = null, key, turn } = {}) {
  const family = familySource(cue.cue, libraries, kit);
  if (!family) return null;
  const count = family.files.length;
  const index = Number.isInteger(turn) ? (pickVariant(count, key ?? cue.cue) + turn) % count : pickVariant(count, key ?? `${cue.cue}:${cue.at}`);
  return { file: family.files[index], scope: family.scope, source: family.source, variant: index + 1, measurements: family.measurements[index] };
}

/** Stable event key for variant picking. */
export function eventKey(storyId, cue) {
  return `${storyId}|${cue.shot ?? ""}|${cue.source ?? ""}|${cue.event ?? ""}|${cue.cue}|${cue.at}`;
}

/**
 * A density (low, normal, high, or a style pack's sound.sfx_density from 0
 * to 1) → a number in [0, 1]. low is 0.25, normal 0.6, high 1. Throws on
 * anything else.
 */
export function densityAmount(density = "normal") {
  const value = densityValue(density ?? "normal");
  if (value === null) throw new Error(`sfx density must be one of ${SFX_DENSITIES.join(", ")} or a number from 0 to 1; got ${density}`);
  return value;
}

/**
 * Thin cues for a density. "normal" and "high" (0.6 and above) keep every
 * cue; "low" (0.25) keeps hits and drops about half of the optional cues
 * (module events, transitions, word ticks) by a deterministic hash of their
 * event key. In between, the share of optional cues kept scales linearly;
 * below 0.25 the hits thin too, down to about a third at 0.
 */
export function applyDensity(cues, density = "normal", storyId = "") {
  const value = densityAmount(density);
  if (value >= 0.6) return cues;
  const keepOptional = value >= 0.25 ? 0.5 + ((value - 0.25) / 0.35) * 0.5 : 0.5 * (0.4 + (0.6 * value) / 0.25);
  const keepHits = value >= 0.25 ? 1 : 0.35 + (0.65 * value) / 0.25;
  return cues.filter((cue) => (cue.optional ? unitHash(`density|${eventKey(storyId, cue)}`) < keepOptional : keepHits >= 1 || unitHash(`density-hit|${eventKey(storyId, cue)}`) < keepHits));
}

/** Typing-track tuning per density (numbers map to the nearest word: below 0.4 low, 0.85 and above high). */
export function densityTyping(density = "normal") {
  const value = densityAmount(density);
  if (value < 0.4) return { maxRate: 15, words: false };
  if (value >= 0.85) return { maxRate: 30, words: true };
  return { maxRate: 25, words: true };
}

/** A short listing of a library for `launchclip sfx list`. */
export function summarizeLibrary(loaded, known = null) {
  if (!loaded) return null;
  return {
    dir: loaded.dir,
    manifest: loaded.file,
    generations: loaded.manifest.generations ?? 0,
    ...(known ? { missing: missingFamilies(loaded, known) } : {}),
    families: Object.fromEntries(Object.entries(loaded.manifest.families).map(([family, entry]) => [family, {
      source: entry.source,
      roll: entry.roll ?? 0,
      variants: (entry.variants ?? []).map((variant) => ({ file: variant.file, source: variant.source, duration_ms: variant.measurements?.duration_ms ?? null, onset_ms: variant.measurements?.onset_ms ?? null, peak_db: variant.measurements?.peak_db ?? null })),
      rejected: (entry.rejected ?? []).length
    }]))
  };
}
