// The subject layer: depth against the cut-out presenter in the footage-led
// lane (docs/SUBJECT_EFFECTS_RFC.md §5). Both compilers stack, bottom to top:
//
//   1. room     the base recording, moved by base cameras (model.camera) and
//               hidden, dimmed or blurred by model.room
//   2. behind   scenes with layer "behind", and the behind part of "split"
//   3. subject  the matte videos (base.subject.mattes), moved by the base
//               cameras, or by model.subjectCamera while one runs
//   4. front    every other scene, and the front part of "split"
//   5. captions
//
// The subject layer is mounted only while a scene needs it (a behind or split
// layer, a subjectCamera or a room), so other stories render as before.
//
// Model fields a module may set (all optional, pure functions of time):
//   layer          "behind" | "split": its default layer (a scene's layer wins)
//   parts          split modules: {behind, front} halves the emitters draw on
//                  either side of the subject
//   subjectCamera  {samples: [{t, scale, x, y}]} one per frame, like
//                  model.camera, applied to the subject only
//   room           {hide?: true, dim?: 0–1, blur?: px} for the scene window
//   subjectStyle   {outline?: px, color?: #hex, shadow?: boolean}: a sticker
//                  outline (stacked drop-shadows on the matte's alpha) and a
//                  soft drop shadow on the cut-out, for the scene window
//
// Canonical copy: kit/core/subject-layer.mjs.

import { CAMERA_IDENTITY, cameraSampleProps } from "./catalog-c.mjs";
import { frameState, sampleTime } from "./catalog-b-view.mjs";
import { storyBase } from "./story.mjs";
import { subjectAt, subjectCoverShare } from "./subject.mjs";

export { subjectCoverShare };

export const SUBJECT_CAMERA = "lc-subject-camera";
export const ROOM = "lc-room";
const EPS = 1e-6;

/**
 * The layer a scene draws on: "front", "behind" or "split". A split layer
 * needs a model with parts; without them the scene draws in front and
 * `reason` says why.
 * → {layer, reason?}
 */
export function sceneLayerOf(scene, model) {
  const layer = scene?.layer ?? model?.layer ?? "front";
  if (layer === "split" && !model?.parts) return { layer: "front", reason: `module "${scene?.module}" draws no split parts; it renders in front of the subject` };
  return { layer };
}

/** True when a scene's model needs the cut-out subject. */
export function needsSubject(scene, model) {
  return sceneLayerOf(scene, model).layer !== "front" || Boolean(model?.subjectCamera) || Boolean(model?.room) || Boolean(model?.subjectStyle);
}

/**
 * Timeline windows (merged, sorted) during which the subject layer is shown.
 * entries: [{scene, model, start, end}] (end: the render window's end).
 * include: which entries count (default: those that need the subject).
 */
