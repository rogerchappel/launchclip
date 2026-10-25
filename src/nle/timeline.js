// NLE timeline model: a finished LaunchClip project as editor tracks.
//
// One renderer-neutral model that every writer (fcpxml.js, xmeml.js, edl.js,
// otio.js) reads, so all formats agree frame for frame. All times are integer
// frames on one exact rate (src/nle/time.js); seconds are derived.
//
//   V1      the base: footage-led trim segments (each a clip on the original
//           recording with its in point) or, in motion lanes, a solid plate in
//           brand.colors.bg
//   V2…     overlay clips with alpha, one per scene, packed into lanes per
//           story track (track 0 first, on its brand plate as rendered); a
//           scene that transitions in sits above the scene it overlaps, as in
//           the render, so a run of transitions climbs one lane per boundary.
//           With the subject layer (kit/core/subject-layer.mjs) they split
//           round a subject track, as the render stacks them: behind scenes
//           and split behind parts, then the presenter cut-out (matte clips
//           where the base shows their source ranges), then every other
//           scene and split front parts
//   top     the finished render: a disabled reference track, or the one
//           enabled picture clip with --overlays none
//   A1      the voice (narration, or the recording's own audio, linked to V1)
//   A2      the music bed
//   A3…     every SFX cue as its own clip at its time, then the typing
//           track (one timeline-length file) when finish rendered one
//   last    the reference mix (disabled), or the only audio when the project
//           supplies a premixed track and no stems
//   ST1     captions, one subtitle per caption chunk
//   markers chapter starts (long form), scene starts, hits and camera moves
//
// buildTimeline() is pure: the export command (export.js) probes media and
// renders overlays, then passes their descriptions in `media`.
import { resolveModule } from "../../kit/core/modules.mjs";
import { storyBase, storyChapters, storyHits } from "../../kit/core/story.mjs";
import { needsSubject, sceneLayerOf, subjectSegments, subjectWindows } from "../../kit/core/subject-layer.mjs";
import { sceneWindows } from "../../kit/core/transitions.mjs";
import { framesToSeconds, framesToTimecode, parseRate, secondsToFrames } from "./time.js";

export const TIMELINE_SCHEMA = "launchclip.nle-timeline.v1";
export const OVERLAY_MODES = ["prores4444", "png", "none"];
export const AUDIO_ROLES = ["dialogue", "music", "effects"];

/**
 * The scenes `launchclip export` renders as separate alpha clips, from a
 * resolved story: every scene except footage-led cameras (punch-in moves the
 * base and is exported as markers), over its render window (an outgoing track-0
 * scene stays until the incoming transition settles), plus the loop ending.
 * Track-0 scenes (and the loop) keep their brand.colors.bg plate, exactly as in
 * the render: during a fade or zoom the incoming plate covers the outgoing
 * scene, so a transparent track-0 clip would composite differently. Their
 * alpha still carries the transition (a push or fade reveals what is below).
 * → {clips: [{key, sceneId, module, track, start, end, plate, loop}], cameras: [{sceneId, module, start, end, camera}]}
 *
 * With the subject layer (kit/core/subject-layer.mjs), a behind scene's clip
 * carries layer "behind", and a split scene becomes two clips, `<id>-behind`
 * (layer "behind", part "behind") and `<id>-front` (part "front"). The plan
 * then also holds subject: {windows, scenes: [{sceneId, module, layer, start,
 * end, animated, reason?}]}: the windows the presenter cut-out is shown in,
 * and per layered scene the subject fields a static NLE stack cannot carry.
 * Stories without such scenes get no subject key and unchanged clips.
 */
