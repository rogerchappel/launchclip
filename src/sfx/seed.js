// launchclip sfx seed | list | audition: build the SFX library once, then
// leave it alone.
//
//   launchclip sfx seed [--provider elevenlabs|comfy|synth] [--variants 3]
//     [--only whoosh,impact] [--reroll typing] [--dir .launchclip/sfx] [--force]
//   launchclip sfx list [--dir .launchclip/sfx]
//   launchclip sfx audition <family> [--dir .launchclip/sfx] [--out file.wav] [--gap 0.35]
//
// Seeding only fills families the library does not have yet; existing
// families are locked until `--reroll <family>` (or --force) replaces them.
// ElevenLabs downloads are cached by the hash of their request
// (cache/<hash>.mp3) and a cached request is never sent again; a reroll bumps
// the family's roll number, which changes the hash. The API key is read from
// ELEVENLABS_API_KEY in the process environment and is never logged, written
// or included in an error. (Loading a project .env into the environment is
// handled by the CLI separately.)
//
// --provider comfy asks a local ComfyUI (src/comfy) for COMFY_CANDIDATES
// takes per family from the same prompts, processes them like any download,
// and keeps the takes the SFX classifier (src/sfx/classify.js) puts in the
// family's row. Takes are cached by their bound workflow (prompt, model,
// seed) and logged in <dir>/generation-log.jsonl with the model's licence.
// With no ComfyUI reachable, the family falls back to the procedural kit.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../atomic_write.js";
import { promisify } from "node:util";
import { decodeAudio, processFile, writeWavFile, SAMPLE_RATE } from "./process.js";
import { measureTimbre, timbreProblem } from "./timbre.js";
import { FAMILY_TYPE, classifySfxFile } from "./classify.js";
import { createComfyClient } from "../comfy/client.js";
import { generateWithComfy } from "../comfy/generate.js";
import { assertLicence, loadTemplate } from "../comfy/templates.js";
import { PROJECT_LIBRARY_DIR, emptyManifest, expandFamilies, familySource, hashOf, libraryVariants, missingFamilies, readLibrary, resolveLibraries, summarizeLibrary, userLibraryDir, writeLibrary } from "./library.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const SYNTH_SCRIPT = path.join(ROOT, "src", "scripts", "synth-audio-kit.mjs");
export const PROMPTS_FILE = path.join(import.meta.dirname, "prompts.json");
export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const SOUND_GENERATION_PATH = "/v1/sound-generation";
export const COMFY_SFX_TEMPLATE = "sfx-stable-audio";
export const COMFY_CANDIDATES = 4;
export const SFX_PROVIDERS = Object.freeze(["elevenlabs", "comfy", "synth"]);

/** The seed of one ComfyUI take: fixed per family, roll and take, so a reroll draws new sounds. */
export const comfySeed = (family, roll, take) => parseInt(hashOf(`${family}|${roll}|${take}`).slice(0, 8), 16);

/**
 * Families of `known` whose every variant on disk fails the timbre guard
 * (src/sfx/timbre.js): seeded before the guard existed, they are refused in
 * every render and give way to the kit. --missing replaces them.
 * measure(file) → timbre | null (null: unreadable, not a refusal). → [family]
 */
export async function refusedFamilies(library, known, { measure = measureFile } = {}) {
  const out = [];
  for (const family of known) {
    const variants = libraryVariants(library, family);
    if (!variants.length) continue;
    let passes = false;
    for (const variant of variants) {
      const timbre = await measure(path.resolve(library.dir, variant.file));
      if (!timbre || !timbreProblem(family, timbre)) { passes = true; break; }
    }
    if (!passes) out.push(family);
  }
  return out;
}

async function measureFile(file) {
  try { const { channels, sampleRate } = await decodeAudio(file); return measureTimbre(channels, sampleRate); } catch { return null; }
}

export async function loadPrompts(file = PROMPTS_FILE) {
  const prompts = JSON.parse(await readFile(file, "utf8"));
  if (prompts?.schema_version !== "launchclip.sfx-prompts.v1" || !prompts.families) throw new Error(`${file} is not a launchclip.sfx-prompts.v1 prompt set`);
  return prompts;
}

/** Replace any occurrence of the secret in a message. */
export function redact(message, secret) {
  const text = String(message ?? "");
  return secret && secret.length >= 4 ? text.split(secret).join("[redacted]") : text;
}

/**
 * One ElevenLabs sound generation: POST /v1/sound-generation with text,
 * duration_seconds, prompt_influence and model_id; the response body is the
 * encoded audio (output_format query parameter). Returns a Buffer.
 */
