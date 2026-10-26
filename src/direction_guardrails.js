// Direction guardrails (docs/DIRECTION_GUARDRAILS.md): finish gates that make
// bad direction fail before review, measured on the resolved story and the
// renderer-neutral op lists both renderers play.
//
//   physicsGate(story)   anchored world elements move only with the camera
//   actingGate(story, {map, words})  each line's key action is performed
//   ghostingGate(story)  one copy of a person; nothing half-transparent held
//   densityGate(story, {rects, profile})  no empty region or lone card held long
//   varietyGate(story)   the same shot never repeats back to back
//
// Each gate → {status: "passed" | "failed" | "skipped", findings: [{rule,
// severity, at?, ids, detail}]}. Errors fail the gate; warnings do not.

import { frameState } from "../kit/core/catalog-b-view.mjs";
import { charactersTimeline } from "../kit/core/catalog-characters.mjs";
import { worldTimeline } from "../kit/core/catalog-world.mjs";
import { rideWorldPlates } from "../kit/core/camera-world.mjs";
import { driftEligible } from "../kit/core/ambient.mjs";
import { profileGeometry } from "../kit/core/layout-check.mjs";
import { TEXT_FADE, resolveModule } from "../kit/core/modules.mjs";
import { TRANSFORM_KEYS } from "../kit/core/physics.mjs";
import { samePlaceCuts, twoCopies } from "../kit/core/story.mjs";
import { sceneWindows } from "../kit/core/transitions.mjs";
import { ACTION_INFO, LOOK_ACTIONS } from "../kit/core/characters/actions.mjs";
import { narrationWords } from "../kit/core/direction.mjs";

// Sampling step (s) and tolerances for "moves with its layer".
export const PHYSICS = Object.freeze({ step: 0.1, px: 0.5, scale: 0.001, fadeLow: 0.02, fadeHigh: 0.98 });

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const scenesOf = (story) => (Array.isArray(story?.scenes) ? story.scenes : []);

function gateResult(findings, extra = {}) {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  return { status: errors ? "failed" : "passed", errors, warnings: findings.length - errors, findings: findings.slice(0, 40), ...extra };
}

/**
 * Windows and models as the compilers build them: sceneWindows with riders
 * joined to their plates, each scene resolved to its render end. Scenes that
 * do not resolve are left out (the placeholder gate reports them).
 * → {windows, entries: Map id → {entry, model}}
 */
export function renderedModels(story) {
  const windows = rideWorldPlates(story, sceneWindows(story));
  const entries = new Map();
  for (const entry of windows.scenes) {
    let model = null;
    try { model = resolveModule(entry.scene, story, { end: entry.renderEnd }); } catch { model = null; }
    if (model) entries.set(entry.id, { entry, model });
  }
  return { windows, entries };
}

function times(start, end, step) {
  const out = [];
  for (let t = start; t <= end + 1e-9; t += step) out.push(round(t, 4));
  return out;
}

const transformed = (props) => TRANSFORM_KEYS.some((key) => props && props[key] !== undefined && Math.abs(props[key] - (key.startsWith("scale") ? 1 : 0)) > 1e-6);

/**
 * World physics (docs/DIRECTION_GUARDRAILS.md §1):
 * - same-place-cut: two plates of one place joined by a cut;
 * - anchored-moves: a world plate's ops move something other than its
 *   camera layers, or a set anchored to a plate moves apart from the
 *   plate's front layer;
 * - set-pops: a set standing in a plate covers only part of its window;
 * - set-fades: an anchored set fades over a plate that is already there;
 * - set-drifts: an anchored set takes the ambient hold drift.
 */
