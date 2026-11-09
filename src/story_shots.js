// The shot list (docs/ANIMATION_PIPELINE_RFC.md §4.3): a view of
// storyboard.json and DIRECTION.json for a person or an agent to review, and
// for a host to plan hand-in from. A shot is a track-0 character scene; there
// is no shot-list file.
//
//   launchclip story shots <project> [--json]
//
//   shotList(resolved, {map, words, script}) → {fps, duration, shots, script_lines?}
//   storyShotsCommand(target, flags)         → the report (shots plus the files read)
//   formatShots(report)                      → the text the command prints
//
// Each shot: {id, shot (its number), module, track, start, end, seconds,
// frames (how many), first_frame, last_frame, who, set, framing, sections,
// beats, actions, lines, poses}.
// - lines: what is said while the shot is up, in order: {line? (the script
//   line id the map names), speaker, on_screen (the speaker is drawn in this
//   shot; false for the narrator), text, words: [first, last], start, end,
//   section, beat, intent, why?, playing?}.
// - poses: {<character>: [{at, frame, pose, expression, action?, shot?}]}, the
//   pose the character opens in and each change, in story seconds.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NARRATOR, narrationWords, sceneCharacters, scriptLines } from "@launchclip/core/direction.mjs";
import { SPEAKING_MODULES } from "@launchclip/core/story.mjs";
import { resolveModule, sceneRenderEnd } from "@launchclip/core/modules.mjs";
import { readProjectStory } from "./story_loader.js";
import { directionFileFor, readScriptBeside } from "./story_cli.js";

const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const finite = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * The shot list of a resolved story. map: its DIRECTION.json (or null);
 * words: the narration words, with a `speaker` on each in a dialogue;
 * script: its SCRIPT.json (or null).
 */
