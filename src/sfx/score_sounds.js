// A file for each cue of the sound score (src/sfx/score.js). The sounds that
// must be exact are made here with ffmpeg and need nothing else: a deep bass
// drum, an arcade blip and a tuned pluck. The rest come from Earshot's sound bank
// when it is installed (src/sfx/earshot.js), moved to the score's key, and
// otherwise from the kit or library file the cue already resolved to.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { earshotCacheDir, earshotCredit, earshotTake, findEarshot } from "./earshot.js";
import { hashOf } from "./library.js";
import { midiHz, noteMidi, scoreKey, tunedNote } from "./score.js";

const execFileAsync = promisify(execFile);
export const SCORE_SOUND_DIR = path.join(".launchclip", "score");
// Bump when a native sound's recipe changes what its file means.
const NATIVE_SCHEMA = 1;

/**
 * A real bass drum: a pitch sweep falling to its note, a long round decay and
 * only a dull beater on top. No noise, so it cannot read as a snare; tonal
 * harmonics, so a phone speaker that can't play the fundamental still has it.
 */
export function kickGraph({ hz, decay }) {
  const sweep = `(${hz}*t+95*0.045*(1-exp(-t/0.045)))`;
  const body = `sin(2*PI*${sweep})*exp(-t/(${decay}*0.42))`;
  const overtones = `0.3*sin(4*PI*${sweep})*exp(-t/(${decay}*0.2))+0.16*sin(8*PI*${sweep})*exp(-t/(${decay}*0.12))+0.14*sin(2*PI*520*t)*exp(-t/0.007)`;
  const wave = `(${body})+${overtones}`;
  return { source: `aevalsrc='${wave}|${wave}':s=48000:d=${decay * 2.2}`, filter: `asoftclip=type=tanh,lowpass=f=900,afade=t=out:st=${decay * 1.7}:d=${decay * 0.5}` };
}

/** An arcade blip: a square wave jumping between two notes. */
export function chipGraph({ a, b }) {
  const low = midiHz(noteMidi(a)).toFixed(2);
  const high = midiHz(noteMidi(b)).toFixed(2);
  const wave = `0.5*sgn(sin(2*PI*if(lt(t,0.05),${low},${high})*t))*exp(-t/0.075)`;
  return { source: `aevalsrc='${wave}|${wave}':s=48000:d=0.2`, filter: "lowpass=f=7000,afade=t=out:st=0.17:d=0.03" };
}

/** A tuned pluck: a struck tone with a soft second partial, like a small mallet. */
export function pluckGraph({ note }) {
  const hz = midiHz(noteMidi(note)).toFixed(2);
  const wave = `(sin(2*PI*${hz}*t)+0.3*sin(4*PI*${hz}*t)*exp(-t/0.08)+0.12*sin(8.1*PI*${hz}*t)*exp(-t/0.02))*exp(-t/0.28)*0.7`;
  return { source: `aevalsrc='${wave}|${wave}':s=48000:d=0.9`, filter: "afade=t=out:st=0.8:d=0.1" };
}

const GRAPHS = { kick: kickGraph, chip: chipGraph, pluck: pluckGraph };

/** A native sound's file (made once per project). Peak and onset are known: a native sound starts on its hit. */
export async function nativeSound(native, { project, run = execFileAsync }) {
  const graph = GRAPHS[native.type](native);
  const file = path.join(project, SCORE_SOUND_DIR, `${native.type}-${hashOf(JSON.stringify({ schema: NATIVE_SCHEMA, native })).slice(0, 16)}.wav`);
  if (!existsSync(file)) {
    await mkdir(path.dirname(file), { recursive: true });
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", graph.source, "-af", graph.filter, "-c:a", "pcm_s24le", file], { maxBuffer: 1 << 24 });
  }
  return file;
}