export function subjectWindows(entries, { include = (entry) => needsSubject(entry.scene, entry.model) } = {}) {
  const spans = (entries ?? [])
    .filter(include)
    .map((entry) => [Number(entry.start), Number(entry.end)])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + EPS) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * The matte clips to mount: each base segment ∩ each matte's source range ∩
 * each subject window, snapped to the frame grid. mediaStart is the offset
 * into the matte file (its frame 0 is the matte's `in`).
 * → [{index, src, start, end, duration, mediaStart, matte}]
 */
export function subjectSegments(story, windows) {
  const base = storyBase(story);
  if (!base || base.subject.mode !== "mattes") return [];
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const snap = (value) => Math.round(value * fps) / fps;
  const out = [];
  for (const segment of base.segments) {
    base.subject.mattes.forEach((matte, matteIndex) => {
      // The matte's source range on the timeline of this base segment.
      const from = segment.start + (matte.in - segment.sourceStart);
      const to = segment.start + (matte.out - segment.sourceStart);
      for (const [wStart, wEnd] of windows) {
        const start = snap(Math.max(segment.start, from, wStart));
        const end = snap(Math.min(segment.end, to, wEnd));
        if (end - start < 1 / fps - EPS) continue;
        out.push({ index: out.length, src: matte.src, start: round6(start), end: round6(end), duration: round6(end - start), mediaStart: round6(snap(segment.sourceStart + (start - segment.start) - matte.in)), matte: matteIndex });
      }
    });
  }
  return out.sort((a, b) => a.start - b.start).map((entry, index) => ({ ...entry, index }));
}

/**
 * Camera ops for the subject layer (target SUBJECT_CAMERA). The subject
 * follows the base cameras so a punch-in moves person and room together;
 * while a model's subjectCamera runs, its samples replace the base ones.
 */
export function subjectCameraOps(models, { subjectFilterAt = null } = {}) {
  const list = (models ?? []).filter(Boolean);
  const own = list.filter((model) => Array.isArray(model.subjectCamera?.samples)).sort((a, b) => a.start - b.start);
  const base = list.filter((model) => Array.isArray(model.camera?.samples)).sort((a, b) => a.start - b.start);
  if (!own.length && !base.length) return [];
  const covered = (t) => own.some((model) => t >= model.start - EPS && t <= model.end + EPS);
  const ops = [{ type: "set", target: SUBJECT_CAMERA, time: 0, props: { ...CAMERA_IDENTITY } }];
  const sampleOp = (sample) => ({ type: "set", target: SUBJECT_CAMERA, time: Math.max(0, sampleTime(sample.t)), props: cameraSampleProps(sample, subjectFilterAt ? subjectFilterAt(sample.t) : "none") });
  for (const model of base) for (const sample of model.camera.samples) if (!covered(sample.t)) ops.push(sampleOp(sample));
  for (const model of own) for (const sample of model.subjectCamera.samples) ops.push(sampleOp(sample));
  // frameState applies same-time ops in list order; sort by time so a base
  // sample before a subject window never lands after the window's samples.
  return ops.map((op, index) => ({ op, index })).sort((a, b) => a.op.time - b.op.time || a.index - b.index).map(({ op }) => op);
}

/** Subject-layer camera transform props at timeline t (identity without cameras). */
export function subjectCameraAt(ops, t) {
  return frameState(ops, t).get(SUBJECT_CAMERA) ?? { ...CAMERA_IDENTITY };
}

/**
 * Room treatment changes, in time order: [{time, state: {opacity, filter}}].
 * A model's room applies over its [start, end) window; when two overlap the
 * later-starting one wins. The base starts and ends untreated.
 */
export function roomChanges(models) {
  const rooms = (models ?? []).filter((model) => model?.room).sort((a, b) => a.start - b.start);
  if (!rooms.length) return [];
  const times = [...new Set(rooms.flatMap((model) => [model.start, model.end]))].sort((a, b) => a - b);
  const changes = [];
  let previous = null;
  for (const time of times) {
    const state = roomStateAt(rooms, time);
    const key = JSON.stringify(state);
    if (key !== previous) changes.push({ time, state });
    previous = key;
  }
  return changes;
}

/** Room state at timeline t: {opacity, filter} ("none" when untreated). */
export function roomStateAt(models, t) {
  const active = (models ?? []).filter((model) => model?.room && t >= model.start - EPS && t < model.end - EPS).sort((a, b) => a.start - b.start);
  const room = active[active.length - 1]?.room;
  if (!room) return { opacity: 1, filter: "none" };
  const filters = [];
  if (typeof room.dim === "number" && room.dim > 0) filters.push(`brightness(${round6(1 - Math.min(1, room.dim))})`);
  if (typeof room.blur === "number" && room.blur > 0) filters.push(`blur(${round6(room.blur)}px)`);
  return { opacity: room.hide ? 0 : 1, filter: filters.length ? filters.join(" ") : "none" };
}

/** The cut-out's style at timeline t: a CSS filter ("none" when unstyled). */
export function subjectFilterAt(models, t) {
  const active = (models ?? []).filter((model) => model?.subjectStyle && t >= model.start - EPS && t < model.end - EPS).sort((a, b) => a.start - b.start);
  const style = active[active.length - 1]?.subjectStyle;
  if (!style) return "none";
  const parts = [];
  const outline = Number(style.outline ?? 0);
  if (outline > 0) {
    const color = style.color ?? "#ffffff";
    // Eight offsets round the alpha edge make a solid outline.
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) parts.push(`drop-shadow(${round6(dx * outline)}px ${round6(dy * outline)}px 0 ${color})`);
  }
  if (style.shadow) parts.push(`drop-shadow(0px ${round6(Math.max(6, outline))}px ${round6(Math.max(12, outline * 2))}px rgba(0, 0, 0, 0.45))`);
  return parts.length ? parts.join(" ") : "none";
}