export function overlayPlan(story, { models } = {}) {
  const modelFor = typeof models === "function" ? models : (scene) => {
    if (models && Object.hasOwn(models, scene.id)) return models[scene.id];
    try { return resolveModule(scene, story); } catch { return null; }
  };
  const windows = sceneWindows(story);
  const clips = [];
  const cameras = [];
  const layered = [];
  for (const entry of windows.scenes) {
    const scene = entry.scene;
    const model = modelFor(scene);
    const { layer, reason } = sceneLayerOf(scene, model);
    if (needsSubject(scene, model) || reason) layered.push({ scene, model, start: entry.start, end: entry.renderEnd, layer, reason });
    if (model?.camera) {
      cameras.push({ sceneId: scene.id, module: scene.module, start: entry.start, end: entry.end, camera: model.camera });
      continue;
    }
    const clip = { key: scene.id, sceneId: scene.id, module: scene.module, track: entry.track, start: entry.start, end: entry.renderEnd, plate: entry.track === 0, loop: false, hidesCaptions: Boolean(model?.hidesCaptions) };
    // A split scene renders twice: its behind part under the subject, its front part above it.
    if (layer === "split") clips.push({ ...clip, key: `${scene.id}-behind`, layer: "behind", part: "behind" }, { ...clip, key: `${scene.id}-front`, part: "front" });
    else clips.push(layer === "behind" ? { ...clip, layer } : clip);
  }
  if (windows.loop) {
    clips.push({ key: `${windows.loop.sceneId}-loop`, sceneId: windows.loop.sceneId, module: windows.loop.scene.module, track: 0, start: windows.loop.start, end: windows.loop.end, plate: true, loop: true, hidesCaptions: false });
  }
  if (!layered.length) return { clips, cameras };
  return {
    clips,
    cameras,
    subject: {
      windows: subjectWindows(layered),
      scenes: layered.map(({ scene, model, start, end, layer, reason }) => ({
        sceneId: scene.id, module: scene.module, layer, start, end,
        // What a static NLE stack cannot carry: these need keyframes or effects.
        animated: SUBJECT_ANIMATION.filter((field) => model?.[field]),
        ...(reason ? { reason } : {})
      }))
    }
  };
}

const SUBJECT_ANIMATION = ["subjectCamera", "room", "subjectStyle"];
const SUBJECT_ANIMATION_NOTES = {
  subjectCamera: "moves the presenter on its own (subjectCamera)",
  room: "hides, dims or blurs the room (room)",
  subjectStyle: "outlines or shadows the presenter (subjectStyle)"
};

/**
 * Build the timeline model.
 * story: a resolved story. media (all optional; `source` is an absolute path,
 * durations are seconds):
 *   base:     {source, duration, hasAudio, audioChannels, width, height}
 *   plate:    {source, duration, color}
 *   voice:    {source, duration, audioChannels}
 *   music:    {source, duration, volume, ducked}
 *   mix:      {source, duration}
 *   sfx:      [{id, cue, source, at, volume, duration, shot}]
 *   typing:   {source, duration, keystrokes}  (the timeline-length typing track)
 *   captions: [{start, end, text}]
 *   render:   {source, duration, width, height}
 *   overlays: {[key]: {source, kind: "mov"|"png-sequence", frames, pattern, firstFrame}}
 *   subject:  {mattes: {[matte src]: {source, kind, frames, width, height, pattern, firstFrame}}}
 *             (alpha copies of base.subject.mattes an NLE can read)
 * options: {name, rate (default story fps), overlays: prores4444|png|none, models, plan}
 */
