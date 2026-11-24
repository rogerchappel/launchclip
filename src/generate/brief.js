// The generation brief for a footage shot (docs/GENERATED_FOOTAGE_RFC.md
// §4, §4.2): an asset-provider shot request (src/asset_provider.js) turned
// into the one shape every provider adapter reads:
//
//   {id, kind: "footage" | "story", steps: ["image"] | ["image", "video"],
//    image: {prompt, negative, width, height, references: [absolute paths]},
//    video: {prompt, seconds, pad_seconds, fps} | null,
//      (seconds is the shot's own length; adapters request
//      seconds + 2 * pad_seconds and source_start trims the pad back;
//      a story shot adds audio: "none" | "effects", the model's own soundtrack,
//      and, chained, continue_from: the shot whose last kept frame starts it),
//    brief_hash: "sha256:…" (over the canonical JSON of everything else)}
//
// Step 1 (image) is the keyframe: subject, look and composition. Step 2
// (video) animates that keyframe, so its prompt is motion and camera only.
// Story shots (§4.1) come from the show bible, the shot list and the animatic:
// storyBrief() for a shot, plateBrief() for a place with nobody in it.
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { BIBLE_FILE } from "@launchclip/core/bible.mjs";
import { WORLDS, worldLight } from "@launchclip/core/worlds/index.mjs";
import { readAnimatic } from "../animatic.js";
import { storyShotsCommand } from "../story_shots.js";
import { hashValue, loadWords } from "../finish.js";
import { resolveShots } from "../asset_provider.js";
import { styleParagraph } from "./style-paragraphs.js";

// Generated clips drift at their ends, so the adapter asks for this much
// longer at each end and source_start trims it back (§6). A constant to tune on fixtures.
export const EDGE_PAD_SECONDS = 0.3;
// A request with no resolved length (no narration timings yet).
export const DEFAULT_SHOT_SECONDS = 4;
export const DEFAULT_FPS = 30;

// What no generated keyframe may show (§4.2 "Never").
// Said in the prompt too, for models that ignore the negative prompt.
export const NO_TEXT = "A clean photograph with no text, letters, captions, subtitles, signs or logos anywhere in the frame.";
export const FOOTAGE_NEGATIVE = "text, lettering, captions, subtitles, signs with words, logos, brand marks, watermarks, user interface, readable screens, real or named people, celebrities, public figures";

/**
 * Why a request is not generated, or null when it may be. A generated shot
 * illustrates and never stands in for a real product, person, place or event
 * (§4.2 "Not evidence").
 * shortcut: a capitalised word not opening a sentence, or a mixed-case word
 * (iPhone), is read as a name, plus ™/®/@; `shows` is written in plain lower case by the planner.
 * Upgrade to an entity check (src/resolve_entities) if it refuses too much.
 */
export function refusalReason(request) {
  const shows = String(request?.shows ?? "").trim();
  if (!shows) return 'the request has no "shows"';
  if (/[™®©@]/.test(shows)) return `"${shows}" names a brand or account`;
  // A sentence's first word is capitalised anyway (a backdrop's shows quotes the narration).
  const names = shows.split(/[.!?:]\s+/).flatMap((sentence) => sentence.split(/\s+/).slice(1)).map((word) => word.replace(/^[^\p{L}]+|[^\p{L}\d]+$/gu, "")).filter((word) => (/^\p{Lu}/u.test(word) && word !== "I") || /\p{Ll}\p{Lu}/u.test(word));
  if (names.length) return `"${shows}" names a real product, person, place or event (${names.join(", ")}); left to the library`;
  return null;
}

/** The story's look as one fixed paragraph, pasted into every footage brief of the story so the shots match. */
export function lookParagraph(story) {
  const colors = Object.entries(story?.brand?.colors ?? {}).map(([name, hex]) => `${name} ${hex}`);
  const look = typeof story?.look === "string" ? story.look : story?.look?.name;
  const grade = typeof story?.grade === "string" ? story.grade : story?.grade?.name;
  return [
    "Look: a photographic, naturally lit shot",
    look ? `in the ${look} treatment` : null,
    grade ? `with a ${grade} grade` : null,
    colors.length ? `colour graded toward the palette ${colors.join(", ")}` : null
  ].filter(Boolean).join(", ") + ". Every shot in this video shares this look.";
}

