// Video signals for a post library: cuts, pacing and one contact sheet a post
// (docs/SCORING_ROADMAP.md, stage 8; guide: docs/guide/scoring-video.md).
// A switch, off by default: nothing else in scoring depends on it.
//
//   contrastSample(rows, {best, worst})          → each account's best and worst posts
//   parseShowinfo(stderr)                        → {duration_s, cuts}
//   cutsOf(file, {threshold})                    → {duration_s, cuts: [seconds]}
//   contactSheet(file, out, {cuts, frames, ...}) → writes one JPEG, → out
//   videoSignals(rows, {dir, ...})               → {rows, counts: {sampled, done, failed, transcribed}}
//   runVideo(target, flags, io)                  → {out, counts}
//
// Needs yt-dlp and ffmpeg on PATH. A video is downloaded, read and deleted;
// only the numbers and the contact sheet are kept.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { mapLimit } from "../concurrency.js";
import { withOutliers } from "./library.js";

const execFileAsync = promisify(execFile);
const run = (command, args) => execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 64 });

// Short posts at 360 px are a few MB; this stops a long upload filling the disk.
export const MAX_VIDEO_SIZE = "50M";
const INSTALL = { "yt-dlp": "brew install yt-dlp (or pipx install yt-dlp)", ffmpeg: "brew install ffmpeg" };
const round3 = (value) => Math.round(value * 1000) / 1000;

/** Throws one line naming every missing tool and how to install it. */
export async function requireTools(names = ["yt-dlp", "ffmpeg"], exec = run) {
  const missing = [];
  for (const name of names) {
    try { await exec(name, [name === "ffmpeg" ? "-version" : "--version"]); } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(name);
    }
  }
  if (missing.length) throw new Error(`--video needs ${missing.join(" and ")} on PATH: ${missing.map((name) => INSTALL[name] ?? `install ${name}`).join("; ")}`);
}

/**
 * For each account with a usable outlier and a url on at least best+worst
 * posts: its top `best` and bottom `worst` by outlier. Rows that already have
 * facts.cuts_per_s are left out, so a second run picks up where the first stopped.
 */
export function contrastSample(rows, { best = 5, worst = 5 } = {}) {
  const usable = rows.filter((row) => row.url && Number.isFinite(row.outlier));
  const sample = [];
  for (const posts of Map.groupBy(usable, (row) => `${row.platform}:${row.account}`).values()) {
    if (posts.length < best + worst || best + worst === 0) continue;
    const ranked = posts.toSorted((a, b) => b.outlier - a.outlier);
    // Done rows are dropped after ranking: dropping them first would walk the sample into the account's middle posts.
    sample.push(...[...ranked.slice(0, best), ...ranked.slice(ranked.length - worst)].filter((row) => row.facts?.cuts_per_s === undefined));
  }
  return sample;
}

/** ffmpeg's stderr from a `select='gt(scene,T)',showinfo` run → {duration_s, cuts}. */
export function parseShowinfo(stderr) {
  const text = String(stderr);
  const clock = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = clock ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : null;
  const cuts = [...text.matchAll(/Parsed_showinfo[^\n]*?pts_time:\s*(-?\d+(?:\.\d+)?)/g)].map((match) => round3(Number(match[1])))
    // The first frame and the last few are not cuts a viewer sees.
    .filter((time) => time > 0.05 && (duration === null || time < duration - 0.05));
  return { duration_s: duration === null ? null : round3(duration), cuts };
}

/** → {duration_s, cuts: [seconds]}: the times ffmpeg's scene score passes `threshold`. */
export async function cutsOf(file, { threshold = 0.3 } = {}) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", path.resolve(file), "-vf", `select='gt(scene,${Number(threshold)})',showinfo`, "-an", "-f", "null", "-"]);
  const found = parseShowinfo(stderr);
  if (!(found.duration_s > 0)) throw new Error(`could not read a duration from ${file}`);
  return found;
}