export function buildTimeline(story, media = {}, options = {}) {
  if (!story?.resolved || !Array.isArray(story.scenes)) throw new Error("buildTimeline needs a resolved story (run resolveStory first)");
  const rate = options.rate ? (typeof options.rate === "object" && "timebase" in options.rate ? options.rate : parseRate(options.rate)) : parseRate(story.resolved.fps ?? story.format.fps);
  const mode = options.overlays ?? "prores4444";
  if (!OVERLAY_MODES.includes(mode)) throw new Error(`--overlays must be one of ${OVERLAY_MODES.join(", ")}; got ${mode}`);
  const f = (seconds) => secondsToFrames(seconds, rate);
  const floorFrames = (seconds) => Math.floor(Number(seconds) * rate.num / rate.den + 1e-6);
  const duration = f(story.resolved.duration);
  const width = story.format.width, height = story.format.height;
  const warnings = [];
  const assets = [];
  const tracks = [];
  const usedNames = new Set();

  const addAsset = (fields) => {
    const existing = assets.find((asset) => asset.source === fields.source && asset.kind === fields.kind);
    if (existing) return existing;
    const asset = { id: `a${assets.length + 1}`, ...fields };
    asset.path = uniquePath(fields.path, usedNames);
    assets.push(asset);
    return asset;
  };
  const addTrack = (track) => { tracks.push({ enabled: true, clips: [], ...track }); return tracks.at(-1); };
  let clipCount = 0;
  const clip = (fields) => ({ id: `c${++clipCount}`, enabled: true, in: 0, ...fields });

  // ---- V1: base or plate
  const base = story.lane === "footage-led" ? storyBase(story) : null;
  const v1 = addTrack({ id: "V1", kind: "video", name: base ? "Base footage" : "Plate", role: "video" });
  let baseAsset = null;
  if (base && media.base?.source) {
    baseAsset = addAsset({
      kind: "video", name: baseName(base.src), path: `media/${baseName(base.src)}`, source: media.base.source,
      duration: floorFrames(media.base.duration), hasVideo: true, hasAudio: media.base.hasAudio !== false,
      audioChannels: media.base.audioChannels ?? 2, audioRate: media.base.audioRate ?? 48000,
      width: media.base.width ?? width, height: media.base.height ?? height, alpha: false, role: "base"
    });
    for (const segment of base.segments) {
      const start = f(segment.start);
      const end = Math.min(duration, f(segment.end));
      if (end <= start) continue;
      v1.clips.push(clip({ name: `${baseStem(base.src)} ${segment.index + 1}`, asset: baseAsset.id, start, duration: end - start, in: f(segment.sourceStart), kind: "base", volume: base.volume }));
    }
    if (media.base.width && media.base.height && Math.abs(media.base.width / media.base.height - width / height) > 0.01) {
      warnings.push(`the recording is ${media.base.width}x${media.base.height} in a ${width}x${height} timeline; base.fit "${base.fit}" and base.focus are not carried, so set the clip's spatial conform in the editor`);
    }
    if (base.crop) warnings.push(`base.crop (${["left", "right", "top", "bottom"].filter((side) => base.crop[side] > 0).map((side) => `${side} ${Math.round(base.crop[side] * 1000) / 10}%`).join(", ")}) is not carried; crop the clip in the editor`);
  } else if (base) {
    warnings.push(`base recording ${base.src} was not found; V1 is empty`);
  } else if (media.plate?.source) {
    const plate = addAsset({ kind: "video", name: "plate", path: "media/plate.mp4", source: media.plate.source, duration: floorFrames(media.plate.duration), hasVideo: true, hasAudio: false, width, height, alpha: false, role: "plate" });
    v1.clips.push(clip({ name: `Plate ${media.plate.color ?? ""}`.trim(), asset: plate.id, start: 0, duration: Math.min(duration, plate.duration), kind: "plate" }));
  }

  // ---- V2…: overlays
  const plan = options.plan ?? overlayPlan(story, { models: options.models });
  const videoId = () => `V${tracks.filter((t) => t.kind === "video").length + 1}`;
  const overlayTracks = (group, labelFor) => {
    const byTrack = new Map();
    for (const entry of group) {
      if (!byTrack.has(entry.track)) byTrack.set(entry.track, []);
      byTrack.get(entry.track).push(entry);
    }
    for (const storyTrack of [...byTrack.keys()].sort((a, b) => a - b)) {
      const entries = byTrack.get(storyTrack).map((entry) => ({ entry, start: f(entry.start), end: Math.min(duration, f(entry.end)) })).filter((item) => item.end > item.start);
      const lanes = packLanes(entries, { stack: true });
      const label = labelFor(storyTrack);
      lanes.forEach((lane, index) => {
        const track = addTrack({ id: videoId(), kind: "video", name: lanes.length > 1 ? `${label} ${index + 1}` : label, role: "video", storyTrack, ...(entries[0].entry.layer ? { layer: entries[0].entry.layer } : {}) });
        for (const { entry, start, end } of lane) {
          const rendered = media.overlays?.[entry.key];
          if (!rendered?.source) { warnings.push(`overlay ${entry.key} has no render; it is missing from ${track.id}`); continue; }
          const sequence = rendered.kind === "png-sequence";
          const asset = addAsset({
            kind: sequence ? "image-sequence" : "video", name: entry.key,
            path: sequence ? `media/overlays/${entry.key}` : `media/overlays/${entry.key}.mov`,
            source: rendered.source, duration: rendered.frames ?? end - start, hasVideo: true, hasAudio: false, width, height,
            alpha: true, role: "overlay", pattern: rendered.pattern, firstFrame: rendered.firstFrame
          });
          const name = entry.loop ? `${entry.sceneId} (loop)` : `${entry.sceneId} · ${entry.module}${entry.part ? ` (${entry.part})` : ""}`;
          track.clips.push(clip({ name, asset: asset.id, start, duration: Math.min(end - start, asset.duration), kind: "overlay", sceneId: entry.sceneId, module: entry.module, alpha: true, plate: entry.plate, ...(entry.part ? { part: entry.part } : {}) }));
        }
      });
    }
  };
  if (mode !== "none") {
    // With the subject layer the stack is the render's: behind scenes and
    // split behind parts, the presenter cut-out, then everything in front.
    const behind = plan.clips.filter((entry) => entry.layer === "behind");
    overlayTracks(behind, (storyTrack) => `Behind subject ${storyTrack}`);
    if (plan.subject) subjectTrack();
    overlayTracks(plan.clips.filter((entry) => entry.layer !== "behind"), (storyTrack) => (storyTrack === 0 ? (base ? "Inserts" : "Scenes") : `Overlays ${storyTrack}`));
  }
  if (plan.subject) subjectWarnings();

  // The presenter cut-out: one clip per base segment ∩ matte range ∩ subject
  // window, on the matte's export copy, with the base's in point mapped into
  // the matte file (its frame 0 is the matte's `in`).
  function subjectTrack() {
    const segments = base && baseAsset ? subjectSegments(story, plan.subject.windows) : [];
    if (!segments.length) {
      if (plan.subject.windows.length) warnings.push(base?.subject?.mode === "mattes" ? "no subject matte covers the layered scenes; behind overlays sit straight on the base, with no presenter cut-out above them" : "the story has no subject mattes (run launchclip subject matte); behind overlays sit straight on the base, with no presenter cut-out above them");
      return;
    }
    const track = addTrack({ id: videoId(), kind: "video", name: "Subject (presenter cut-out)", role: "video", layer: "subject" });
    for (const segment of segments) {
      const matte = media.subject?.mattes?.[segment.src];
      if (!matte?.source) { warnings.push(`subject matte ${segment.src} has no export copy; ${track.id} misses ${round3(segment.start)}–${round3(segment.end)}s`); continue; }
      const sequence = matte.kind === "png-sequence";
      const stem = baseStem(segment.src);
      const asset = addAsset({
        kind: sequence ? "image-sequence" : "video", name: `subject ${stem}`,
        path: sequence ? `media/subject/${stem}` : `media/subject/${stem}.mov`,
        source: matte.source, duration: matte.frames, hasVideo: true, hasAudio: false,
        width: matte.width ?? baseAsset.width, height: matte.height ?? baseAsset.height,
        alpha: true, role: "subject", pattern: matte.pattern, firstFrame: matte.firstFrame
      });
      const start = f(segment.start);
      const offset = f(segment.mediaStart);
      const length = Math.min(Math.min(duration, f(segment.end)) - start, asset.duration - offset);
      if (length <= 0) continue;
      track.clips.push(clip({ name: `subject ${segment.index + 1}`, asset: asset.id, start, duration: length, in: offset, kind: "subject", alpha: true }));
    }
  }

  function subjectWarnings() {
    for (const scene of plan.subject.scenes) {
      if (scene.reason) warnings.push(`scene ${scene.sceneId}: ${scene.reason}`);
      if (!scene.animated.length || mode === "none") continue;
      const what = scene.animated.map((field) => SUBJECT_ANIMATION_NOTES[field]).join(", ");
      warnings.push(`scene ${scene.sceneId} (${scene.module}) ${what}; the export keeps its static layering only (${round3(scene.start)}–${round3(scene.end)}s), so re-create it in the editor or use the finished render`);
    }
  }

  // ---- reference render
  if (media.render?.source) {
    const asset = addAsset({ kind: "video", name: "render", path: `media/reference/${baseName(media.render.source)}`, source: media.render.source, duration: floorFrames(media.render.duration), hasVideo: true, hasAudio: media.render.hasAudio !== false, audioChannels: 2, audioRate: 48000, width: media.render.width ?? width, height: media.render.height ?? height, alpha: false, role: "reference" });
    const track = addTrack({ id: `V${tracks.filter((t) => t.kind === "video").length + 1}`, kind: "video", name: mode === "none" ? "Finished render" : "Finished render (reference)", role: "video", enabled: mode === "none" });
    track.clips.push(clip({ name: "finished render", asset: asset.id, start: 0, duration: Math.min(duration, asset.duration), kind: "render", videoOnly: true }));
  } else if (mode === "none") {
    warnings.push("--overlays none needs the finished render (run launchclip finish first); the timeline has no picture above V1");
  }

  // ---- audio
  const audioTrack = (name, role, extra = {}) => addTrack({ id: `A${tracks.filter((t) => t.kind === "audio").length + 1}`, kind: "audio", name, role, ...extra });
  let stems = false;
  if (baseAsset && baseAsset.hasAudio) {
    const a1 = audioTrack("Dialogue (recording)", "dialogue");
    for (const video of v1.clips) a1.clips.push(clip({ name: video.name, asset: baseAsset.id, start: video.start, duration: video.duration, in: video.in, kind: "base-audio", volume: video.volume, linked: video.id }));
    stems = true;
  } else if (media.voice?.source) {
    const asset = addAsset({ kind: "audio", name: "voice", path: `media/audio/${baseName(media.voice.source)}`, source: media.voice.source, duration: floorFrames(media.voice.duration), hasVideo: false, hasAudio: true, audioChannels: media.voice.audioChannels ?? 1, audioRate: media.voice.audioRate ?? 48000, role: "voice" });
    audioTrack("Voice", "dialogue").clips.push(clip({ name: "voice", asset: asset.id, start: 0, duration: Math.min(duration, asset.duration), kind: "voice" }));
    stems = true;
  }
  if (media.music?.source) {
    const asset = addAsset({ kind: "audio", name: "music", path: `media/audio/music-${baseName(media.music.source)}`, source: media.music.source, duration: floorFrames(media.music.duration), hasVideo: false, hasAudio: true, audioChannels: media.music.audioChannels ?? 2, audioRate: media.music.audioRate ?? 48000, role: "music" });
    audioTrack("Music", "music").clips.push(clip({ name: "music bed", asset: asset.id, start: 0, duration: Math.min(duration, asset.duration), kind: "music", volume: media.music.volume ?? 1 }));
    stems = true;
    if (media.music.ducked) warnings.push("the finished mix ducks the music under the voice; the music clip here is at its bed level without ducking (use the editor's ducking or keyframe the level)");
  }
  const cues = (media.sfx ?? []).filter((cue) => cue?.source).map((cue) => {
    const start = f(cue.at);
    const length = Math.min(floorFrames(cue.duration ?? 1), duration - start);
    return { cue, start, end: start + length };
  }).filter((item) => item.end > item.start);
  if (cues.length) {
    const lanes = packLanes(cues);
    lanes.forEach((lane, index) => {
      const track = audioTrack(lanes.length > 1 ? `SFX ${index + 1}` : "SFX", "effects");
      for (const { cue, start, end } of lane) {
        const asset = addAsset({ kind: "audio", name: cue.cue, path: `media/sfx/${baseName(cue.source)}`, source: cue.source, duration: floorFrames(cue.duration ?? 1), hasVideo: false, hasAudio: true, audioChannels: cue.audioChannels ?? 2, audioRate: cue.audioRate ?? 48000, role: "sfx" });
        track.clips.push(clip({ name: cue.id ?? cue.cue, asset: asset.id, start, duration: end - start, kind: "sfx", volume: cue.volume ?? 1, sceneId: cue.shot ?? null, cue: cue.cue }));
      }
    });
    stems = true;
    const offGrid = cues.filter(({ cue, start }) => Math.abs(framesToSeconds(start, rate) - cue.at) > 1e-3).length;
    if (offGrid) warnings.push(`${offGrid} SFX cue${offGrid === 1 ? "" : "s"} snapped to the nearest frame (at most half a frame, ${Math.round(500 / rate.fps)} ms)`);
  }
  if (media.typing?.source) {
    // The typing track is rendered timeline-aligned from 0 s, so it is one clip at the start.
    const asset = addAsset({ kind: "audio", name: "typing", path: `media/audio/${baseName(media.typing.source)}`, source: media.typing.source, duration: floorFrames(media.typing.duration), hasVideo: false, hasAudio: true, audioChannels: media.typing.audioChannels ?? 2, audioRate: media.typing.audioRate ?? 48000, role: "sfx" });
    audioTrack("Typing", "effects").clips.push(clip({ name: media.typing.keystrokes ? `typing (${media.typing.keystrokes} keys)` : "typing", asset: asset.id, start: 0, duration: Math.min(duration, asset.duration), kind: "typing" }));
    stems = true;
  }
  if (media.mix?.source) {
    const asset = addAsset({ kind: "audio", name: "mix", path: `media/audio/${baseName(media.mix.source)}`, source: media.mix.source, duration: floorFrames(media.mix.duration), hasVideo: false, hasAudio: true, audioChannels: media.mix.audioChannels ?? 2, audioRate: media.mix.audioRate ?? 48000, role: "mix" });
    const track = audioTrack(stems ? "Mix (reference)" : "Mix", stems ? "music" : "dialogue", { enabled: !stems });
    track.clips.push(clip({ name: stems ? "finished mix (reference)" : "mix", asset: asset.id, start: 0, duration: Math.min(duration, asset.duration), kind: "mix" }));
    if (!stems) warnings.push("the project supplies a premixed audio.mix and no stems; A1 holds the whole mix");
  }

  // ---- captions
  const hide = [
    ...((story.overlays ?? []).find((overlay) => overlay?.type === "captions")?.hide ?? []),
    ...plan.clips.filter((entry) => entry.hidesCaptions).map((entry) => [entry.start, entry.end])
  ];
  const captionClips = [];
  for (const chunk of media.captions ?? []) {
    if (hide.some(([from, to]) => chunk.start >= from && chunk.start < to)) continue;
    const start = f(chunk.start);
    let end = Math.min(duration, f(chunk.end));
    const previous = captionClips.at(-1);
    if (previous && previous.start + previous.duration > start) previous.duration = Math.max(1, start - previous.start);
    if (end <= start) end = start + 1;
    const text = String(chunk.text ?? (chunk.words ?? []).map((word) => word.text).join(" ")).trim();
    if (text) captionClips.push(clip({ name: `caption ${captionClips.length + 1}`, start, duration: end - start, text, kind: "caption" }));
  }
  const captions = { id: "ST1", kind: "subtitle", name: "Captions", language: options.language ?? "en", clips: captionClips };

  // ---- markers
  const markers = [];
  for (const chapter of storyChapters(story)) markers.push({ frame: f(chapter.start), name: chapter.title, note: `chapter ${chapter.index + 1} · ${chapter.id}`, kind: "chapter", chapterId: chapter.id });
  for (const scene of story.scenes) markers.push({ frame: f(scene.start), name: scene.id, note: `scene ${scene.id} · ${scene.module}${(scene.track ?? 0) ? ` · track ${scene.track}` : ""}`, kind: "scene", sceneId: scene.id });
  for (const hit of storyHits(story)) markers.push({ frame: f(hit.at), name: `${hit.scene_id}: ${hit.event}`, note: hit.cue ? `hit · cue ${hit.cue}` : "hit", kind: "hit", sceneId: hit.scene_id });
  for (const camera of plan.cameras) {
    markers.push({ frame: f(camera.start), name: `${camera.sceneId}: camera`, note: `camera ${camera.module}${camera.camera?.scale ? ` ×${camera.camera.scale}` : ""}, ${round3(camera.start)}–${round3(camera.end)}s (not carried; re-create as a transform keyframe)`, kind: "camera", sceneId: camera.sceneId });
  }
  if (plan.cameras.length) warnings.push(`${plan.cameras.length} camera move${plan.cameras.length === 1 ? "" : "s"} (${[...new Set(plan.cameras.map((camera) => camera.module))].join(", ")}) on the base ${plan.cameras.length === 1 ? "is" : "are"} exported as markers, not transforms`);
  markers.sort((a, b) => a.frame - b.frame || kindOrder(a.kind) - kindOrder(b.kind));
  for (const marker of markers) marker.frame = Math.min(Math.max(0, marker.frame), Math.max(0, duration - 1));

  return {
    schema: TIMELINE_SCHEMA,
    name: options.name ?? story.title ?? "launchclip",
    lane: story.lane,
    width,
    height,
    rate,
    duration,
    overlays: mode,
    assets,
    tracks,
    captions,
    markers,
    warnings
  };
}