/**
 * A request → the shared brief, or null when refusalReason() refuses it.
 * look: the story's lookParagraph(). fps: the story's rate.
 */
export function footageBrief(request, { look = lookParagraph(null), fps = DEFAULT_FPS } = {}) {
  if (refusalReason(request)) return null;
  const still = request.type === "image" || request.still === true;
  const backdrop = request.role === "background";
  // The narration line is never in the prompt: image models draw quoted words as
  // captions, and some (flux schnell) ignore the negative prompt. shows says what the shot is.
  const prompt = [
    `${String(request.shows).trim()}.`,
    look,
    backdrop
      ? "Composition: a calm, even background with no strong subject and empty space across the frame."
      : "Composition: keep the lower third calm and empty.",
    NO_TEXT
  ].filter(Boolean).join(" ");
  const seconds = Number(request.duration) > 0 ? Number(request.duration) : DEFAULT_SHOT_SECONDS;
  const body = {
    id: request.id,
    kind: "footage",
    steps: still ? ["image"] : ["image", "video"],
    image: { prompt, negative: FOOTAGE_NEGATIVE, width: request.format?.width ?? null, height: request.format?.height ?? null, references: [] },
    video: still ? null : {
      prompt: backdrop
        ? "Low motion: one slow, steady pan or push in. Nothing enters or leaves the frame."
        : "One slow camera move or one simple action. The subject, place and light stay as in the start frame.",
      seconds: Math.round(seconds * 1000) / 1000,
      pad_seconds: EDGE_PAD_SECONDS,
      fps
    }
  };
  return { ...body, brief_hash: `sha256:${hashValue(body)}` };
}

// What no story keyframe may show (§4.1 "Never"); the bible's rules follow it.
export const STORY_NEGATIVE = "text, lettering, captions, subtitles, signs with words, logos, watermarks, extra people, background figures, crowds, mirrors, reflections";
// Where projectBriefs() writes each shot's first animatic frame, the keyframe's layout reference.
export const LAYOUT_DIR = ".launchclip/generate/layout";

const round1 = (value) => Math.round(value * 10) / 10;
const castOf = (bible) => (Array.isArray(bible?.cast) ? bible.cast : Array.isArray(bible?.cast?.characters) ? bible.cast.characters : []);
const nameOf = (entry, id) => entry?.name ?? id;

/** The bible's world and its light in words, for a keyframe or a plate. */
function placeWords(world, set) {
  const kind = world?.kind, time = world?.time ?? "day";
  const def = WORLDS[kind];
  if (!def) return `Place: ${kind ?? "the story's world"}${set ? `, the ${set} set` : ""}.`;
  const light = worldLight(kind, time);
  return `Place: ${def.describe}${set ? `, the ${set} set` : ""}. Light: ${time}, key light ${light.color} at strength ${light.intensity}.`;
}

/** The first frame of a shot in the animatic, as projectBriefs() writes it. */
export const layoutFramePath = (project, id) => path.join(path.resolve(project), LAYOUT_DIR, `${id}.png`);

/**
 * Why a story shot is not generated, or null when it may be (§4.1): two
 * actions are split first or drawn in code, and every character in frame
 * needs its bible description to paste word for word.
 */
export function storyRefusalReason(shot, { bible } = {}) {
  const actions = Array.isArray(shot?.actions) ? shot.actions : [];
  if (actions.length > 1) return `shot ${shot.id} has ${actions.length} actions (${actions.map((a) => `${a.who} ${a.verb}`).join(", ")}); split it or draw it in code`;
  if (!(shot?.who ?? []).length) return `shot ${shot?.id} has nobody in frame; use the place's plate`;
  const cast = castOf(bible);
  const missing = shot.who.filter((id) => !cast.find((entry) => entry?.id === id)?.description);
  if (missing.length) return `the show bible has no description for ${missing.join(", ")}`;
  return null;
}