/** The frames a sheet shows: 0 s, 1 s, 3 s, then the next cuts, padded with evenly spaced frames. */
export function sheetTimes(cuts, duration, frames = 9) {
  const last = Math.max(0, duration - 0.2);
  // A touch after the cut, so the frame is the new shot and not the blend into it.
  const times = [...new Set([0, 1, 3, ...cuts.filter((time) => time > 3).map((time) => time + 0.05)].filter((time) => time <= last))].slice(0, frames);
  const missing = frames - times.length;
  for (let i = 0; i < missing; i += 1) times.push(Math.min(last, ((i + 0.5) * duration) / missing));
  return times.sort((a, b) => a - b).map(round3);
}

/**
 * One JPEG at `out` tiling `frames` frames of `file`, each `width` px wide.
 * cuts and duration_s come from cutsOf (read here when not given). → out.
 */
export async function contactSheet(file, out, { cuts, duration_s, frames = 9, width = 240 } = {}) {
  if (!cuts || !(duration_s > 0)) ({ cuts, duration_s } = await cutsOf(file));
  const columns = Math.ceil(Math.sqrt(frames));
  // xstack's grid needs every cell filled.
  const times = sheetTimes(cuts, duration_s, columns * Math.ceil(frames / columns));
  const source = path.resolve(file);
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    ...times.flatMap((time) => ["-ss", String(time), "-i", source]),
    "-filter_complex", `${times.map((_, index) => `[${index}:v]scale=${width}:-2[v${index}]`).join(";")};${times.map((_, index) => `[v${index}]`).join("")}xstack=inputs=${times.length}:grid=${columns}x${times.length / columns}[sheet]`,
    "-map", "[sheet]", "-frames:v", "1", "-q:v", "9", path.resolve(out)
  ]);
  return out;
}

