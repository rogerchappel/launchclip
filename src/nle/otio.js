// OpenTimelineIO JSON (.otio) writer for the NLE timeline model.
//
// One Stack of Tracks (video bottom to top, then audio), Clip.2 items with
// ExternalReference media (relative target_url) or, for --overlays png,
// ImageSequenceReference; Gap.1 fills the space between clips; markers sit on
// the Stack. Captions have no OTIO track kind, so they ride in the timeline
// metadata (launchclip.captions) next to the captions.srt sidecar. OTIO rates
// are floats: 29.97 is 30000/1001 = 29.97002997…
import { framesToSeconds } from "./time.js";

export function writeOtio(timeline, options = {}) {
  const rate = timeline.rate.fps;
  const rt = (value) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
  const range = (start, duration) => ({ OTIO_SCHEMA: "TimeRange.1", duration: rt(duration), start_time: rt(start) });
  const assets = new Map(timeline.assets.map((asset) => [asset.id, asset]));
  const reference = (asset) => {
    if (asset.kind === "image-sequence") {
      return {
        OTIO_SCHEMA: "ImageSequenceReference.1",
        metadata: {},
        name: asset.name,
        available_range: range(0, asset.duration),
        available_image_bounds: null,
        target_url_base: `${url(asset.path, options.absolute)}/`,
        name_prefix: asset.pattern?.prefix ?? "frame-",
        name_suffix: asset.pattern?.suffix ?? ".png",
        start_frame: asset.pattern?.start ?? 0,
        frame_step: 1,
        rate,
        frame_zero_padding: asset.pattern?.padding ?? 5,
        missing_frame_policy: "error"
      };
    }
    return { OTIO_SCHEMA: "ExternalReference.1", metadata: {}, name: asset.name, available_range: range(0, asset.duration), available_image_bounds: null, target_url: url(asset.path, options.absolute) };
  };
  const item = (clip, track) => {
    const asset = assets.get(clip.asset);
    const metadata = { launchclip: compact({ kind: clip.kind, scene: clip.sceneId, module: clip.module, part: clip.part, cue: clip.cue, volume: clip.volume, alpha: clip.alpha, role: track.role, linked: clip.linked ? true : undefined }) };
    return {
      OTIO_SCHEMA: "Clip.2",
      metadata,
      name: clip.name,
      source_range: range(clip.in, clip.duration),
      effects: [],
      markers: [],
      enabled: clip.enabled !== false,
      media_references: { DEFAULT_MEDIA: reference(asset) },
      active_media_reference_key: "DEFAULT_MEDIA"
    };
  };
  const gap = (duration) => ({ OTIO_SCHEMA: "Gap.1", metadata: {}, name: "", source_range: range(0, duration), effects: [], markers: [], enabled: true });
  const trackJson = (track) => {
    const children = [];
    let cursor = 0;
    for (const clip of [...track.clips].sort((a, b) => a.start - b.start)) {
      if (clip.start > cursor) children.push(gap(clip.start - cursor));
      children.push(item(clip, track));
      cursor = clip.start + clip.duration;
    }
    return { OTIO_SCHEMA: "Track.1", metadata: { launchclip: compact({ id: track.id, role: track.role, layer: track.layer }) }, name: `${track.id} ${track.name}`, source_range: null, effects: [], markers: [], enabled: track.enabled !== false, children, kind: track.kind === "audio" ? "Audio" : "Video" };
  };
  const colors = { chapter: "GREEN", scene: "BLUE", hit: "YELLOW", camera: "PURPLE" };
  const doc = {
    OTIO_SCHEMA: "Timeline.1",
    metadata: {
      launchclip: {
        schema: timeline.schema,
        lane: timeline.lane,
        width: timeline.width,
        height: timeline.height,
        rate: { num: timeline.rate.num, den: timeline.rate.den, drop_frame: timeline.rate.dropFrame },
        overlays: timeline.overlays,
        captions: (timeline.captions?.clips ?? []).map((clip) => ({ start: round6(framesToSeconds(clip.start, timeline.rate)), end: round6(framesToSeconds(clip.start + clip.duration, timeline.rate)), start_frame: clip.start, duration_frames: clip.duration, text: clip.text }))
      }
    },
    name: timeline.name,
    global_start_time: rt(0),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      metadata: {},
      name: "tracks",
      source_range: null,
      effects: [],
      markers: timeline.markers.map((marker) => ({ OTIO_SCHEMA: "Marker.2", metadata: { launchclip: compact({ kind: marker.kind, scene: marker.sceneId, chapter: marker.chapterId }) }, name: marker.name, color: colors[marker.kind] ?? "RED", marked_range: range(marker.frame, 0), comment: marker.note ?? "" })),
      enabled: true,
      children: [...timeline.tracks.filter((track) => track.kind === "video"), ...timeline.tracks.filter((track) => track.kind === "audio")].map(trackJson)
    }
  };
  return { otio: `${JSON.stringify(doc, null, 2)}\n`, warnings: [] };
}

/** Read an .otio written above → {rate, tracks: [{name, kind, enabled, clips: [{name, start, duration, in, url}]}], markers}. */
export function readOtio(text) {
  const doc = JSON.parse(text);
  if (doc.OTIO_SCHEMA !== "Timeline.1") throw new Error(`not an OTIO timeline: ${doc.OTIO_SCHEMA}`);
  const tracks = doc.tracks.children.map((track) => {
    let cursor = 0;
    const clips = [];
    for (const child of track.children) {
      const duration = child.source_range.duration.value;
      if (child.OTIO_SCHEMA === "Clip.2") {
        const ref = child.media_references[child.active_media_reference_key];
        clips.push({ name: child.name, start: cursor, duration, in: child.source_range.start_time.value, url: ref.target_url ?? ref.target_url_base, enabled: child.enabled });
      }
      cursor += duration;
    }
    return { name: track.name, kind: track.kind, enabled: track.enabled, clips };
  });
  return { rate: doc.global_start_time.rate, tracks, markers: doc.tracks.markers.map((marker) => ({ name: marker.name, frame: marker.marked_range.start_time.value })) };
}

function url(relativePath, absoluteRoot) {
  const encoded = String(relativePath).split("/").map(encodeURIComponent).join("/");
  if (!absoluteRoot) return encoded;
  return `file://${String(absoluteRoot).replace(/\/+$/, "").split("/").map(encodeURIComponent).join("/")}/${encoded}`;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