/**
 * Lane packing: items {start, end} → lanes (arrays) with no overlap inside a
 * lane. stack: a later item sits above every item it overlaps, as it does in
 * the renders (the incoming scene of a transition draws over the outgoing
 * one), so overlapping chains climb one lane per boundary.
 */
export function packLanes(items, { stack = false } = {}) {
  const lanes = [];
  for (const item of [...items].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const overlaps = (other) => other.start < item.end && item.start < other.end;
    const floor = stack ? lanes.reduce((top, lane, index) => (lane.some(overlaps) ? index + 1 : top), 0) : 0;
    let index = lanes.findIndex((lane, k) => k >= floor && !lane.some(overlaps));
    if (index < 0) { lanes.push([]); index = lanes.length - 1; }
    lanes[index].push(item);
  }
  return lanes;
}

/**
 * Structural checks of a timeline: integer frames, clips inside the timeline
 * and inside their asset, no overlaps on a track. → list of problems ([] = ok).
 */
export function checkTimeline(timeline) {
  const problems = [];
  const assets = new Map(timeline.assets.map((asset) => [asset.id, asset]));
  const all = [...timeline.tracks, timeline.captions];
  for (const track of all) {
    const clips = [...track.clips].sort((a, b) => a.start - b.start);
    clips.forEach((item, index) => {
      for (const key of ["start", "duration", "in"]) if (!Number.isInteger(item[key])) problems.push(`${track.id} ${item.id}: ${key} ${item[key]} is not a whole frame`);
      if (item.duration <= 0) problems.push(`${track.id} ${item.id}: duration must be positive`);
      if (item.start < 0 || item.start + item.duration > timeline.duration) problems.push(`${track.id} ${item.id}: [${item.start}, ${item.start + item.duration}) is outside the timeline [0, ${timeline.duration})`);
      if (index && clips[index - 1].start + clips[index - 1].duration > item.start) problems.push(`${track.id} ${item.id} overlaps ${clips[index - 1].id}`);
      if (item.asset) {
        const asset = assets.get(item.asset);
        if (!asset) problems.push(`${track.id} ${item.id}: unknown asset ${item.asset}`);
        else if (asset.duration && item.in + item.duration > asset.duration) problems.push(`${track.id} ${item.id}: source range [${item.in}, ${item.in + item.duration}) runs past ${asset.name} (${asset.duration} frames)`);
      }
    });
  }
  return problems;
}