async function ytDlp(row, folder) {
  // A library row is other people's data: only a web link is ever handed to yt-dlp.
  if (!/^https?:\/\//i.test(row.url)) throw new Error(`not a web link: ${row.url}`);
  await run("yt-dlp", ["--no-playlist", "--quiet", "--no-warnings", "--max-filesize", MAX_VIDEO_SIZE, "-S", "+res:360,vcodec:h264", "--remux-video", "mp4", "-o", path.join(folder, "video.%(ext)s"), "--", row.url]);
  const name = (await readdir(folder)).find((entry) => !entry.endsWith(".part"));
  if (!name) throw new Error(`yt-dlp saved no file (over the ${MAX_VIDEO_SIZE} cap?)`);
  return path.join(folder, name);
}

async function whisper() {
  try { await run("whisper", ["--help"]); } catch { return null; }
  const { transcribeRecording } = await import("../recording_workflow.js");
  return async (file) => (await transcribeRecording(file)).text;
}

/**
 * For each row of contrastSample(rows): download (yt-dlp, the lowest
 * resolution still at least 360 px), read the cuts, write sheets/<id>.jpg under
 * `dir`, set facts.cuts_per_s, facts.first_cut_s (null when there is no cut),
 * facts.duration_s (if missing) and sheet, then delete the video. A row with no
 * transcript gets one from local Whisper when it is installed, marked
 * transcript_source: "whisper" (transcribe: false turns that off). A failed row is counted and passed to onStep, never thrown.
 *
 * download(row, folder) → file, probe (cutsOf), sheet (contactSheet) and
 * transcribe(file) → text can be replaced. tmp: where the working folder is
 * made (the system's by default); it is removed at the end.
 * onStep({row, ok, error?}) is called as each row finishes.
 */
export async function videoSignals(rows, { dir, tmp = os.tmpdir(), best = 5, worst = 5, concurrency = 2, download, probe = cutsOf, sheet = contactSheet, transcribe, onStep } = {}) {
  if (!dir) throw new Error("videoSignals needs dir, the library's folder");
  await requireTools([...(download ? [] : ["yt-dlp"]), ...(probe === cutsOf || sheet === contactSheet ? ["ffmpeg"] : [])]);
  // The outlier is worked out for the sampling only; the library's rows are not given one here.
  const scored = rows.every((row) => row.outlier !== undefined) ? rows : withOutliers(rows);
  const sample = new Set(contrastSample(scored, { best, worst }));
  const picked = scored.flatMap((row, index) => (sample.has(row) ? [index] : []));
  const out = [...rows];
  const counts = { sampled: picked.length, done: 0, failed: 0, transcribed: 0 };
  if (!picked.length) return { rows: out, counts };
  const speech = transcribe === undefined ? await whisper() : transcribe;
  const work = await mkdtemp(path.join(tmp, "launchclip-video-"));
  try {
    await mapLimit(picked, concurrency, async (index) => {
      const row = rows[index];
      const folder = path.join(work, String(index));
      try {
        await mkdir(folder);
        const file = await (download ?? ytDlp)(row, folder);
        const { duration_s, cuts } = await probe(file);
        const name = `sheets/${String(row.id).replace(/[^\w.-]+/g, "_")}.jpg`;
        await mkdir(path.join(dir, "sheets"), { recursive: true });
        await sheet(file, path.join(dir, name), { cuts, duration_s });
        let transcript = row.transcript;
        if (!transcript && speech) {
          // A post with no speech, or one Whisper can't read, keeps its numbers.
          // Whisper writes "[Music]" for a post with no words; that is not a transcript.
          transcript = (await Promise.resolve(speech(file)).catch(() => ""))?.replace(/[\[(][^\])]*[\])]/g, "").trim() || undefined;
          if (transcript) counts.transcribed += 1;
        }
        out[index] = { ...row, ...(transcript && !row.transcript ? { transcript, transcript_source: "whisper" } : {}), facts: { ...row.facts, cuts_per_s: round3(cuts.length / duration_s), first_cut_s: cuts[0] ?? null, duration_s: row.facts?.duration_s ?? duration_s }, sheet: name };
        counts.done += 1;
        onStep?.({ row: out[index], ok: true });
      } catch (error) {
        counts.failed += 1;
        onStep?.({ row, ok: false, error: String(error.stderr || error.message).trim().split("\n").pop() });
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return { rows: out, counts };
}

const USAGE = "library video <library.jsonl> [--best 5] [--worst 5] [--concurrency 2] [--no-transcribe]";

/**
 * `launchclip score library video <library.jsonl>`: adds the video signals to
 * the library in place; sheets go in sheets/ beside it. io: {stdout?, download?}.
 * → {out, counts}.
 */
export async function runVideo(target, flags = {}, io = {}) {
  if (!target) throw new Error(`usage: ${USAGE}`);
  const file = path.resolve(String(target));
  if (!existsSync(file)) throw new Error(`${file} not found`);
  const number = (name, fallback, least) => {
    const value = flags[name] == null ? fallback : Number(flags[name]);
    if (!Number.isInteger(value) || value < least) throw new Error(`--${name} must be a whole number, ${least} or more; got ${flags[name]}`);
    return value;
  };
  const rows = (await readFile(file, "utf8")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const stdout = io.stdout ?? process.stdout;
  const result = await videoSignals(rows, {
    dir: path.dirname(file), best: number("best", 5, 0), worst: number("worst", 5, 0), concurrency: number("concurrency", 2, 1),
    ...(io.download ? { download: io.download } : {}), ...(flags["no-transcribe"] || flags.transcribe === false ? { transcribe: false } : {}),
    onStep: ({ row, ok, error }) => stdout.write(ok ? `${row.account} ${row.id}: ${row.facts.cuts_per_s} cuts/s over ${row.facts.duration_s} s\n` : `${row.account} ${row.id}: failed: ${error}\n`)
  });
  // shortcut: the library is written once at the end, so an interrupted run redoes its downloads; write as rows finish when libraries get large.
  // Written beside the library and renamed over it, so a crash never leaves half a file.
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${result.rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  await rename(temp, file);
  return { out: file, counts: result.counts };
}