export function shotList(resolved, { map = null, words = [], script = null } = {}) {
  const fps = Number(resolved?.resolved?.fps ?? resolved?.format?.fps ?? 30);
  const list = narrationWords(words);
  const written = new Map(scriptLines(script).map((entry) => [entry.id, entry]));
  const mapLines = [];
  for (const section of Array.isArray(map?.sections) ? map.sections : []) {
    for (const line of Array.isArray(section?.lines) ? section.lines : []) {
      if (Array.isArray(line?.words) && line.words.length === 2 && line.words.every(Number.isInteger)) mapLines.push({ line, section });
    }
  }
  const owner = new Array(list.length).fill(null);
  for (const entry of mapLines) for (let i = Math.max(0, entry.line.words[0]); i <= Math.min(list.length - 1, entry.line.words[1]); i += 1) owner[i] ??= entry;

  const scenes = (Array.isArray(resolved?.scenes) ? resolved.scenes : [])
    .filter((scene) => SPEAKING_MODULES.includes(scene?.module) && (scene.track ?? 0) === 0 && finite(Number(scene.start)) && finite(Number(scene.end)))
    .sort((a, b) => Number(a.start) - Number(b.start));
  const shots = scenes.map((scene, index) => {
    const start = Number(scene.start), end = Number(scene.end);
    const first = Math.round(start * fps), last = Math.max(first, Math.round(end * fps) - 1);
    let model = null;
    try { model = resolveModule(scene, resolved, { end: sceneRenderEnd(resolved, scene) }); } catch { model = null; }
    const who = sceneCharacters(scene);
    const named = mapLines.filter(({ line }) => Array.isArray(line.scenes) && line.scenes.includes(scene.id));
    // The words said while the shot is up, grouped by map line and speaker.
    const lines = [];
    for (let i = 0; i < list.length; i += 1) {
      const word = list[i];
      const middle = (word.start + (finite(word.end) ? word.end : word.start)) / 2;
      if (!(middle >= start && middle < end)) continue;
      const entry = owner[i];
      const speaker = word.speaker ?? (entry?.line.line ? written.get(entry.line.line)?.speaker : null) ?? null;
      const open = lines.at(-1);
      if (open && open.entry === entry && open.speaker === speaker && open.words[1] === i - 1) {
        open.words[1] = i;
        open.said.push(word.text);
        open.end = word.end;
      } else lines.push({ entry, speaker, words: [i, i], said: [word.text], start: word.start, end: word.end });
    }
    return {
      id: scene.id,
      shot: index + 1,
      module: scene.module,
      track: scene.track ?? 0,
      start: round(start),
      end: round(end),
      seconds: round(end - start),
      frames: last - first + 1,
      first_frame: first,
      last_frame: last,
      who,
      set: typeof scene.params?.set === "string" ? scene.params.set : named.map(({ line }) => line.set).find(Boolean) ?? null,
      framing: model?.content?.shot?.name ?? (typeof scene.params?.shot === "string" ? scene.params.shot : null),
      sections: [...new Set([...named, ...lines.map((line) => line.entry).filter(Boolean)].map(({ section }) => section.id).filter(Boolean))],
      beats: [...new Set([...named, ...lines.map((line) => line.entry).filter(Boolean)].map(({ section }) => section.beat).filter(Boolean))],
      actions: named.filter(({ line }) => line.action).map(({ line }) => ({ ...line.action, ...(line.line ? { line: line.line } : {}) })),
      lines: lines.map(({ entry, speaker, said, ...rest }) => ({
        ...(entry?.line.line ? { line: entry.line.line } : {}),
        speaker,
        on_screen: Boolean(speaker) && speaker !== NARRATOR && who.includes(speaker),
        text: said.join(" "),
        words: rest.words,
        start: round(rest.start),
        end: round(rest.end),
        ...(entry ? { section: entry.section.id ?? null, beat: entry.section.beat ?? null, intent: entry.line.intent ?? null } : {}),
        ...(entry?.line.why ? { why: entry.line.why } : {}),
        ...(entry?.line.line && written.get(entry.line.line)?.playing ? { playing: written.get(entry.line.line).playing } : {})
      })),
      poses: Object.fromEntries(who.map((id) => [id, shotPoses(id, scene, model, fps)]))
    };
  });

  const report = { fps, duration: round(Number(resolved?.resolved?.duration ?? resolved?.format?.duration ?? 0)), shots };
  // The script against the map: which of its lines no map line plays. A silent
  // line is always in this list (a map line covers spoken words); it is here
  // so a reviewer sees the acting the script asks for between the lines.
  if (written.size) {
    const played = new Set(mapLines.map(({ line }) => line.line).filter(Boolean));
    report.script_lines = {
      lines: written.size,
      played: [...written.keys()].filter((id) => played.has(id)).length,
      unplaced: [...written.values()].filter((entry) => !played.has(entry.id)).map((entry) => ({ id: entry.id, speaker: entry.speaker, ...(entry.text ? { text: entry.text } : {}), ...(entry.action ? { action: entry.action } : {}), ...(entry.seconds !== undefined ? { seconds: entry.seconds } : {}), beat: entry.beat }))
    };
  }
  return report;
}

// The pose a character opens the shot in and each change after it. From the
// resolved module (what both renderers draw); from the scene's params when
// the module does not resolve.
function shotPoses(id, scene, model, fps) {
  const actor = (model?.content?.actors ?? []).find((entry) => entry?.id === id);
  const state = (time, source) => ({
    at: round(time),
    frame: Math.round(time * fps),
    ...(source.pose ? { pose: source.pose } : {}),
    ...(source.expression ? { expression: source.expression } : {}),
    ...(source.action ? { action: source.action } : {}),
    ...(source.shot ? { shot: source.shot } : {})
  });
  if (Array.isArray(actor?.states) && actor.states.length) return actor.states.map((entry) => state(Number(entry.time), entry));
  const start = Number(scene.start);
  const raw = scene.module === "character-cameo" ? scene.params : (Array.isArray(scene.params?.cast) ? scene.params.cast : []).find((entry) => entry?.id === id);
  if (!raw || typeof raw !== "object") return [];
  const cues = (Array.isArray(raw.cues) ? raw.cues : []).filter((cue) => finite(cue?.at)).sort((a, b) => a.at - b.at);
  return [state(start, raw), ...cues.map((cue) => state(start + cue.at, cue))];
}