/** Subject style changes, in time order: [{time, filter}]. */
export function subjectFilterChanges(models) {
  const styled = (models ?? []).filter((model) => model?.subjectStyle);
  if (!styled.length) return [];
  const times = [...new Set(styled.flatMap((model) => [model.start, model.end]))].sort((a, b) => a - b);
  const changes = [];
  let previous = null;
  for (const time of times) {
    const filter = subjectFilterAt(styled, time);
    if (filter !== previous) changes.push({ time, filter });
    previous = filter;
  }
  return changes;
}

/** Problems with a model's subject fields, as messages (empty when valid). */
export function subjectModelErrors(model) {
  const errors = [];
  if (model?.subjectCamera !== undefined) {
    const samples = model.subjectCamera?.samples;
    if (!Array.isArray(samples) || !samples.every((s) => [s?.t, s?.scale, s?.x, s?.y].every((value) => typeof value === "number" && Number.isFinite(value)) && s.scale > 0)) errors.push("subjectCamera.samples must be [{t, scale, x, y}] numbers with scale > 0");
  }
  if (model?.room !== undefined) {
    const room = model.room;
    if (room === null || typeof room !== "object" || Object.keys(room).some((key) => !["hide", "dim", "blur"].includes(key))) errors.push("room must be {hide?, dim?, blur?}");
    else {
      if (room.hide !== undefined && typeof room.hide !== "boolean") errors.push("room.hide must be true or false");
      if (room.dim !== undefined && !(typeof room.dim === "number" && room.dim >= 0 && room.dim <= 1)) errors.push("room.dim must be between 0 and 1");
      if (room.blur !== undefined && !(typeof room.blur === "number" && room.blur >= 0 && room.blur <= 40)) errors.push("room.blur must be between 0 and 40 px");
    }
  }
  if (model?.subjectStyle !== undefined) {
    const style = model.subjectStyle;
    if (style === null || typeof style !== "object" || Object.keys(style).some((key) => !["outline", "color", "shadow"].includes(key))) errors.push("subjectStyle must be {outline?, color?, shadow?}");
    else {
      if (style.outline !== undefined && !(typeof style.outline === "number" && style.outline >= 0 && style.outline <= 24)) errors.push("subjectStyle.outline must be between 0 and 24 px");
      if (style.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(style.color))) errors.push("subjectStyle.color must be a #rrggbb colour");
      if (style.shadow !== undefined && typeof style.shadow !== "boolean") errors.push("subjectStyle.shadow must be true or false");
    }
  }
  if (model?.parts !== undefined && (model.parts === null || typeof model.parts !== "object" || !model.parts.behind || !model.parts.front)) errors.push("parts must be {behind, front}");
  return errors;
}

/**
 * What a module knows about the presenter at timeline t (resolveModule's
 * ctx.subject), or null when the story has no base or the subject is off.
 * → {available, framing, head, body, headroom, plate, placement}
 *   available  a matte covers t (the subject layer can be mounted)
 *   head, body canvas rects (px) from the covering matte's summary, else null
 *   plate      {src, fit, focus}: the range's room plate, drawn like the base
 *   placement  "measured" with a summary head, else "default"
 *   outlineAt  (t) => the traced silhouette at timeline t: canvas points
 *              [[x, y] px | null] (null where it meets the frame edge), or
 *              null without an outline. It ignores camera moves.
 */