/** The pitched bank's own notes (`earshot sfx list`): id → MIDI, fractions for cents. */
export function parseBankPitches(listing) {
  const pitches = new Map();
  for (const line of String(listing).split("\n")) {
    const match = /^(\S+\/\S+)\s.*\bpitch ([A-G][#b]?-?\d+)(?: ([+-]\d+)c)?/.exec(line);
    if (match) pitches.set(match[1], noteMidi(match[2]) + Number(match[3] ?? 0) / 100);
  }
  return pitches;
}

async function bankPitches(bin, run) {
  try {
    const { stdout } = await run(bin, ["sfx", "list"], { maxBuffer: 1 << 24, timeout: 60000 });
    return parseBankPitches(stdout);
  } catch {
    return new Map();
  }
}

/** The second the loudest moment of a file falls at (a kit file has no render metadata). */
export async function peakSeconds(file, { run = execFileAsync } = {}) {
  try {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-ac", "1", "-ar", "4800", "-f", "s16le", "-"], { encoding: "buffer", maxBuffer: 1 << 26 });
    let best = 0;
    let at = 0;
    for (let i = 0; i + 1 < stdout.length; i += 2) {
      const value = Math.abs(stdout.readInt16LE(i));
      if (value > best) { best = value; at = i / 2; }
    }
    return at / 4800;
  } catch {
    return 0;
  }
}

async function inTurn(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await work(items[index], index);
    }
  }));
}

/**
 * Each cue with its file and start, its sync point on its moment. Returns
 * {cues, source: "earshot" | "kit", credits, warnings}. A take Earshot cannot
 * render keeps the cue's kit or library file; a cue with no file is dropped.
 */
export async function applyScoreSounds(cues, { project, key: keyName = "A", env = process.env, bin = findEarshot(env), cacheDir = earshotCacheDir(env), run = execFileAsync, take = earshotTake } = {}) {
  const key = scoreKey(keyName);
  const warnings = [];
  const pitches = bin ? await bankPitches(bin, run) : new Map();
  if (!bin) warnings.push("score: Earshot is not installed, so the score uses the kit's sounds for everything but its bass drums, blips and plucks. Install Earshot for its fuller sound bank.");
  const tuned = (request) => {
    if (request.pitch || !pitches.has(request.id)) return request;
    return { ...request, pitch: tunedNote(pitches.get(request.id), key) };
  };
  const requests = new Map();
  for (const cue of cues) {
    if (!cue.take || !bin) continue;
    const request = tuned(cue.take);
    requests.set(JSON.stringify(request), request);
  }
  const rendered = new Map();
  const failed = new Set();
  await inTurn([...requests.entries()], 4, async ([name, request]) => {
    try {
      rendered.set(name, await take(request, { bin, project, cacheDir }));
    } catch (error) {
      failed.add(request.id);
      warnings.push(`score: Earshot could not render ${request.id} (${String(error.message).split("\n")[0]}); it keeps its kit sound`);
    }
  });
  const peaks = new Map();
  const peakOf = async (file) => {
    if (!peaks.has(file)) peaks.set(file, await peakSeconds(file, { run }));
    return peaks.get(file);
  };
  const credits = new Set();
  const placed = [];
  for (const cue of cues) {
    const entry = { ...cue };
    let peak = 0;
    if (cue.native) {
      entry.file = await nativeSound(cue.native, { project, run });
      entry.sfx_origin = "procedural";
      entry.sfx_source = "score";
    } else {
      const got = cue.take && bin ? rendered.get(JSON.stringify(tuned(cue.take))) : null;
      if (got) {
        entry.file = got.file;
        entry.sfx_origin = "earshot";
        entry.sfx_source = "earshot";
        entry.take = tuned(cue.take);
        peak = Number(got.meta?.peak_s) || 0;
        const credit = earshotCredit(cue.take.id);
        if (credit) credits.add(JSON.stringify(credit));
      } else if (cue.file) {
        if (cue.align === "peak") peak = await peakOf(cue.file);
      } else continue;
    }
    if (cue.align === "peak") {
      const start = cue.at - peak;
      entry.lands_at = cue.at;
      entry.at = Math.max(0, Math.round(start * 1000) / 1000);
      if (start < 0) entry.offset = Math.round(-start * 1000) / 1000;
    }
    placed.push(entry);
  }
  placed.sort((a, b) => a.at - b.at);
  return { cues: placed, source: bin && rendered.size ? "earshot" : "kit", credits: [...credits].map((text) => JSON.parse(text)), warnings };
}
