// Music bed generation via the ElevenLabs Music API. Local-first: writes an
// mp3 into public/music/ and (optionally) wires it into a motion timeline.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_MUSIC_PROMPT =
  "Retro 80s synthwave with a fat punchy beat and retro computer game energy: " +
  "analog synth arpeggios, warm driving bassline, punchy drum machine, steady upbeat groove. " +
  "Instrumental only, no vocals. Works as a background bed under a voiceover for a tech product video.";

export function resolveMusicPrompt({ override = "", script = null } = {}) {
  const prompt = String(override || script?.music_prompt || DEFAULT_MUSIC_PROMPT).trim();
  return prompt || DEFAULT_MUSIC_PROMPT;
}

export function shouldAutoGenerateMusic(flags = {}, env = process.env) {
  if (flags.music || flags["no-music"] || flags.music === "off") return false;
  return Boolean(env.ELEVENLABS_API_KEY);
}

export async function generateMusic(out, flags = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  const timelinePath = flags.timeline ?? path.join(out, "video", "motion-timeline.json");
  let timeline = null;
  if (existsSync(timelinePath)) {
    timeline = JSON.parse(await readFile(timelinePath, "utf8"));
  }
  const durationSeconds = Number(flags.duration ?? timeline?.duration_seconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Pass --duration <seconds> or point --timeline at a motion timeline with duration_seconds.");
  }
  // Generate a little extra so the bed never runs dry before the video ends.
  const lengthMs = Math.min(600000, Math.max(3000, Math.round((durationSeconds + 1.5) * 1000)));

  const prompt = String(flags.prompt ?? DEFAULT_MUSIC_PROMPT);
  const fileName = String(flags.output ?? "music/bed.mp3");
  const target = path.join(PACKAGE_ROOT, "public", fileName);
  if (existsSync(target) && !flags.force) {
    const wired = await wireMusicTimeline({ timeline, timelinePath, fileName, flags });
    return { stage: "music", music: target, skipped: "exists (use --force to regenerate)", prompt, timeline: wired ? timelinePath : null };
  }
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set. Export it (or source your .env) before running launchclip music.");
  }

  const response = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      music_length_ms: lengthMs,
      model_id: "music_v1",
      force_instrumental: true
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs music API failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, audio);

  const wired = await wireMusicTimeline({ timeline, timelinePath, fileName, flags });
  return {
    stage: "music",
    music: target,
    bytes: audio.length,
    length_ms: lengthMs,
    prompt,
    timeline: wired ? timelinePath : null
  };
}

async function wireMusicTimeline({ timeline, timelinePath, fileName, flags }) {
  if (!timeline || flags["no-wire"]) return false;
  timeline.audio = timeline.audio ?? {};
  timeline.audio.music = fileName;
  if (flags.volume !== undefined) timeline.audio.music_volume = Number(flags.volume);
  await writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`);
  return true;
}