export function physicsGate(story) {
  const findings = [];
  for (const pair of samePlaceCuts(story)) {
    const scene = scenesOf(story).find((entry) => entry.id === pair.to);
    findings.push({ rule: "same-place-cut", severity: "error", at: scene?.start ?? null, ids: [pair.from, pair.to], detail: `a cut between two plates of the same place (${pair.place}) makes its furniture jump; make them one world scene or cut to a different place` });
  }
  const { entries } = renderedModels(story);
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const frame = 1 / fps + 1e-6;
  const worldOps = new Map();
  for (const [id, { model }] of entries) {
    if (model.module !== "world") continue;
    const ops = worldTimeline(model);
    worldOps.set(id, ops);
    const layers = new Set(["back", "mid", "front", "fx"].map((layer) => `${id}-${layer}`));
    for (const op of ops) {
      const props = op.type === "set" ? op.props : op.to;
      if (op.target === id && transformed(props)) findings.push({ rule: "anchored-moves", severity: "error", at: op.time ?? op.start, ids: [id], detail: `the world plate ${id} itself moves (${Object.keys(props).join(", ")}); only its camera layers may move` });
      else if (op.target !== id && !layers.has(op.target)) findings.push({ rule: "anchored-moves", severity: "error", at: op.time ?? op.start, ids: [id], detail: `the world ${id} animates ${op.target}, which is anchored to its layer; only the camera moves anchored things` });
    }
  }
  for (const [id, { entry, model }] of entries) {
    if (model.module !== "cast-scene") continue;
    const c = model.content;
    if (c.backdrop !== "world" || c.drawWorld) continue;
    const plateId = model.content.follow?.plate ?? null;
    const beneath = plateId ?? null;
    const plate = beneath ? entries.get(beneath) : null;
    if (!plate) {
      findings.push({ rule: "anchored-moves", severity: "error", at: entry.start, ids: [id], detail: `the set of ${id} stands in a world but follows no plate camera` });
      continue;
    }
    const scene = entry.scene, plateScene = plate.entry.scene;
    if (Math.abs(scene.start - plateScene.start) > frame || Math.abs(scene.end - plateScene.end) > frame) {
      findings.push({ rule: "set-pops", severity: "error", at: scene.start, ids: [id, beneath], detail: `${id} (${scene.start}–${scene.end} s) covers only part of the plate ${beneath} (${plateScene.start}–${plateScene.end} s), so its ${c.set} pops in or out over the world; give the cast-scene the plate's window (characters can arrive with a walk-to cue) or split the world scene at the cut` });
    }
    if (driftEligible(story, scene, model)) findings.push({ rule: "set-drifts", severity: "error", at: scene.start, ids: [id], detail: `${id}'s set would take the ambient hold drift, sliding over the world it stands in` });
    const ops = charactersTimeline(model);
    for (const op of ops) {
      if (op.target === id && transformed(op.type === "set" ? op.props : op.to)) findings.push({ rule: "anchored-moves", severity: "error", at: op.time ?? op.start, ids: [id], detail: `${id}'s set moves on its own; only the plate camera moves it` });
    }
    const plateOps = worldOps.get(beneath) ?? [];
    // Inside both render windows, the set's wrapper and the plate's front layer agree.
    const from = Math.max(entry.start, plate.entry.start), to = Math.min(entry.renderEnd, plate.entry.renderEnd);
    // Transitions on the plate (its own in, the next plate's in) may fade the set with it.
    const passing = [];
    const pIn = plate.entry.transitionIn;
    if (pIn && pIn.type !== "cut") passing.push([plate.entry.start, plate.entry.start + pIn.dur]);
    if (plate.entry.renderEnd > plate.entry.end + 1e-6) passing.push([plate.entry.end, plate.entry.renderEnd]);
    const inPassage = (t) => passing.some(([a, b]) => t >= a - 1e-6 && t <= b + 1e-6);
    let moved = null, faded = null;
    for (const t of times(from, to - 1e-3, PHYSICS.step)) {
      const world = frameState(plateOps, t).get(`${beneath}-front`) ?? {};
      const state = frameState(ops, t);
      const cam = state.get(`${id}-cam`) ?? {};
      const dx = Math.abs((world.x ?? 0) - (cam.x ?? 0));
      const ds = Math.abs((world.scaleX ?? 1) - (cam.scaleX ?? 1));
      if (!moved && (dx > PHYSICS.px || ds > PHYSICS.scale)) moved = { t, dx: round(dx, 2), ds: round(ds, 4) };
      const opacity = state.get(id)?.opacity;
      if (!faded && Number.isFinite(opacity) && opacity > PHYSICS.fadeLow && opacity < PHYSICS.fadeHigh && !inPassage(t)) faded = { t, opacity: round(opacity, 2) };
    }
    if (moved) findings.push({ rule: "anchored-moves", severity: "error", at: moved.t, ids: [id, beneath], detail: `${id}'s ${c.set} slides ${moved.dx} px (scale ${moved.ds}) against the plate ${beneath}'s front layer; an anchored set moves only with the plate camera` });
    if (faded) findings.push({ rule: "set-fades", severity: "error", at: faded.t, ids: [id, beneath], detail: `${id}'s ${c.set} is at ${faded.opacity} opacity over the plate ${beneath}, which is already there; it should arrive and leave with the plate (a cut, or the plate's own transition)` });
  }
  return gateResult(findings);
}