/**
 * A shot of the shot list (src/story_shots.js shotList) → the shared brief,
 * or null when storyRefusalReason() refuses it.
 * bible: the frozen BIBLE.json; animatic: ANIMATIC.json (its shot's first
 * frame is the layout reference, at layoutFramePath()); story: the storyboard
 * (size and rate); project: the folder the bible's sheet paths are relative to.
 */
export function storyBrief(shot, { bible, animatic = null, story = null, project = ".", follows = null, soundEffects = false } = {}) {
  if (storyRefusalReason(shot, { bible })) return null;
  const cast = castOf(bible);
  const entry = (id) => cast.find((member) => member?.id === id);
  const where = (id) => `${nameOf(entry(id), id)}${entry(id)?.position ? ` (${entry(id).position})` : ""}`;
  const opening = (id) => shot.poses?.[id]?.[0];
  const drawing = styleParagraph(bible?.cast?.style ?? bible?.style?.drawing_style);
  const prompt = [
    // Pasted word for word, never paraphrased (§4.1 "The description is the bible's").
    ...shot.who.map((id) => entry(id).description),
    placeWords(bible?.world, shot.set),
    `Shot: ${shot.framing ?? "medium"} shot. ${shot.who.map((id) => {
      const pose = opening(id);
      return `${where(id)}${pose ? `: ${[pose.pose, pose.expression].filter(Boolean).join(", ")}` : ""}`;
    }).join("; ")}.`,
    // The style's locked paragraph, word for word (style-paragraphs.js), then its anatomy as constraints.
    drawing?.drawing,
    drawing?.place,
    drawing?.anatomy,
    "Match the reference sheets exactly."
  ].filter(Boolean).join(" ");
  const sheets = shot.who.map((id) => entry(id)?.sheet).filter((sheet) => typeof sheet === "string").map((sheet) => path.resolve(project, sheet));
  const layout = (animatic?.shots ?? []).some((entry) => entry?.id === shot.id) ? [layoutFramePath(project, shot.id)] : [];
  const action = shot.actions?.[0];
  const beats = causalBeats(shot, { where, nameOf: (id) => nameOf(entry(id), id), action });
  // Continuity (§4.1 "Continuity between clips"): the clip starts on the last retained frame of the shot before it.
  const carried = follows ? follows.who.filter((id) => shot.who.includes(id)).map((id) => {
    const last = (follows.poses?.[id] ?? []).reduce((state, next) => ({ ...state, ...next }), {});
    return `${where(id)} as it left off (${[last.pose && third(last.pose), last.expression, propOf(last.holds) && `holding the ${propOf(last.holds)}`].filter(Boolean).join(", ") || "same pose"})`;
  }) : [];
  const body = {
    id: shot.id,
    kind: "story",
    steps: ["image", "video"],
    image: { prompt, negative: [STORY_NEGATIVE, drawing?.negative, ...(bible?.rules ?? [])].filter(Boolean).join(", "), width: story?.format?.width ?? null, height: story?.format?.height ?? null, references: [...sheets, ...layout] },
    video: {
      prompt: [
        `Camera: ${shot.framing ?? "medium"} shot, steady.`,
        action ? `Action: ${nameOf(entry(action.who), action.who)} ${third(action.verb)}${targetWords(action.target)}.` : null,
        follows ? `The start frame is the last frame of the shot before; carry straight on from it: ${carried.join("; ")}, same side of frame and facing the same way.` : null,
        ...beats,
        beats.length > 1 ? "Play the beats in order, each caused by the one before: every grip, release and contact lands on screen, and what an action changes stays changed." : null,
        drawing?.motion,
        "Continuity: who is in frame, where they stand and the light stay as in the start frame; nothing moves that the beats do not name.",
        // The mix is ours (narration, music and effects are laid in the edit), so the model's own soundtrack is off by default.
        soundEffects
          ? "Audio: only the sound effects of the actions on screen; no music, no speech or narration."
          : "Audio: none; no music, no speech or narration, no sound effects."
      ].filter(Boolean).join(" "),
      audio: soundEffects ? "effects" : "none",
      ...(follows ? { continue_from: follows.id } : {}),
      seconds: Math.round(shot.seconds * 1000) / 1000,
      pad_seconds: EDGE_PAD_SECONDS,
      fps: Number(story?.format?.fps) || DEFAULT_FPS
    }
  };
  return { ...body, brief_hash: `sha256:${hashValue(body)}` };
}

