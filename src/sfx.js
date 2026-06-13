import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_SFX_FILES = [
  "fast_whoosh.wav",
  "pop.wav",
  "tick.wav",
  "writing_prompt.wav",
  "single_type.wav",
  "retro_success.wav",
  "paper_flip.wav",
  "paper_hit.wav",
  "camera_tick.wav",
  "inspection_pop.wav",
  "chip_drop.wav",
  "success_ding.wav",
  "soft_thump.wav"
];

export async function validateSfxPack(dir) {
  const missing = [];
  for (const file of REQUIRED_SFX_FILES) {
    if (!(await fileExists(path.join(dir, file)))) missing.push(file);
  }
  return { ok: missing.length === 0, dir, missing, required: REQUIRED_SFX_FILES };
}

export async function prepareSfxPack({ sfxDir = null, publicDir = path.join(PACKAGE_ROOT, "public"), allowPlaceholder = false } = {}) {
  const targetDir = path.join(publicDir, "sfx");
  const sourceDir = sfxDir ? path.resolve(sfxDir) : targetDir;
  const initial = await validateSfxPack(sourceDir);

  if (!initial.ok && !allowPlaceholder) {
    throw new Error(
      `Missing required SFX in ${sourceDir}: ${initial.missing.join(", ")}. ` +
        "Add the named files or pass --allow-placeholder-sfx for generated placeholders."
    );
  }

  await mkdir(targetDir, { recursive: true });
  const copied = [];
  const generated = [];

  if (sfxDir) {
    if (!initial.ok) {
      throw new Error(`--sfx-dir is missing required SFX: ${initial.missing.join(", ")}`);
    }
    for (const file of REQUIRED_SFX_FILES) {
      const source = path.join(sourceDir, file);
      const target = path.join(targetDir, file);
      if (path.resolve(source) === path.resolve(target)) continue;
      await copyFile(source, target);
      copied.push(file);
    }
  }

  const targetCheck = await validateSfxPack(targetDir);
  if (!targetCheck.ok && allowPlaceholder) {
    for (const file of targetCheck.missing) {
      await writeFile(path.join(targetDir, file), makePlaceholderWav(file));
      generated.push(file);
    }
  }

  const finalCheck = await validateSfxPack(targetDir);
  if (!finalCheck.ok) {
    throw new Error(`Missing required SFX in ${targetDir}: ${finalCheck.missing.join(", ")}`);
  }

  return { ok: true, dir: targetDir, copied, generated, required: REQUIRED_SFX_FILES };
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function makePlaceholderWav(name) {
  const sampleRate = 44100;
  const durationSeconds = name.includes("writing") ? 0.5 : 0.18;
  const samples = Math.round(sampleRate * durationSeconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  const seed = [...name].reduce((total, char) => total + char.charCodeAt(0), 0);
  const frequency = 280 + (seed % 520);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples; index += 1) {
    const t = index / sampleRate;
    const envelope = Math.exp(-t * (name.includes("writing") ? 5 : 18));
    const sample = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.28;
    buffer.writeInt16LE(Math.max(-1, Math.min(1, sample)) * 32767, 44 + index * 2);
  }
  return buffer;
}