// How far (s) around a line's words an action may land and still count.
export const ACTING_SLACK = 0.5;

const CHARACTER_MODULES = ["cast-scene", "character-cameo"];

/** Does a directed state perform a verb (an acting cue, or a pose)? */
function performs(state, verb) {
  if (state.action === verb || state.pose === verb) return true;
  // A walk ends on its arrival state, which is still the walk-to.
  return verb === "walk-to" && state.arrive === true;
}

/**
 * Acting (docs/DIRECTION_GUARDRAILS.md §2):
 * - action-missing: a line's key action (map line.action {verb, who}) is not
 *   performed by that character in a cast scene during the line (±0.5 s);
 * - faces-away: a character with a target faces away from it;
 * - look-unread: a look (look-far, turn-to-look, gaze-at) performed facing
 *   the camera, so it does not read as looking at anything;
 * - look-target-hidden: a card covers what the character looks at (the
 *   window, the street, a prop) while it looks (rects: the layout check's).
 * map: DIRECTION.json; words: NARRATION.json words. Skipped without a map.
 */
export function actingGate(story, { map, words, rects = [] } = {}) {
  if (!map || !Array.isArray(map.sections)) return { status: "skipped", reason: "no direction map" };
  const list = narrationWords(words);
  const findings = [];
  const { entries } = renderedModels(story);
  const characterScenes = [...entries.values()].filter(({ model }) => CHARACTER_MODULES.includes(model.module));
  let named = 0;
  for (const section of map.sections) {
    for (const line of Array.isArray(section?.lines) ? section.lines : []) {
      const action = line?.action;
      if (!action || !Array.isArray(line.words)) continue;
      named += 1;
      const first = list[line.words[0]], last = list[line.words[1]];
      if (!first || !last) continue;
      const from = first.start - ACTING_SLACK, to = last.end + ACTING_SLACK;
      const ids = Array.isArray(line.scenes) ? new Set(line.scenes) : null;
      const candidates = characterScenes.filter(({ entry }) => entry.start < to && entry.renderEnd > from && (!ids || ids.has(entry.id) || ![...ids].some((id) => entries.get(id) && CHARACTER_MODULES.includes(entries.get(id).model.module))));
      const hits = [];
      for (const { model } of candidates) for (const actor of model.content.actors) {
        if (actor.id !== action.who) continue;
        actor.states.forEach((state, i) => {
          const holdEnd = actor.states[i + 1]?.time ?? model.end;
          if (performs(state, action.verb) && state.time < to && holdEnd > from) hits.push({ model, actor, state, holdEnd });
        });
      }
      const done = hits.length > 0;
      // A look reads only when the character turns from the camera.
      if (done && LOOK_ACTIONS.includes(action.verb) && hits.every((hit) => hit.state.view === "front")) {
        findings.push({ rule: "look-unread", severity: "error", at: hits[0].state.time, ids: [hits[0].model.id], detail: `${action.who} performs ${action.verb} facing the camera, so it does not read as looking at anything; give the cue a target (window, street, horizon, skyline, a prop) so the character turns to it` });
      }
      if (!done) {
        const where = candidates.length ? `cast scenes ${candidates.map(({ entry }) => entry.id).join(", ")}` : "no cast scene";
        const hint = ACTION_INFO[action.verb] ? `a cue {at: "word:…", action: "${action.verb}"${action.target ? `, target: ${JSON.stringify(action.target)}` : ""}}` : `a cue {at: "word:…", pose: "${action.verb}"}`;
        findings.push({ rule: "action-missing", severity: "error", at: first.start, ids: candidates.map(({ entry }) => entry.id), detail: `"${String(line.text ?? "").slice(0, 60) || `words ${line.words.join("–")}`}" names ${action.who} ${action.verb}, but ${where} on it performs it (${round(first.start, 2)}–${round(last.end, 2)} s); give ${action.who} ${hint}` });
      }
    }
  }
  // What a character looks at stays in view (named places and props, not {x, y}: a card can be the target).
  const cards = rects.filter((element) => (element.role === "text" || element.role === "hero") && element.rect);
  for (const { entry, model } of characterScenes) {
    for (const actor of model.content.actors) {
      actor.states.forEach((state, i) => {
        if (!state.point || !(LOOK_ACTIONS.includes(state.action) || state.view === "back") || (state.target && typeof state.target === "object" && "x" in state.target)) return;
        // Its own scene's window: a riding cast is held through the move out, over the next place.
        const holdEnd = Math.min(actor.states[i + 1]?.time ?? model.end, entry.scene.end);
        const px = state.point.x ?? actor.x, py = state.point.y;
        if (!Number.isFinite(py)) return;
        const cover = cards.find((card) => card.start < holdEnd - 1e-6 && card.end > state.time + 1e-6 && px >= card.rect.x && px <= card.rect.x + card.rect.width && py >= card.rect.y && py <= card.rect.y + card.rect.height);
        if (cover) findings.push({ rule: "look-target-hidden", severity: "error", at: Math.max(state.time, cover.start), ids: [entry.id, cover.id], detail: `${cover.id} covers what ${actor.id} looks at in ${entry.id} (${JSON.stringify(state.target)} at ${Math.round(px)}, ${Math.round(py)}); move the card to one side or bring it in after the look` });
      });
      const away = actor.states.find((state) => state.target !== null && state.target !== undefined && state.gaze && ((state.gaze.x > 0 && state.facing === "left") || (state.gaze.x < 0 && state.facing === "right")));
      if (away) findings.push({ rule: "faces-away", severity: "error", at: away.time, ids: [entry.id], detail: `${actor.id} in ${entry.id} faces ${away.facing}, away from its target ${JSON.stringify(away.target)}; drop the facing so it faces what it looks at` });
    }
  }
  return gateResult(findings, { actions: named });
}

