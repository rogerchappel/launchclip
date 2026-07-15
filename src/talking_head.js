// Talking-head workflow: script (teleprompter) -> record -> align (word
// timings + heuristic motion timeline) -> motion-render. A HeyGen avatar video
// drops into the same align step in place of a self-recorded clip.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateTimeline } from "../motion-engine/schema.js";
import { buildHeuristicTimeline } from "../motion-engine/heuristics.js";
import { PACKAGE_ROOT, stageBundledPublicAssets } from "./runtime_paths.js";
import { prepareSfxPack } from "./sfx.js";

const execFileAsync = promisify(execFile);

export async function writeTeleprompter(out, flags = {}) {
  const wpm = Number(flags.wpm ?? 150);
  const voiceover = JSON.parse(await readFile(path.join(out, "video", "voiceover.json"), "utf8"));
  const markdown = buildTeleprompterMarkdown(voiceover, wpm);
  const target = path.join(out, "video", "teleprompter.md");
  await writeFile(target, markdown);
  return { stage: "script", teleprompter: target, wpm };
}

export function buildTeleprompterMarkdown(voiceover, wpm = 150) {
  const segments = Array.isArray(voiceover.segments) ? voiceover.segments : [];
  const lines = [
    "# Teleprompter",
    "",
    `Delivery: ${voiceover.delivery ?? "natural, direct, energetic"}`,
    `Pace target: ~${wpm} words per minute. Read each block, pause briefly between blocks.`,
    "",
    "## Recording checklist",
    "",
    "- 9:16 vertical, eyes at the top third of frame, lens at eye level",
    "- Light in front of you, not behind; quiet room, phone mic close",
    "- Hold a beat of silence before the first word and after the last (trim points)",
    "- Energy one notch above what feels natural — flat reads kill motion edits",
    "- One full take is enough; the motion layer carries the visual interest",
    "",
    "## Script",
    ""
  ];
  let total = 0;
  segments.forEach((segment, index) => {
    const text = String(segment.text ?? "").trim();
    const wordCount = text ? text.split(/\s+/).length : 0;
    const seconds = wordCount ? Math.round((wordCount / wpm) * 600) / 10 : 0;
    total += seconds;
    lines.push(`### ${index + 1}. ${segment.beat ?? "segment"} (~${seconds}s)`);
    lines.push("");
    lines.push(`> ${text}`);
    lines.push("");
  });
  lines.push(`Total estimated read: ~${Math.round(total)}s`);
  lines.push("");
  lines.push("HeyGen alternative: paste the full script into a HeyGen avatar video, download the MP4, and feed it to `launchclip align` exactly like a self-recorded take.");
  lines.push("");
  return lines.join("\n");
}

export async function alignRecording(out, flags = {}) {
  const media = flags.media;
  if (!media) throw new Error("Missing --media path to your recorded talking-head video");

  const words = flags.words ? parseWords(await readFile(flags.words, "utf8")) : await transcribeWithWhisper(media);
  if (!words.length) throw new Error("No word timings found — check the recording has speech");

  const durationSeconds = await probeDuration(media);
  const baseName = `talking-head-${path.basename(media).replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  const publicRoot = await stageBundledPublicAssets(out);
  const publicBase = path.join(publicRoot, "base");
  await mkdir(publicBase, { recursive: true });
  await copyFile(media, path.join(publicBase, baseName));

  const timeline = buildHeuristicTimeline({
    words,
    durationSeconds,
    baseSrc: `base/${baseName}`
  });
  const result = validateTimeline(timeline);
  if (!result.ok) throw new Error(`Heuristic timeline failed validation: ${result.errors.join("; ")}`);

  const wordsPath = path.join(out, "video", "words.json");
  const timelinePath = path.join(out, "video", "motion-timeline.json");
  await mkdir(path.join(out, "video"), { recursive: true });
  await writeFile(wordsPath, `${JSON.stringify(words, null, 2)}\n`);
  await writeFile(timelinePath, `${JSON.stringify(result.timeline, null, 2)}\n`);
  return {
    stage: "align",
    words: wordsPath,
    timeline: timelinePath,
    base: `base/${baseName}`,
    duration_seconds: durationSeconds,
    events: result.timeline.events.length,
    warnings: result.warnings
  };
}

export async function renderMotion(out, flags = {}) {
  const timelinePath = path.join(out, "video", flags.timeline ?? "motion-timeline.json");
  const timeline = JSON.parse(await readFile(timelinePath, "utf8"));
  const result = validateTimeline(timeline);
  if (!result.ok) throw new Error(`Timeline invalid: ${result.errors.join("; ")}`);
  const publicRoot = await stageBundledPublicAssets(out);

  const enableSfx = flags.sfx !== "off";
  const sfx = enableSfx
    ? await prepareSfxPack({
        sfxDir: flags["sfx-dir"],
        publicDir: publicRoot,
        allowPlaceholder: Boolean(flags["allow-placeholder-sfx"])
      })
    : null;

  const propsPath = path.join(out, "video", "motion-props.json");
  await writeFile(propsPath, `${JSON.stringify({ timeline: result.timeline, enableSfx }, null, 2)}\n`);
  const output = path.join(out, "video", flags.output ?? "motion.mp4");
  const entryPoint = path.join(PACKAGE_ROOT, "remotion", "index.jsx");
  await execFileAsync(
    "npx",
    [
      "remotion",
      "render",
      entryPoint,
      "MotionGolden",
      output,
      "--props",
      propsPath,
      "--public-dir",
      publicRoot,
      "--overwrite",
      "--codec",
      "h264",
      "--log",
      "warn"
    ],
    { cwd: PACKAGE_ROOT, maxBuffer: 1024 * 1024 * 16 }
  );
  return { stage: "motion-render", video: output, props: propsPath, sfx, warnings: result.warnings };
}

// Accepts either a plain [{word,start,end}] array or raw whisper JSON output.
export function parseWords(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (Array.isArray(parsed)) {
    return parsed.map((entry) => ({ word: String(entry.word).trim(), start: Number(entry.start), end: Number(entry.end) }));
  }
  if (Array.isArray(parsed?.segments)) {
    return parsed.segments.flatMap((segment) =>
      (segment.words ?? []).map((entry) => ({
        word: String(entry.word).trim(),
        start: Number(entry.start),
        end: Number(entry.end)
      }))
    );
  }
  throw new Error("Unrecognized words file — expected [{word,start,end}] or whisper JSON with segments[].words[]");
}

async function transcribeWithWhisper(media) {
  const outputDir = await mkdtemp(path.join(tmpdir(), "launchclip-whisper-"));
  try {
    await execFileAsync(
      "whisper",
      [media, "--model", "base", "--word_timestamps", "True", "--output_format", "json", "--output_dir", outputDir],
      { maxBuffer: 1024 * 1024 * 32 }
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "whisper CLI not found. Install it (pipx install openai-whisper) or pass --words path/to/words.json from another transcriber."
      );
    }
    throw error;
  }
  const files = await readdir(outputDir);
  const jsonFile = files.find((file) => file.endsWith(".json"));
  if (!jsonFile) throw new Error("whisper produced no JSON output");
  return parseWords(await readFile(path.join(outputDir, jsonFile), "utf8"));
}

async function probeDuration(media) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    media
  ]);
  const duration = Number(String(stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not read duration of ${media}`);
  return Math.round(duration * 100) / 100;
}