// A verb id of the shot list ("gaze-at", "turn-to-look") in the third person: "gazes at", "turns to look".
export function third(id) {
  const [first, ...rest] = String(id).split(/[-_\s]+/);
  const verb = /(s|sh|ch|x|z|o)$/.test(first) ? `${first}es` : /[^aeiou]y$/.test(first) ? `${first.slice(0, -1)}ies` : `${first}s`;
  return [verb, ...rest].join(" ");
}
// A prop or target in words; cue fields may give a string or {name | prop | id}.
const propOf = (value) => (typeof value === "string" ? value : value?.name ?? value?.prop ?? value?.id ?? null);
const targetWords = (target) => (propOf(target) ? ` ${propOf(target)}` : "");

/**
 * The shot's states as timed beats of cause and effect (§4.1 "Action"): the
 * setup, the shot's action, what it changes, the reaction. Each beat names
 * only what changes: a pose, an expression, an action and its target, a prop
 * gripped or let go (`holds`), a contact (`contact`), a hand-off (`to`), a
 * camera move. Fields other than pose, expression, action and shot are read
 * when a state has them and never required.
 */
export function causalBeats(shot, { where = (id) => id, nameOf = (id) => id, action = shot.actions?.[0] } = {}) {
  const events = new Map();
  const add = (t, line) => events.set(t, [...(events.get(t) ?? []), line]);
  let actionAt = null;
  for (const id of shot.who ?? []) {
    let prev = null;
    let held = null;
    for (const state of shot.poses?.[id] ?? []) {
      const t = Math.max(0, round1(state.at - shot.start));
      const parts = [];
      if (!prev) parts.push([state.pose && third(state.pose), state.expression].filter(Boolean).join(", "));
      else {
        if (state.pose && state.pose !== prev.pose) parts.push(third(state.pose));
        if (state.expression && state.expression !== prev.expression) parts.push(`now ${state.expression}`);
      }
      // A state without `holds` keeps the prop the last one held.
      const holding = "holds" in state ? propOf(state.holds) : held;
      if (holding !== held) {
        if (held) parts.push(`lets go of the ${held}`);
        if (holding) parts.push(prev ? `grips the ${holding}` : `holding the ${holding}`);
      }
      held = holding;
      if (state.action && (state.action !== prev?.action || propOf(state.target) !== propOf(prev?.target))) {
        const target = propOf(state.target) ?? (action?.who === id && action?.verb === state.action ? propOf(action.target) : null);
        // With no target, a verb's trailing preposition goes ("gazes at" → "gazes").
        parts.push(`${target ? `${third(state.action)} ${target}` : third(state.action).replace(/ (at|to|toward|towards|on|onto|into|with|from)$/, "")}${state.to ? ` to ${nameOf(state.to)}` : ""}`);
      }
      // The shot's action lands on the first state that plays it, as an action or as a pose.
      if (actionAt === null && action?.who === id && (state.action === action.verb || (state.pose === action.verb && state.pose !== prev?.pose))) actionAt = t;
      if (typeof state.contact === "string" && state.contact) parts.push(state.contact);
      if (state.shot && state.shot !== prev?.shot) add(t, `camera moves to a ${state.shot} shot`);
      const what = parts.filter(Boolean).join(", ");
      if (what) add(t, `${where(id)} ${what}`);
      prev = state;
    }
  }
  const times = [...events.keys()].sort((a, b) => a - b);
  const at = times.indexOf(actionAt);
  const label = (i) => {
    if (times.length < 2) return null;
    if (at < 0) return i === 0 ? "setup" : null;
    if (i < at) return "setup";
    if (i === at) return "action";
    return i === times.length - 1 && i > at + 1 ? "reaction" : "consequence";
  };
  return times.map((t, i) => `${t}–${round1(times[i + 1] ?? shot.seconds)} s${label(i) ? ` (${label(i)})` : ""}: ${events.get(t).join("; ")}.`);
}