export function subjectContext(story, t) {
  const base = storyBase(story);
  if (!base || base.subject.mode === "off") return null;
  const canvas = { width: Number(story.format?.width), height: Number(story.format?.height) };
  const source = sourceTimeAt(base, t);
  const matte = source === null ? null : base.subject.mattes.find((entry) => source >= entry.in - EPS && source <= entry.out + EPS) ?? null;
  const summary = matte?.summary;
  const toCanvas = (box) => (box && summary?.source ? sourceBoxToCanvas(box, base, summary.source, canvas) : null);
  const head = toCanvas(summary?.head);
  return {
    available: Boolean(matte),
    framing: summary?.framing ?? null,
    head,
    body: toCanvas(summary?.body),
    headroom: summary?.headroom ?? null,
    plate: matte?.plate ? { src: matte.plate, fit: base.fit, focus: { ...base.focus } } : null,
    placement: head ? "measured" : "default",
    outlineAt: (at) => subjectOutlineAt(story, at)
  };
}

/** The covering matte's nearest outline frame at timeline t, on the canvas. */
export function subjectOutlineAt(story, t) {
  const base = storyBase(story);
  if (!base || base.subject.mode === "off") return null;
  const source = sourceTimeAt(base, t);
  const matte = source === null ? null : base.subject.mattes.find((entry) => source >= entry.in - EPS && source <= entry.out + EPS) ?? null;
  const frames = matte?.outline?.frames;
  const size = matte?.summary?.source;
  if (!Array.isArray(frames) || !frames.length || !size) return null;
  let nearest = frames[0];
  for (const frame of frames) if (Math.abs(frame.t - source) < Math.abs(nearest.t - source)) nearest = frame;
  if (!Array.isArray(nearest.points)) return null;
  const canvas = { width: Number(story.format?.width), height: Number(story.format?.height) };
  return nearest.points.map((point) => {
    if (!point) return null;
    const box = sourceBoxToCanvas({ x: point[0], y: point[1], w: 0, h: 0 }, base, size, canvas);
    return [box.x, box.y];
  });
}

// ---------------------------------------------------------------------------
// The subject on the canvas (layout-check's face rule)

/** Source seconds shown at timeline t, or null between segments. */
export function sourceTimeAt(base, t) {
  const segment = base?.segments?.find((entry) => t >= entry.start - EPS && t < entry.end - EPS);
  return segment ? segment.sourceStart + (t - segment.start) : null;
}

/**
 * A source-frame box (fractions, centre x/y) as a canvas rect in px, through
 * the base's object-fit and object-position.
 * source: {width, height} of the recording; canvas: {width, height}.
 */