// Ghosting thresholds (docs/DIRECTION_GUARDRAILS.md §4).
export const GHOSTING = Object.freeze({ step: 0.1, visible: 0.05, solid: 0.95, characterHalf: 0.25, textHalf: 0.5 });

// Opacity a scene's transition tweens (transitions.mjs: {prop, from, to, at,
// duration}) give its layer at t: 1 outside them.
function tweenOpacity(entry, t) {
  let value = 1;
  for (const tween of entry.tweens ?? []) {
    if (tween.prop !== "opacity") continue;
    const a = Number(tween.at), d = Number(tween.duration) || 0;
    if (t < a - 1e-9) { if (tween.role === "in" || tween.role === "hold") value = Math.min(value, Number(tween.from)); continue; }
    const p = d > 0 ? Math.min(1, (t - a) / d) : 1;
    if (p >= 1 && tween.role !== "out") continue;
    value = Math.min(value, Number(tween.from) + (Number(tween.to) - Number(tween.from)) * p);
  }
  return value;
}

// Words in a text module's params (headline, text, quote, labels…), for its reading time.
function paramWords(params) {
  // Meta lines (a source, a role) are glanced at, not read: they do not count.
  const skip = new Set(["icon", "tone", "surface", "variant", "layout", "src", "kind", "set", "id", "emphasis", "highlight", "at", "rect", "source", "role", "author", "kicker"]);
  let count = 0;
  const walk = (value, key) => {
    if (skip.has(key)) return;
    if (typeof value === "string") count += value.split(/\s+/).filter(Boolean).length;
    else if (Array.isArray(value)) value.forEach((item) => walk(item, null));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(params ?? {}, null);
  return count;
}

/** The minimum fully-opaque hold for a text module of `words` words (s). */
export const textHold = (words) => Math.max(TEXT_FADE.minHold, Math.round(words * TEXT_FADE.perWord * 100) / 100);

/**
 * Ghosting (docs/DIRECTION_GUARDRAILS.md §4), sampled at 10 Hz on the op
 * lists both renderers play:
 * - two-copies: one character visible in two scenes at once;
 * - ghost-character: a character between 5% and 95% opacity for more than
 *   0.25 s in a row (a see-through person);
 * - slow-text-fade: a text module fading in or out over more than
 *   TEXT_FADE.max, or a fading transition on it longer than 0.5 s;
 * - text-hold: a text module fully shown for less than its reading time.
 */
export function ghostingGate(story) {
  const findings = [];
  for (const pair of twoCopies(story)) findings.push({ rule: "two-copies", severity: "error", at: pair.from, ids: [pair.a, pair.b], detail: `${pair.character} is in ${pair.a} and ${pair.b} at once (${pair.from}–${pair.to} s); end one where the other starts` });
  const { entries } = renderedModels(story);
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration) || 0;
  const people = [];
  for (const [id, { entry, model }] of entries) {
    if (!CHARACTER_MODULES.includes(model.module)) continue;
    const ops = charactersTimeline(model);
    model.content.actors.forEach((actor, index) => {
      const cid = `${id}-c${index}`;
      people.push({ id, entry, character: actor.id, opacity: (t) => {
        if (t < entry.start - 1e-6 || t >= entry.renderEnd - 1e-6) return 0;
        const state = frameState(ops, t);
        const root = state.get(id)?.opacity ?? 1;
        const own = Math.min(state.get(cid)?.opacity ?? 1, state.get(`${cid}-walk`)?.opacity ?? 1);
        return root * own * tweenOpacity(entry, t);
      } });
    });
  }
  const reported = new Set();
  const half = new Map();
  for (const t of times(0, Math.max(0, duration - 1e-3), GHOSTING.step)) {
    const visible = new Map();
    for (const person of people) {
      const value = person.opacity(t);
      if (value > GHOSTING.visible) visible.set(person.character, [...(visible.get(person.character) ?? []), person.id]);
      const key = `${person.id}|${person.character}`;
      if (value > GHOSTING.visible && value < GHOSTING.solid) {
        const run = half.get(key) ?? { from: t, to: t };
        run.to = t;
        half.set(key, run);
        if (run.to - run.from > GHOSTING.characterHalf + 1e-6 && !reported.has(`half|${key}`)) {
          reported.add(`half|${key}`);
          findings.push({ rule: "ghost-character", severity: "error", at: run.from, ids: [person.id], detail: `${person.character} in ${person.id} is see-through (${round(value, 2)} opacity) for more than ${GHOSTING.characterHalf} s from ${run.from} s; cut the cast with its world, or move it in at full opacity` });
        }
      } else half.delete(key);
    }
    for (const [character, scenes] of visible) {
      const key = `copies|${character}|${scenes.join(",")}`;
      if (scenes.length > 1 && !reported.has(key)) {
        reported.add(key);
        findings.push({ rule: "two-copies", severity: "error", at: t, ids: scenes, detail: `two copies of ${character} on screen at ${t} s (${scenes.join(", ")}); the cast changes with a cut, or the next copy appears when the move ends` });
      }
    }
  }
  for (const [id, { entry, model }] of entries) {
    if (!["text", "hero"].includes(model.layout?.role) || !model.motion) continue;
    const m = model.motion;
    const fadeIn = m.enterFrom?.opacity < 1 ? m.enterDuration : 0, fadeOut = m.exitTo?.opacity < 1 ? m.exitDuration : 0;
    const slow = Math.max(fadeIn || 0, fadeOut || 0);
    if (slow > TEXT_FADE.max + 1e-6) findings.push({ rule: "slow-text-fade", severity: "error", at: entry.start, ids: [id], detail: `${id} fades over ${round(slow, 2)} s; text fades take at most ${TEXT_FADE.max} s` });
    const transition = entry.transitionIn;
    if (transition && ["fade", "dissolve", "crossfade"].includes(transition.type) && transition.dur > GHOSTING.textHalf + 1e-6) findings.push({ rule: "slow-text-fade", severity: "error", at: entry.start, ids: [id], detail: `${id} dissolves in over ${transition.dur} s; a text scene's fade takes at most ${GHOSTING.textHalf} s` });
    const words = paramWords(entry.scene.params);
    const enterEnd = Number.isFinite(m.enterEnd) ? m.enterEnd : entry.start + (fadeIn || 0);
    const exitStart = Number.isFinite(m.exitStart) ? m.exitStart : model.end;
    const hold = round(exitStart - enterEnd, 2);
    const need = textHold(words);
    if (words && hold < need - 1e-6) findings.push({ rule: "text-hold", severity: "error", at: enterEnd, ids: [id], detail: `${id} (${words} words) is fully shown for ${hold} s; it needs ${need} s to be read (${TEXT_FADE.perWord} s a word, at least ${TEXT_FADE.minHold} s): lengthen the scene or cut the text` });
  }
  return gateResult(findings);
}