/** launchclip story shots <project> [--json] */
export async function storyShotsCommand(target, flags = {}) {
  const input = path.resolve(String(target));
  const info = await stat(input).catch(() => { throw new Error(`Cannot read story project: ${input}`); });
  if (info.isFile() && path.basename(input) !== "storyboard.json") throw new Error(`story shots reads a project folder (its storyboard.json, DIRECTION.json, NARRATION.json and SCRIPT.json); got ${input}`);
  const project = info.isFile() ? path.dirname(input) : input;
  const loaded = await readProjectStory(project);
  if (!loaded) throw new Error(`No storyboard.json in ${project}`);
  const mapFile = flags.direction && flags.direction !== true ? path.resolve(String(flags.direction)) : directionFileFor(loaded.file);
  let map = null;
  try { map = JSON.parse(await readFile(mapFile, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw new Error(`Cannot read ${mapFile}: ${error.message}`); }
  const script = await readScriptBeside(project);
  const list = shotList(loaded.resolved, { map, words: loaded.words, script });
  const warnings = [];
  if (!map) warnings.push("no DIRECTION.json: lines are grouped by speaker, with no script line ids, beats or key actions");
  if (!loaded.words.length) warnings.push("no narration words (NARRATION.json): the shots list no lines");
  const others = loaded.resolved.scenes.filter((scene) => SPEAKING_MODULES.includes(scene?.module) && (scene.track ?? 0) !== 0).map((scene) => scene.id);
  if (others.length) warnings.push(`character scenes above track 0 are overlays, not shots: ${others.join(", ")}`);
  if (!list.shots.length) warnings.push(`no shots: the storyboard has no character scene (${SPEAKING_MODULES.join(", ")}) on track 0`);
  return {
    stage: "story",
    action: "shots",
    project,
    story: loaded.file,
    direction: map ? mapFile : null,
    script: script ? path.join(project, "SCRIPT.json") : null,
    title: loaded.resolved.title ?? null,
    format: loaded.format,
    ...list,
    warnings
  };
}

const time = (value) => value.toFixed(2);

/** The shot list as text: one block per shot. */
export function formatShots(report) {
  const out = [`${report.title ? `${report.title}: ` : ""}${report.shots.length} shot${report.shots.length === 1 ? "" : "s"}, ${time(report.duration)} s at ${report.fps} fps`, ""];
  for (const shot of report.shots) {
    out.push(`${String(shot.shot).padStart(2)}  ${shot.id}  ${time(shot.start)}–${time(shot.end)} s  frames ${shot.first_frame}–${shot.last_frame} (${shot.frames})`);
    out.push(`    ${[shot.module, shot.set ? `set ${shot.set}` : null, shot.framing ? `${shot.framing} shot` : null, shot.beats.length ? `beat ${shot.beats.join(", ")}` : null].filter(Boolean).join(" · ")}`);
    out.push(`    who: ${shot.who.join(", ") || "nobody"}`);
    for (const action of shot.actions) out.push(`    key action: ${action.who} ${action.verb}${action.target ? ` → ${typeof action.target === "string" ? action.target : JSON.stringify(action.target)}` : ""}${action.line ? ` (${action.line})` : ""}`);
    for (const [id, poses] of Object.entries(shot.poses)) {
      out.push(`    ${id}: ${poses.map((pose) => `${time(pose.at)} ${[pose.pose, pose.expression, pose.action ? `does ${pose.action}` : null, pose.shot ? `cut to ${pose.shot}` : null].filter(Boolean).join(", ")}`).join(" → ") || "no poses"}`);
    }
    if (!shot.lines.length) out.push("    (nothing is said)");
    for (const line of shot.lines) {
      const tag = `${line.line ? `${line.line} ` : ""}${line.speaker ?? "voice"}${line.speaker && line.speaker !== NARRATOR && !line.on_screen ? " (off screen)" : ""}`;
      out.push(`    ${time(line.start)}–${time(line.end)}  ${tag}: "${line.text}"${line.playing ? `  [${line.playing}]` : ""}${line.why && !line.on_screen && line.speaker !== NARRATOR ? `  why: ${line.why}` : ""}`);
    }
    out.push("");
  }
  const unplaced = report.script_lines?.unplaced ?? [];
  if (unplaced.length) {
    out.push(`Script lines no map line plays (${unplaced.length} of ${report.script_lines.lines}):`);
    for (const line of unplaced) out.push(`    ${line.id} ${line.speaker ?? "silent"}: ${line.text ? `"${line.text}"` : line.action ?? ""}${line.seconds !== undefined ? ` (${line.seconds} s)` : ""}`);
    out.push("");
  }
  for (const warning of report.warnings ?? []) out.push(`warning: ${warning}`);
  return `${out.join("\n").trimEnd()}\n`;
}
