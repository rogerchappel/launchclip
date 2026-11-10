// The `script` gate (docs/ANIMATION_PIPELINE_RFC.md §8.2): a finished
// project's SCRIPT.json against the screenplay contract
// (kit/core/screenplay.mjs). It fails when a speaker is unknown, a listed
// character never speaks or acts, the script runs over its length, or the
// problem lands late; and on anything else that breaks the contract (a line
// with no id, a silent line with no length, narration that is not the lines).
//
//   scriptGate({project, resolved?, words?, profile?, script?})
//     → {status: "passed" | "failed" | "skipped", file, errors, warnings, stats, …}
//
// It reads only the project and calls no model. The copy checks of
// `launchclip script check` (hooks, fact tracing, hedging) are not part of the
// gate: they need the brief, and they are advice on the writing, not the
// contract. A project with no SCRIPT.json, or a narrated version 1 script
// (no speakers), is skipped.
//
// The length is held at the voice's real pace when the project has a take:
// the words in NARRATION.json over the seconds their lines run. The target is
// the script's own (`duration`, else `plan.duration`), else the story's.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spokenRuns } from "@launchclip/core/cadence.mjs";
import { isScreenplay, validateScreenplay } from "@launchclip/core/screenplay.mjs";
import { profileForStory, resolveProfile } from "./profile_store.js";

export const SCRIPT_GATE_FILE = "SCRIPT.json";
/** The profile whose problem_lands_seconds holds a script when the story names none. */
export const SCRIPT_GATE_PROFILE = "story-characters";
/** The contract errors the RFC names; every other contract error fails the gate too. */
export const SCRIPT_GATE_RULES = Object.freeze({ "speaker-unknown": "a speaker is unknown", "character-unused": "a character never speaks or acts", "fits-length": "the script is over its length", "problem-lands": "the problem lands late", "problem-missing": "the problem never lands" });

const positive = (value) => (Number(value) > 0 ? Number(value) : null);

/** The voice's measured pace in words a minute: the take's words over the seconds its lines run. null without a take. */
export function measuredPace(words, script = null) {
  const runs = spokenRuns(words, { script });
  const seconds = runs.reduce((sum, run) => sum + (run.end - run.start), 0);
  const count = runs.reduce((sum, run) => sum + run.words, 0);
  return seconds > 0 && count >= 5 ? Math.round((count / seconds) * 60) : null;
}

/**
 * project: the project folder. resolved: its resolved storyboard (for the
 * length and the profile). words: the narration words. profile: the cadence
 * profile the story is gated against; without one the story's own is picked,
 * else story-characters. script: the parsed SCRIPT.json, to skip the read.
 */
export async function scriptGate({ project, resolved = null, words = null, profile = null, script = undefined } = {}) {
  const file = SCRIPT_GATE_FILE;
  let value = script;
  if (value === undefined) {
    const source = path.join(String(project), file);
    if (!existsSync(source)) return { status: "skipped", reason: `no ${file}` };
    try { value = JSON.parse(await readFile(source, "utf8")); }
    catch (error) { return { status: "failed", file, errors: [`${file} is not valid JSON: ${error.message}`], warnings: [], rules: [] }; }
  }
  if (value === null) return { status: "skipped", reason: `no ${file}` };
  if (!isScreenplay(value)) return { status: "skipped", reason: `${file} is a narrated script (version 1): it has no speakers to check` };

  let held = profile;
  if (!held && resolved) { try { held = profileForStory(resolved, { projectDir: project }).profile; } catch { held = null; } }
  if (!held?.measures?.problem_lands_seconds) { try { held = resolveProfile(SCRIPT_GATE_PROFILE, { projectDir: project }).profile; } catch { /* no limit */ } }
  const problemLandsSeconds = held?.measures?.problem_lands_seconds?.p90 ?? null;
  const target = positive(value.duration) ?? positive(value.plan?.duration);
  const storySeconds = positive(resolved?.resolved?.duration) ?? positive(resolved?.format?.duration);
  const duration = target ?? storySeconds;
  const measured = Array.isArray(words) && words.length ? measuredPace(words, value) : null;
  const wpm = positive(value.plan?.wpm) ?? measured ?? undefined;

  const check = validateScreenplay(value, { duration, wpm, problemLandsSeconds });
  const line = (item) => `[${item.id}] ${item.message} Fix: ${item.fix}`;
  return {
    status: check.ok ? "passed" : "failed",
    file,
    profile: held?.id ?? null,
    duration: duration ?? null,
    duration_source: target ? "script" : storySeconds ? "story" : null,
    wpm: check.stats.wpm ?? null,
    wpm_source: positive(value.plan?.wpm) ? "script" : measured ? "measured" : "default",
    rules: [...new Set(check.errors.map((item) => item.id))],
    errors: check.errors.map(line).slice(0, 20),
    warnings: check.warnings.map(line).slice(0, 20),
    stats: check.stats
  };
}