export function sourceBoxToCanvas(box, base, source, canvas) {
  const scale = base.fit === "contain" ? Math.min(canvas.width / source.width, canvas.height / source.height) : Math.max(canvas.width / source.width, canvas.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  const left = (canvas.width - width) * base.focus.x;
  const top = (canvas.height - height) * base.focus.y;
  return { x: round6(left + (box.x - box.w / 2) * width), y: round6(top + (box.y - box.h / 2) * height), width: round6(box.w * width), height: round6(box.h * height) };
}

/**
 * → (t) => head rect on the canvas at timeline t, or null. infos: the
 * mattes' subject.json objects, in base.subject.mattes order (null entries
 * are skipped).
 */
export function headLocator(story, infos) {
  const locate = subjectLocator(story, infos);
  return (t) => locate(t)?.head ?? null;
}

/**
 * → (t) => {head, body} canvas rects (either may be null) at timeline t, or
 * null where no matte covers it. Same mapping as headLocator.
 */
export function subjectLocator(story, infos) {
  const base = storyBase(story);
  if (!base) return () => null;
  const canvas = { width: Number(story.format.width), height: Number(story.format.height) };
  return (t) => {
    const source = sourceTimeAt(base, t);
    if (source === null) return null;
    const info = (infos ?? []).find((entry) => entry && source >= entry.range.in - EPS && source <= entry.range.out + EPS);
    const frame = info ? subjectAt(info, source) : null;
    if (!frame) return null;
    const map = (box) => (box ? sourceBoxToCanvas(box, base, info.source, canvas) : null);
    return { head: map(frame.head), body: map(frame.body) };
  };
}

/**
 * Behind-layer text must stay readable (RFC §9): at each of an element's
 * `times`, every key glyph keeps at least `minVisible` of its area clear of
 * the presenter. texts: [{id, module, glyphs: [{index, char, x, y, width,
 * height}], times: [t], hint?}]; subjectAt(t) → {head, body} | null.
 * → [{rule: "subject-text", severity: "error", ids, at, detail}], one per
 * element (its worst glyph).
 */
export function checkBehindText({ texts = [], subjectAt: locate, minVisible = 0.6 } = {}) {
  const findings = [];
  for (const text of texts) {
    let worst = null;
    for (const t of text.times ?? []) {
      const boxes = locate(t);
      if (!boxes) continue;
      for (const glyph of text.glyphs ?? []) {
        const visible = 1 - subjectCoverShare(glyph, boxes);
        if (visible < minVisible - EPS && (!worst || visible < worst.visible)) worst = { glyph, visible, t };
      }
    }
    if (!worst) continue;
    const word = (text.glyphs ?? []).map((glyph) => glyph.char).join("");
    findings.push({ rule: "subject-text", severity: "error", ids: [text.id], at: round6(worst.t),
      detail: `${text.id} (${text.module}): the presenter covers ${Math.round((1 - worst.visible) * 100)}% of "${worst.glyph.char}" in "${word}" at ${round6(worst.t)} s; behind-layer letters need ${Math.round(minVisible * 100)}% of each glyph visible.${text.hint ? ` ${text.hint}` : ""}` });
  }
  return findings;
}

/**
 * The face rule: a front-layer element may not cover the presenter's head for
 * more than maxSeconds in a row. elements: [{id, rect, start, end, layer?,
 * framesFace?}]; behind-layer elements and ones that frame the face are
 * exempt. Covering means at least `minShare` of the head box is under the
 * element. → [{rule: "subject-face", severity: "error", ids, at, detail}]
 */
export function checkSubjectFace({ elements = [], headAt, step = 1 / 30, maxSeconds = 0.3, minShare = 0.25 } = {}) {
  const findings = [];
  for (const element of elements) {
    if (element.layer === "behind" || element.framesFace) continue;
    let runStart = null;
    let worst = 0;
    const close = (t) => {
      if (runStart !== null && t - runStart > maxSeconds + EPS) {
        findings.push({ rule: "subject-face", severity: "error", ids: [element.id], at: round6(runStart), detail: `${element.id} covers the presenter's face for ${round6(t - runStart)} s from ${round6(runStart)} s (up to ${Math.round(worst * 100)}% of the head; at most ${maxSeconds} s allowed). Move it off the face, or set layer "behind"` });
      }
      runStart = null;
      worst = 0;
    };
    for (let t = element.start; t < element.end - EPS; t += step) {
      const head = headAt(t);
      const share = head ? overlapShare(element.rect, head) : 0;
      if (share >= minShare) {
        if (runStart === null) runStart = t;
        worst = Math.max(worst, share);
      } else close(t);
    }
    close(element.end);
  }
  return findings;
}

function overlapShare(rect, head) {
  const x = Math.max(0, Math.min(rect.x + rect.width, head.x + head.width) - Math.max(rect.x, head.x));
  const y = Math.max(0, Math.min(rect.y + rect.height, head.y + head.height) - Math.max(rect.y, head.y));
  const area = head.width * head.height;
  return area > 0 ? (x * y) / area : 0;
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