/**
 * A plate: one place with nobody in it, made once and reused in every shot
 * there (§4.1). place: a set name, or null for the world alone. Image only.
 */
export function plateBrief(place, { bible, story = null } = {}) {
  const drawing = styleParagraph(bible?.cast?.style ?? bible?.style?.drawing_style);
  const body = {
    id: `plate-${bible?.world?.kind ?? "world"}${place ? `-${place}` : ""}`,
    kind: "story",
    steps: ["image"],
    image: {
      prompt: [placeWords(bible?.world, place), "Nobody in frame: an empty place, ready for the characters.", drawing?.place].filter(Boolean).join(" "),
      negative: [STORY_NEGATIVE, "people, characters, animals, figures", ...(bible?.rules ?? [])].join(", "),
      width: story?.format?.width ?? null,
      height: story?.format?.height ?? null,
      references: []
    },
    video: null
  };
  return { ...body, brief_hash: `sha256:${hashValue(body)}` };
}

/**
 * The part of a generated clip the edit keeps, in source seconds: the pad
 * trimmed off each end (§6). {in, out, last}: last is the time of the last
 * kept frame, the next clip's start frame when it continues this one.
 */
export function retainedRange(video) {
  const pad = Number(video?.pad_seconds) || 0, seconds = Number(video?.seconds) || 0, fps = Number(video?.fps) || DEFAULT_FPS;
  const r3 = (value) => Math.round(value * 1000) / 1000;
  return { in: r3(pad), out: r3(pad + seconds), last: r3(Math.max(pad, pad + seconds - 1 / fps)) };
}

const run = promisify(execFile);
export const grabFrame = (video, seconds, out) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(seconds), "-i", video, "-frames:v", "1", out]);

/**
 * Every footage shot request in a project's storyboard, with its brief (or the
 * reason it is refused); then, in a project with a show bible and an
 * animatic, each story shot and one plate per place. Calls no provider:
 * requests are collected by asking a provider that records them and answers null.
 * → [{request, brief, reason}], footage first. A story entry's request is
 * {id, scene_id, role: "story" | "plate"} and it carries the `shot` or `place`.
 * hooks.frame(video, seconds, out) stands in for ffmpeg.
 */
export async function projectBriefs(project, hooks = {}) {
  const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
  const words = (await loadWords(project, story)) ?? [];
  const requests = [];
  await resolveShots(story, { assets: { findShot: (request) => { requests.push(request); return null; } }, words });
  const look = lookParagraph(story);
  const fps = Number(story.format?.fps) || DEFAULT_FPS;
  const footage = requests.map((request) => {
    const reason = refusalReason(request);
    return { request, brief: reason ? null : footageBrief(request, { look, fps }), reason };
  });
  return [...footage, ...await storyEntries(project, story, hooks)];
}

/**
 * Each story shot's brief (or why it is refused) and one plate brief per
 * place, in a project with a show bible and an animatic; [] without them.
 * → [{request: {id, scene_id, role: "story" | "plate"}, shot | place, brief, reason}]
 */
export async function storyBriefs(project, story, hooks = {}, options = {}) {
  return storyEntries(project, story, hooks, options);
}

/**
 * Whether a shot carries straight on from the one before (§4.1 "Continuity
 * between clips"): the same set, no gap between them (within a frame) and
 * someone in both.
 */
export function continuesFrom(prev, shot, fps = DEFAULT_FPS) {
  return Boolean(prev && shot && (prev.set ?? null) === (shot.set ?? null) && Math.abs(Number(shot.start) - Number(prev.end)) <= 1 / fps + 1e-6 && (prev.who ?? []).some((id) => (shot.who ?? []).includes(id)));
}