export async function generateSoundEffect({ text, durationSeconds, promptInfluence, modelId, outputFormat = "mp3_44100_128", apiKey, fetch: fetchImpl = globalThis.fetch, baseUrl = ELEVENLABS_API, signal }) {
  if (!apiKey) throw new Error("ElevenLabs sound effects need ELEVENLABS_API_KEY. Nothing was sent. Set the key, or seed from the procedural kit with --provider synth.");
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation available");
  const body = { text, model_id: modelId };
  if (durationSeconds != null) body.duration_seconds = Math.max(0.5, Math.min(30, Number(durationSeconds)));
  if (promptInfluence != null) body.prompt_influence = Math.max(0, Math.min(1, Number(promptInfluence)));
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${SOUND_GENERATION_PATH}?output_format=${encodeURIComponent(outputFormat)}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    throw new Error(redact(`ElevenLabs sound-generation request failed: ${error?.message ?? error}`, apiKey));
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(redact(`ElevenLabs sound-generation request failed (${response.status}): ${detail.slice(0, 300)}`, apiKey));
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 256) throw new Error(`ElevenLabs returned an empty sound effect (${audio.length} bytes)`);
  return audio;
}

/** The cache key of one generation request. */
export function requestHash({ modelId, outputFormat, text, durationSeconds, promptInfluence, take, roll }) {
  return hashOf(JSON.stringify({ provider: "elevenlabs", model_id: modelId, output_format: outputFormat, text, duration_seconds: durationSeconds, prompt_influence: promptInfluence, take, roll }));
}

function extensionFor(outputFormat) {
  if (outputFormat.startsWith("mp3")) return "mp3";
  if (outputFormat.startsWith("wav")) return "wav";
  if (outputFormat.startsWith("opus")) return "opus";
  return "bin";
}

/**
 * Seed (or reroll) a library. options: {dir, provider: "elevenlabs"|"synth",
 * variants, only, reroll, force, env, fetch, log, now, prompts,
 * synthKit(outDir, families), processFile}.
 * Returns {dir, manifest, provider, generations, cached, seeded, kept, warnings}.
 */