// Density thresholds (docs/DIRECTION_GUARDRAILS.md §5).
export const DENSITY = Object.freeze({ step: 0.5, emptyRegion: 4, loneCard: 3, cover: 0.1 });
const FILLING = ["text", "hero", "media"];
const VISUAL = ["media"];

function coverShare(rect, region) {
  const w = Math.min(rect.x + rect.width, region.x + region.width) - Math.max(rect.x, region.x);
  const h = Math.min(rect.y + rect.height, region.y + region.height) - Math.max(rect.y, region.y);
  return w > 0 && h > 0 ? (w * h) / (region.width * region.height) : 0;
}

/**
 * Density (docs/DIRECTION_GUARDRAILS.md §5), every 0.5 s over the safe area,
 * from the layout check's element rects:
 * - empty-region: a third of the safe area (top, middle, bottom in 9:16;
 *   left, centre, right in 16:9) with only the plate in it for over 4 s;
 * - lone-card: a text card over a world plate with no character or other
 *   visual for over 3 s.
 * rects: [{id, role, module?, rect, start, end}] (checkLayoutProject().rects).
 */
export function densityGate(story, { rects = [], profile } = {}) {
  if (!rects.length) return { status: "skipped", reason: "no layout rects" };
  const canvas = { width: Number(story.format.width), height: Number(story.format.height) };
  const safe = profileGeometry(canvas, profile ?? (canvas.height > canvas.width ? "shorts" : "landscape")).safeZone;
  const portrait = canvas.height > canvas.width;
  const names = portrait ? ["top", "middle", "bottom"] : ["left", "centre", "right"];
  const regions = names.map((name, i) => portrait
    ? { name, x: safe.x, y: safe.y + (safe.height / 3) * i, width: safe.width, height: safe.height / 3 }
    : { name, x: safe.x + (safe.width / 3) * i, y: safe.y, width: safe.width / 3, height: safe.height });
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration) || 0;
  const worlds = scenesOf(story).filter((scene) => scene?.module === "world" && (scene.track ?? 0) === 0);
  const findings = [];
  const runs = new Map();
  const report = (key, from, to, finding) => {
    if (to - from <= finding.limit + 1e-6) return;
    findings.push({ rule: finding.rule, severity: "error", at: round(from, 2), ids: finding.ids, detail: finding.detail(round(to - from, 1), round(from, 2), round(to, 2)) });
  };
  const close = (key, t) => { const run = runs.get(key); if (run) { report(key, run.from, t, run.finding); runs.delete(key); } };
  for (const t of times(0, Math.max(0, duration - 1e-3), DENSITY.step)) {
    const active = rects.filter((element) => FILLING.includes(element.role) && element.rect && element.id !== "base" && element.start <= t + 1e-6 && element.end > t + 1e-6);
    for (const region of regions) {
      const key = `region|${region.name}`;
      const empty = !active.some((element) => coverShare(element.rect, region) >= DENSITY.cover);
      if (empty && !runs.has(key)) runs.set(key, { from: t, finding: { rule: "empty-region", limit: DENSITY.emptyRegion, ids: [], detail: (len, a, b) => `the ${region.name} third holds only the plate for ${len} s (${a}–${b} s); put a character, a prop moment or a card there` } });
      else if (!empty) close(key, t);
    }
    const overWorld = worlds.some((scene) => scene.start <= t + 1e-6 && scene.end > t + 1e-6);
    const cards = active.filter((element) => element.role === "text" || element.role === "hero");
    const lone = overWorld && cards.length && !active.some((element) => VISUAL.includes(element.role));
    const key = "lone-card";
    if (lone && !runs.has(key)) runs.set(key, { from: t, finding: { rule: "lone-card", limit: DENSITY.loneCard, ids: cards.map((card) => card.id), detail: (len, a, b) => `${cards.map((card) => card.id).join(", ")} sits alone over an empty world for ${len} s (${a}–${b} s); keep a character in the set reacting to it or pointing at it` } });
    else if (!lone) close(key, t);
  }
  for (const key of [...runs.keys()]) close(key, duration);
  return gateResult(findings);
}

