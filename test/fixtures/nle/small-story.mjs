// A small resolved story and media set for the NLE writer tests: a 6 s
// footage-led cut (two trim segments, a punch-in camera, two overlays, an
// insert), music, overlapping SFX, a reference mix, captions and a render.
import { resolveStory } from "../../../kit/core/story.mjs";

export function smallFootageStory() {
  return resolveStory({
    schema: "launchclip.story.v1",
    title: "Small footage cut",
    lane: "footage-led",
    format: { width: 1080, height: 1920, fps: 30, duration: 6 },
    brand: { colors: { bg: "#06070d", primary: "#fdb022" }, fonts: { display: "anton" } },
    base: { src: "assets/rec.mp4", trim: [[0, 2], [3, 7]] },
    scenes: [
      { id: "callout", module: "footage-callout", track: 1, start: 0.5, end: 2.5, hits: [{ at: 1.0, event: "point" }] },
      { id: "cam", module: "punch-in", track: 2, start: 1.0, end: 2.0 },
      { id: "insert", module: "count-up", insert: true, start: 3.0, end: 4.5, in: { type: "fade", dur: 0.3 }, hits: [{ at: 3.5, event: "hit", cue: "impact" }] },
      { id: "tail", module: "lower-third", track: 1, start: 4.0, end: 6.0 }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }]
  });
}

// Models stand in for resolveModule so the tests need no module params.
export const SMALL_MODELS = { callout: {}, cam: { camera: { scale: 1.1 } }, insert: {}, tail: {} };

export function smallMedia() {
  return {
    base: { source: "/project/assets/rec.mp4", duration: 8, hasAudio: true, audioChannels: 1, width: 720, height: 1280 },
    music: { source: "/project/assets/audio/kit/music/bed.wav", duration: 6.2, volume: 0.28, ducked: false },
    sfx: [
      { id: "sfx-01-whoosh", cue: "whoosh", source: "/project/assets/audio/kit/sfx/whoosh.wav", at: 0.9, volume: 0.4, duration: 0.62, shot: "callout" },
      { id: "sfx-02-tick", cue: "tick", source: "/project/assets/audio/kit/sfx/tick.wav", at: 1.0, volume: 0.3, duration: 0.14, shot: "callout" },
      { id: "sfx-03-tick", cue: "tick", source: "/project/assets/audio/kit/sfx/tick.wav", at: 4.123, volume: 0.3, duration: 0.14, shot: "tail" }
    ],
    mix: { source: "/project/assets/audio/mix.wav", duration: 6 },
    captions: [
      { start: 0.3, end: 1.2, text: "Hello & welcome" },
      { start: 1.2, end: 2.0, words: [{ text: "from" }, { text: "<LaunchClip>" }] },
      { start: 4.1, end: 5.5, text: "Try it" }
    ],
    render: { source: "/project/renders/final.mp4", duration: 6, width: 1080, height: 1920 },
    overlays: {
      callout: { source: "/project/exports/small/media/overlays/callout.mov", kind: "mov", frames: 60 },
      insert: { source: "/project/exports/small/media/overlays/insert.mov", kind: "mov", frames: 45 },
      tail: { source: "/project/exports/small/media/overlays/tail.mov", kind: "mov", frames: 60 }
    }
  };
}

// A 70 s motion-lane story that crosses the minute boundary (drop-frame tests).
export function longMotionStory() {
  return resolveStory({
    schema: "launchclip.story.v1",
    lane: "motion",
    format: { width: 1920, height: 1080, fps: 30, duration: 70 },
    brand: { colors: { bg: "#000000" }, fonts: { display: "anton" } },
    scenes: [
      { id: "s1", module: "metric", start: 0, end: 61 },
      { id: "s2", module: "metric", start: 61, end: 70, in: { type: "fade", dur: 0.5 } }
    ]
  });
}

export function longMotionMedia() {
  return {
    plate: { source: "/project/.launchclip/export/plate.mp4", duration: 70.1, color: "#000000" },
    voice: { source: "/project/assets/audio/narration.wav", duration: 69.5, audioChannels: 1 },
    overlays: {
      s1: { source: "/x/s1.mov", kind: "mov", frames: 2400 },
      s2: { source: "/x/s2.mov", kind: "mov", frames: 300 }
    }
  };
}