export async function seedLibrary(options = {}) {
  const env = options.env ?? process.env;
  const apiKey = env.ELEVENLABS_API_KEY || null;
  const log = options.log ?? (() => {});
  const process_ = options.processFile ?? processFile;
  const dir = path.resolve(options.dir ?? PROJECT_LIBRARY_DIR);
  const prompts = options.prompts ?? await loadPrompts();
  const requested = options.provider ? String(options.provider).toLowerCase() : (apiKey ? "elevenlabs" : "synth");
  if (!SFX_PROVIDERS.includes(requested)) throw new Error(`--provider must be ${SFX_PROVIDERS.join(", ")}; got ${options.provider}`);
  const allowLicences = String(options.allowModelLicence ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const comfyTemplate = requested === "comfy" ? await loadTemplate(COMFY_SFX_TEMPLATE) : null;
  // Refused before anything is sent: the user must accept a licence that is off the open allowlist.
  if (comfyTemplate) assertLicence(comfyTemplate, allowLicences);
  let comfyClient = options.comfyClient ?? null;
  const comfy = () => (comfyClient ??= createComfyClient({ url: options.comfyUrl, env, allowRemote: Boolean(options.comfyAllowRemote), fetch: options.fetch }));
  let comfyDown = null;
  const classify = options.classify ?? (async (file) => (await classifySfxFile(file))?.type ?? null);
  // Without a key, --provider elevenlabs still works from the download cache;
  // the first uncached request fails before anything is sent.
  const now = options.now ?? (() => new Date().toISOString());
  const existing = await readLibrary(dir);
  const manifest = existing?.manifest ?? emptyManifest(now());
  const only = expandFamilies(options.only);
  const reroll = expandFamilies(options.reroll) ?? [];
  const known = Object.keys(prompts.families);
  for (const family of [...(only ?? []), ...reroll]) if (!known.includes(family)) throw new Error(`Unknown SFX family "${family}". Families: ${known.join(", ")} (aliases: typing, ui)`);
  // --missing: only the families this library has no usable file for
  // (absent, empty, every variant file deleted, or every variant refused by
  // the timbre guard), never the rest.
  if (options.missing && (only || reroll.length || options.force)) throw new Error("--missing fills only the missing families; it cannot be combined with --only, --reroll or --force");
  const loaded = { dir, manifest };
  const refused = options.missing ? await refusedFamilies(loaded, known, options.measureTimbre ? { measure: options.measureTimbre } : {}) : [];
  const candidates = options.missing ? [...missingFamilies(loaded, known), ...refused] : only ?? (reroll.length ? reroll : known);
  const targets = candidates.filter((family) => options.force || reroll.includes(family) || refused.includes(family) || !libraryVariants(loaded, family).length);
  const variantsOverride = options.variants != null ? Number(options.variants) : null;
  if (variantsOverride != null && !(Number.isInteger(variantsOverride) && variantsOverride >= 1 && variantsOverride <= 8)) throw new Error("--variants must be an integer from 1 to 8");
  const result = { dir, provider: requested, generations: 0, cached: 0, seeded: [], locked: (options.missing ? known : candidates).filter((family) => !targets.includes(family)), kept: {}, rejected: {}, warnings: [], ...(options.missing ? { missing: targets } : {}) };
  let procedural = null;
  const proceduralKit = async () => {
    if (procedural) return procedural;
    const outDir = path.join(dir, "cache", "procedural");
    const kit = options.synthKit ? await options.synthKit(outDir, known) : await runSynthKit(outDir, known);
    procedural = { dir: path.join(outDir, "sfx"), families: kit.families ?? {}, scriptHash: kit.scriptHash ?? null };
    return procedural;
  };

  for (const family of targets) {
    const spec = prompts.families[family];
    const previous = manifest.families[family];
    const roll = reroll.includes(family) ? (previous?.roll ?? 0) + 1 : (previous?.roll ?? 0);
    // New files are processed into a staging folder and swapped in only when
    // the family succeeds, so a failed reroll never loses the current sound.
    const familyDir = path.join(dir, family);
    const stagingDir = path.join(dir, ".staging", family);
    await rm(stagingDir, { recursive: true, force: true });
    const finalPath = (file) => path.join(family, path.basename(file));
    const kept = [];
    const rejected = [];
    let source = requested === "elevenlabs" ? "elevenlabs" : "procedural";
    if (requested === "elevenlabs") {
      const takes = variantsOverride ?? spec.variants ?? 2;
      const keep = Math.max(takes, spec.keep ?? takes);
      const modelId = spec.model_id ?? prompts.model_id;
      const outputFormat = spec.output_format ?? prompts.output_format ?? "mp3_44100_128";
      const staged = [];
      for (let take = 0; take < takes && staged.length < keep; take++) {
        const request = { modelId, outputFormat, text: spec.prompt, durationSeconds: spec.duration_seconds, promptInfluence: spec.prompt_influence, take, roll };
        const hash = requestHash(request);
        const raw = path.join(dir, "cache", `${hash}.${extensionFor(outputFormat)}`);
        if (existsSync(raw)) {
          result.cached++;
          log(`sfx seed: ${family} take ${take + 1}/${takes} (cached)`);
        } else {
          if (!apiKey) throw new Error(`${family} take ${take + 1} is not cached and ELEVENLABS_API_KEY is not set. Nothing was sent. Add the key, or run: launchclip sfx seed --provider synth`);
          log(`sfx seed: ${family} take ${take + 1}/${takes} (generating)`);
          const audio = await generateSoundEffect({ ...request, apiKey, fetch: options.fetch, baseUrl: options.baseUrl });
          result.generations++;
          manifest.generations = (manifest.generations ?? 0) + 1;
          await writeFileAtomic(raw, audio);
        }
        staged.push({ raw, hash, take });
      }
      for (const { raw, hash, take } of staged) {
        if (kept.length >= keep) break;
        const output = path.join(stagingDir, `${family}-${kept.length + 1}.wav`);
        const processed = await process_(raw, output, family, { harvest: spec.harvest ? keep - kept.length : 0 });
        if (!processed.ok) { rejected.push({ take, hash, reason: processed.reason }); continue; }
        const hits = processed.harvested?.length ? processed.harvested : [{ file: processed.file, measurements: processed.measurements, stats: processed.stats }];
        for (const [index, hit] of hits.entries()) {
          if (kept.length >= keep) break;
          let file = hit.file;
          const target = path.join(stagingDir, `${family}-${kept.length + 1}.wav`);
          if (path.resolve(file) !== path.resolve(target)) {
            await writeFile(target, await readFile(file));
            await rm(file, { force: true });
            file = target;
          }
          kept.push({ file: finalPath(file), source: "elevenlabs", hash, take, hit: index + 1, prompt: spec.prompt, raw: path.relative(dir, raw), measurements: hit.measurements, stats: hit.stats });
        }
      }
      if (!kept.length) {
        result.warnings.push(`${family}: every ElevenLabs take was rejected (${rejected.map((entry) => entry.reason).join("; ")}); using the procedural kit for this family`);
        source = "procedural";
      }
    }
    if (requested === "comfy") {
      source = "comfy";
      const takes = variantsOverride ?? COMFY_CANDIDATES;
      const expected = FAMILY_TYPE[family] ?? null;
      for (let take = 0; take < takes && !comfyDown; take++) {
        const seed = comfySeed(family, roll, take);
        let generated;
        try {
          generated = await generateWithComfy({ client: comfy(), template: comfyTemplate, values: { prompt: spec.prompt, seconds: Math.max(0.5, Number(spec.duration_seconds) || 1), seed }, cacheDir: path.join(dir, "cache", "comfy"), allowLicences, ledger: path.join(dir, "generation-log.jsonl"), extra: { family, take, roll } });
        } catch (error) {
          comfyDown = error.message;
          break;
        }
        log(`sfx seed: ${family} take ${take + 1}/${takes} (${generated.cached ? "cached" : "generated"} with ComfyUI)`);
        if (generated.cached) result.cached++;
        else { result.generations++; manifest.generations = (manifest.generations ?? 0) + 1; }
        const output = path.join(stagingDir, `${family}-${kept.length + 1}.wav`);
        const processed = await process_(generated.file, output, family, {});
        if (!processed.ok) { rejected.push({ take, hash: generated.key, reason: processed.reason }); continue; }
        const type = expected ? await classify(processed.file) : null;
        if (expected && type !== expected) {
          rejected.push({ take, hash: generated.key, reason: `classified as ${type ?? "silence"}, not ${expected}` });
          await rm(processed.file, { force: true });
          continue;
        }
        kept.push({ file: finalPath(processed.file), source: "comfy", hash: generated.key, take, seed, prompt: spec.prompt, model: generated.model, licence: generated.licence, raw: path.relative(dir, generated.file), measurements: processed.measurements, stats: processed.stats });
      }
      if (!kept.length) {
        result.warnings.push(`${family}: ${comfyDown ? `ComfyUI is not available (${comfyDown})` : `every ComfyUI take was rejected (${rejected.map((entry) => entry.reason).join("; ")})`}; using the procedural kit for this family`);
        source = "procedural";
      }
    }
    if (source === "procedural") {
      const kit = await proceduralKit();
      const names = kit.families[family] ?? [`${family}.wav`];
      const limit = variantsOverride ?? names.length;
      await rm(stagingDir, { recursive: true, force: true });
      for (const name of names.slice(0, limit)) {
        const input = path.join(kit.dir, name);
        const output = path.join(stagingDir, `${family}-${kept.length + 1}.wav`);
        const processed = await process_(input, output, family, {});
        if (!processed.ok) { rejected.push({ file: name, reason: processed.reason }); continue; }
        kept.push({ file: finalPath(output), source: "procedural", hash: hashOf(await readFile(input)), kit_file: name, prompt: null, measurements: processed.measurements, stats: processed.stats });
      }
      if (!kept.length) throw new Error(`${family}: the procedural kit produced no usable clip (${rejected.map((entry) => entry.reason).join("; ")})`);
    }
    await rm(familyDir, { recursive: true, force: true });
    await rename(stagingDir, familyDir);
    await rm(path.join(dir, ".staging"), { recursive: true, force: true }).catch(() => {});
    manifest.families[family] = {
      source,
      prompt: source === "elevenlabs" || source === "comfy" ? spec.prompt : null,
      model_id: source === "elevenlabs" ? (spec.model_id ?? prompts.model_id) : source === "comfy" ? kept[0].model : null,
      ...(source === "comfy" ? { licence: kept[0].licence } : {}),
      duration_seconds: source === "elevenlabs" ? spec.duration_seconds : null,
      prompt_influence: source === "elevenlabs" ? spec.prompt_influence : null,
      roll,
      seeded_at: now(),
      variants: kept,
      rejected
    };
    result.seeded.push(family);
    result.kept[family] = kept.length;
    if (rejected.length) result.rejected[family] = rejected.map((entry) => entry.reason);
    manifest.updated_at = now();
    // Save after every family so an interrupted seed keeps what it paid for.
    await writeLibrary(dir, manifest);
  }
  if (!existing && !targets.length) await writeLibrary(dir, manifest);
  result.manifest = path.join(dir, "library.json");
  result.total_generations = manifest.generations ?? 0;
  return result;
}

/** Render the procedural kit's SFX into outDir/sfx; returns AUDIO-KIT.json plus the script hash. */
export async function runSynthKit(outDir, families) {
  await execFileAsync(process.execPath, [SYNTH_SCRIPT, outDir, "--only", families.join(",")], { maxBuffer: 1 << 26 });
  const kit = JSON.parse(await readFile(path.join(outDir, "AUDIO-KIT.json"), "utf8"));
  return { ...kit, scriptHash: hashOf(await readFile(SYNTH_SCRIPT)) };
}

/** `launchclip sfx list`: the project and user libraries and what each family resolves to. */
export async function listLibraries({ dir, project = process.cwd(), home, env = process.env } = {}) {
  const libraries = await resolveLibraries({ project, library: dir, home, env });
  const prompts = await loadPrompts();
  const known = Object.keys(prompts.families);
  const families = Object.fromEntries(known.map((family) => {
    const source = familySource(family, libraries, { dir: "(procedural kit)", families: {} });
    return [family, { resolves_to: source.scope, source: source.source, variants: source.scope === "kit" ? null : source.files.length }];
  }));
  // Families of the prompt set that fall back to the procedural kit.
  const missing = known.filter((family) => families[family].resolves_to === "kit");
  const target = dir ? path.resolve(dir) : userLibraryDir({ home, env });
  return {
    stage: "sfx", action: "list", status: "ready", user_library: userLibraryDir({ home, env }),
    libraries: libraries.map((library) => summarizeLibrary(library, known)), families, missing,
    ...(missing.length ? { next_step: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not in any SFX library and fall back to the procedural kit; fill only those with: launchclip sfx seed --missing --dir ${target}` } : {})
  };
}

/**
 * `launchclip sfx audition <family>`: a contact WAV of every variant of a
 * family with `gap` seconds of silence between them (stereo, 48 kHz).
 */
export async function auditionFamily(family, { dir, project = process.cwd(), out, gap = 0.35, home, env = process.env } = {}) {
  if (!family) throw new Error("Missing SFX family to audition");
  const [name] = expandFamilies(family);
  const libraries = await resolveLibraries({ project, library: dir, home, env });
  let source = familySource(name, libraries, null);
  if (!source) {
    const kitDir = path.join(project, PROJECT_LIBRARY_DIR, "cache", "audition-kit");
    const kit = await runSynthKit(kitDir, [name]);
    source = familySource(name, [], { dir: path.join(kitDir, "sfx"), families: kit.families });
  }
  const pieces = [];
  const silence = Math.round(gap * SAMPLE_RATE);
  for (const file of source.files) {
    const { channels } = await decodeAudio(file);
    const stereo = channels.length === 2 ? channels : [channels[0], channels[0]];
    pieces.push(stereo);
  }
  const total = pieces.reduce((sum, piece) => sum + piece[0].length + silence, silence);
  const output = [new Float32Array(total), new Float32Array(total)];
  let offset = silence;
  for (const piece of pieces) {
    output[0].set(piece[0], offset);
    output[1].set(piece[1], offset);
    offset += piece[0].length + silence;
  }
  const target = path.resolve(out ?? path.join(source.scope === "kit" ? path.join(project, PROJECT_LIBRARY_DIR) : source.dir, "audition", `${name}.wav`));
  await writeWavFile(target, output, SAMPLE_RATE);
  return { stage: "sfx", action: "audition", status: "ready", family: name, scope: source.scope, source: source.source, variants: source.files.length, gap_seconds: gap, out: target };
}

const comfyFlags = (flags) => ({ allowModelLicence: flags["allow-model-licence"], comfyUrl: flags["comfy-url"], comfyAllowRemote: Boolean(flags["comfy-allow-remote"]) });

/** Dispatch for `launchclip sfx <action>`. */
export async function runSfxCommand(action, name, flags = {}, io = {}) {
  const log = io.log ?? ((line) => process.stderr.write(`${line}\n`));
  if (action === "seed") {
    const result = await seedLibrary({ dir: flags.dir, provider: flags.provider, variants: flags.variants, only: flags.only, reroll: flags.reroll, force: Boolean(flags.force), missing: Boolean(flags.missing), ...comfyFlags(flags), env: io.env, fetch: io.fetch, log });
    return { stage: "sfx", action: "seed", status: "ready", ...result };
  }
  if (action === "reroll") {
    const result = await seedLibrary({ dir: flags.dir, provider: flags.provider, variants: flags.variants, reroll: name ?? flags.reroll, ...comfyFlags(flags), env: io.env, fetch: io.fetch, log });
    return { stage: "sfx", action: "reroll", status: "ready", ...result };
  }
  if (action === "list") return listLibraries({ dir: flags.dir, env: io.env });
  if (action === "audition") return auditionFamily(name, { dir: flags.dir, out: flags.out, gap: flags.gap != null ? Number(flags.gap) : undefined, env: io.env });
  throw new Error(`Unknown sfx action: ${action}`);
}