/** A cast scene's shot: its set, cast and what each does (poses and actions; swapping places is not a new shot), and the world it stands in. */
function shotOf(model) {
  const actors = [...model.content.actors].sort((a, b) => a.id.localeCompare(b.id));
  return { set: model.content.set ?? "cameo", cast: actors.map((actor) => actor.id).join("+"), poses: actors.map((actor) => `${actor.id}:${[...new Set(actor.states.map((state) => state.action ?? state.pose))].join(">")}`).join(" "), world: model.content.world ? `${model.content.world.kind}/${model.content.world.time}` : null };
}

/**
 * Variety (docs/DIRECTION_GUARDRAILS.md §5): consecutive cast scenes with
 * the same set, cast, poses and actions are the same shot again (even over a
 * different world) — an error; the same set and cast more than three times
 * in a video is a warning.
 */
export function varietyGate(story) {
  const { entries } = renderedModels(story);
  const shots = [...entries.values()].filter(({ model }) => CHARACTER_MODULES.includes(model.module)).sort((a, b) => a.entry.start - b.entry.start).map(({ entry, model }) => ({ id: entry.id, start: entry.start, ...shotOf(model) }));
  const findings = [];
  for (let i = 1; i < shots.length; i += 1) {
    const a = shots[i - 1], b = shots[i];
    if (a.set === b.set && a.cast === b.cast && a.poses === b.poses) findings.push({ rule: "repeat-shot", severity: "error", at: b.start, ids: [a.id, b.id], detail: `${b.id} repeats ${a.id}'s shot (${b.set}, ${b.poses})${a.world !== b.world ? ` over a new world (${a.world} → ${b.world})` : ""}; change the set, who is in it, their poses or what they do` });
  }
  const counts = new Map();
  for (const shot of shots) counts.set(`${shot.set}|${shot.cast}`, [...(counts.get(`${shot.set}|${shot.cast}`) ?? []), shot.id]);
  for (const [key, ids] of counts) if (ids.length > 3) findings.push({ rule: "same-setup", severity: "warning", at: shots.find((shot) => shot.id === ids[3]).start, ids, detail: `${key.replace("|", " with ")} appears ${ids.length} times; vary the set or the cast` });
  return gateResult(findings, { shots: shots.length });
}