// options: {continuity, soundEffects} (finish's --generate-continuity, --generate-sound-effects);
// each defaults to the storyboard's generate.continuity / generate.sound_effects, else off.
async function storyEntries(project, story, { frame = grabFrame } = {}, options = {}) {
  const continuity = Boolean(options.continuity ?? story?.generate?.continuity);
  const soundEffects = Boolean(options.soundEffects ?? story?.generate?.sound_effects);
  if (!existsSync(path.join(project, BIBLE_FILE))) return [];
  const { animatic: found, fresh } = await readAnimatic(project);
  if (!found) return [];
  // A stale animatic's frames show another cut: no layout reference then, the words still say who is where.
  const animatic = fresh ? found : null;
  const bible = JSON.parse(await readFile(path.join(project, BIBLE_FILE), "utf8"));
  const { shots } = await storyShotsCommand(project);
  const video = path.join(project, found.video);
  const fps = Number(found.fps) || DEFAULT_FPS;
  const out = [];
  for (const [i, shot] of shots.entries()) {
    const reason = storyRefusalReason(shot, { bible });
    // Chained only to a shot that is generated too: a code-drawn shot has no clip to take a frame from.
    const prev = out[i - 1]?.brief ? shots[i - 1] : null;
    const follows = continuity && continuesFrom(prev, shot, Number(story?.format?.fps) || DEFAULT_FPS) ? prev : null;
    const brief = reason ? null : storyBrief(shot, { bible, animatic, story, project, follows, soundEffects });
    const layout = brief?.image.references.find((file) => file.startsWith(path.join(path.resolve(project), LAYOUT_DIR)));
    if (layout) {
      const first = animatic.shots.find((entry) => entry.id === shot.id)?.first_frame ?? 0;
      await mkdir(path.dirname(layout), { recursive: true });
      await frame(video, first / fps, layout);
    }
    out.push({ request: { id: shot.id, scene_id: shot.id, role: "story" }, shot, brief, reason });
  }
  const places = [...new Set(shots.map((shot) => shot.set ?? null))];
  for (const place of places) {
    const brief = plateBrief(place, { bible, story });
    out.push({ request: { id: brief.id, scene_id: null, role: "plate" }, place, brief, reason: null });
  }
  return out;
}

/** projectBriefs() as text a person can paste into any generation tool. */
export function formatBriefs(briefs) {
  if (!briefs.length) return "No footage shot requests in this storyboard.\n";
  return briefs.map(({ request, brief, reason }) => {
    const head = request.role === "story" ? `# ${request.id} (story shot)` : request.role === "plate" ? `# ${request.id} (plate, nobody in frame)` : `# ${request.id} (scene ${request.scene_id ?? "?"}${request.role === "background" ? ", backdrop" : ""})`;
    if (!brief) return `${head}\nrefused: ${reason}\n`;
    const lines = [head, `steps: ${brief.steps.join(" → ")}`, `size: ${brief.image.width}×${brief.image.height}`, "", "image prompt:", brief.image.prompt, "", "negative:", brief.image.negative];
    if (brief.image.references.length) lines.push("", "references:", ...brief.image.references);
    if (brief.video) {
      const kept = retainedRange(brief.video);
      lines.push("", `video prompt (${brief.video.seconds} s at ${brief.video.fps} fps; request ${Math.round((brief.video.seconds + 2 * brief.video.pad_seconds) * 1000) / 1000} s, ${brief.video.pad_seconds} s padding each end):`, brief.video.prompt, "", `keep: ${kept.in}–${kept.out} s of the clip${brief.video.audio === "none" ? "; native audio off" : brief.video.audio === "effects" ? "; native sound effects only" : ""}`);
      if (brief.video.continue_from) lines.push(`start frame: the last kept frame of ${brief.video.continue_from}'s clip, not this shot's keyframe`);
    }
    lines.push("", brief.brief_hash);
    return `${lines.join("\n")}\n`;
  }).join("\n");
}