/** Human summary of a timeline. */
export function timelineSummary(timeline) {
  const rate = timeline.rate;
  const tc = (frames) => framesToTimecode(frames, rate);
  const lines = [`${timeline.name}: ${timeline.width}x${timeline.height} @ ${rate.label} fps${rate.dropFrame ? " DF" : ""}, ${timeline.duration} frames (${tc(timeline.duration)}), overlays ${timeline.overlays}`];
  for (const track of [...timeline.tracks, timeline.captions]) {
    if (!track.clips.length) continue;
    const role = track.role ? ` [${track.role}]` : "";
    lines.push(`  ${track.id.padEnd(4)} ${track.name}${role}${track.enabled === false ? " (disabled)" : ""}: ${track.clips.length} clip${track.clips.length === 1 ? "" : "s"}`);
    for (const item of track.clips.slice(0, 12)) {
      const source = item.asset ? ` ← ${timeline.assets.find((asset) => asset.id === item.asset)?.path ?? item.asset} in ${tc(item.in)}` : item.text ? ` "${item.text}"` : "";
      lines.push(`         ${tc(item.start)}–${tc(item.start + item.duration)}  ${item.name}${source}`);
    }
    if (track.clips.length > 12) lines.push(`         … ${track.clips.length - 12} more`);
  }
  lines.push(`  markers: ${timeline.markers.length} (${countKinds(timeline.markers)})`);
  return `${lines.join("\n")}\n`;
}

function countKinds(markers) {
  const counts = {};
  for (const marker of markers) counts[marker.kind] = (counts[marker.kind] ?? 0) + 1;
  return Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(", ");
}

function kindOrder(kind) {
  return kind === "chapter" ? -1 : kind === "scene" ? 0 : kind === "camera" ? 1 : 2;
}

function baseName(file) {
  return String(file).split(/[\\/]/).pop();
}

function baseStem(file) {
  return baseName(file).replace(/\.[^.]+$/, "");
}

function uniquePath(wanted, used) {
  let candidate = wanted;
  let n = 2;
  while (used.has(candidate)) {
    candidate = wanted.replace(/(\.[^./]+)?$/, (ext) => `-${n}${ext}`);
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
