// The sound score: sound that tells the story instead of decorating it. Where
// the cue binder gives a few moments a sound each, the score plans the whole
// soundtrack from what the storyboard does and says (no music underneath):
//
//   moments    what the viewer should feel: scene hits with a `moment`
//              (letdown, promise, reveal, impact, crystallise, wonder, miss,
//              resolve), which the planner writes from the script and visuals.
//              Unlocks, an exact-frame landing, the first word and the last
//              line get one on their own;
//   turns      a whoosh on every scene change, moving the way the camera does;
//              a scene that opens big gets one crossing the whole stereo field
//              over a deep bass drum, the room dropping away just before;
//   machines   interfaces sound like hardware: a playhead hunts along a
//              timeline like a typewriter carriage (an even comb of mechanical
//              ticks following it across the speakers, an arcade blip and a
//              type bar on each find), a dial clicks round through its detents,
//              a fader slides and seats, a frame ruler steps and slows;
//   rewards    an unlock plays a rising arpeggio, each one climbing higher, and
//              the finds in a scan climb note by note, like levelling up;
//   detail     everything else that changes on screen gets a small sound, panned
//              to where it happens, no two running the same;
//   room       a low stereo room under it all, dropping away before a big hit
//              so the hit lands out of near silence.
//
// Everything pitched is in one key. planScore is pure: it returns the cues and
// the room's level over time; src/sfx/score_sounds.js gives each cue a file and
// src/scripts/build-mix.mjs (scoreGraph) places it.
import { unitHash } from "./library.js";

/** Why each take: its Earshot bank ids, in turn, and the kit family that stands in without Earshot. */
const TAKES = Object.freeze({
  tap: { family: "tick", ids: ["pro_tap/soft", "tap/finger", "toggle/on", "pro_tap/finger", "ui_pop/soft", "knock/plastic", "tap/soft", "pro_tap/double", "fit/click/floss_lid", "ui_pop/step", "shutter/quick", "toggle/off", "pro_pop/boop", "tap/knuckle", "drip/tiny", "pro_pop/tink"] },
  land: { family: "pop", ids: ["fit/land.light/finger_phone", "knock/wood", "pro_pop_in/deep", "fit/hit/bamboo_tok", "pro_tap/knock", "knock/snap", "pro_pop/thup", "fit/key/thock", "pro_pop_in/round", "toggle/latch", "knock/desk", "shutter/film", "fit/pop/mouth_plop", "fit/key/lubed", "drip/drop", "tap/table"] },
  move: { family: "swipe", ids: ["swish/bright", "swish/stick", "fit/whoosh.short/bamboo_swish", "swipe/paper", "swish/soft", "pro_zip/up", "swish/zing", "pro_zip/down_warm", "swish/flick", "pro_zip/up_hi"] },
  whoosh: { family: "whoosh", ids: ["whoosh_fast/crisp", "whoosh_fast/tight", "swipe/glide", "whoosh_fast/sleeve", "swish/cane", "swish/flick", "pro_whoosh_big/windy", "swish/blade", "whoosh_big/cape", "swipe/flick"] },
  cross: { family: "whoosh", ids: ["whoosh_big/gust", "whoosh_big/jet", "whoosh_big/swell"], dur: 1.4 },
  key: { family: "keystroke", ids: ["fit/key/medium", "pro_typing_key/tick", "fit/key/thock", "pro_typing_key/soft", "fit/key/lubed", "pro_typing_key/double", "typing_key/clicky", "typing_key/crisp", "typing_key/thock", "pro_typing_key/crackle"] },
  strike: { family: "click", ids: ["knock/snap"] },
  detent: { family: "tick", ids: ["click/soft"] },
  fader: { family: "slide", ids: ["swipe/cloth"], dur: 0.45 },
  seat: { family: "thud", ids: ["fit/key.space/thock_space"] },
  stop: { family: "click", ids: ["knock/wood", "knock/desk"] },
  latch: { family: "snap", ids: ["toggle/latch", "toggle/rocker"] },
  lock: { family: "click", ids: ["toggle/on", "toggle/micro", "toggle/off"] },
  swell: { family: "riser", ids: ["reverse_swell/ring", "reverse_swell/breath", "reverse_swell/dark"] },
  sting: { family: "shimmer", ids: ["pro_logo_sting/swell_sting"] },
  impact: { family: "impact", ids: ["pro_impact/rumble", "pro_impact/air", "pro_impact/swell"] },
  shutter: { family: "click", ids: ["shutter/quick"] },
  sink: { family: "subdrop", ids: ["downlifter/tape", "downlifter/sub_sink"] },
  hollow: { family: "thud", ids: ["knock/plastic"] },
  sub: { family: "subdrop", ids: ["pro_sub_drop/soft", "pro_sub_drop/ref"] },
  bloom: { family: "shimmer", ids: ["logo_sting/reverse_bloom", "logo_sting/soft_bloom"] },
  shimmer: { family: "shimmer", ids: ["shimmer/m4", "pro_shimmer/m3"] },
  snatch: { family: "riser", ids: ["riser/snatch"] },
  miss: { family: "glitch", ids: ["glitch/mid", "glitch/chirp", "glitch/dropout"] },
  bigWhoosh: { family: "whoosh", ids: ["whoosh_big/deep"] },
  bell: { family: "ding", ids: ["notify/mid_tine"] },
  carriage: { family: "swipe", ids: ["swipe/paper"], dur: 0.4 },
  zip: { family: "swipe", ids: ["pro_zip/down", "pro_zip/arc"] }
});

/** Every kit family the score can stand on without Earshot. */
export const SCORE_FAMILIES = Object.freeze([...new Set(Object.values(TAKES).map((take) => take.family))].sort());

const SEMITONES = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export const midiName = (midi) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** A note name ("C#6") → MIDI, or null. */
export function noteMidi(name) {
  const match = /^([A-G][#b]?)(-?\d+)$/.exec(String(name ?? ""));
  return match ? (Number(match[2]) + 1) * 12 + SEMITONES[match[1]] : null;
}

/** The score's key: every pitched sound takes its notes from here. */
export function scoreKey(key = "A") {
  const tonic = SEMITONES[String(key).replace(/m(in(or)?)?$/i, "")] ?? SEMITONES.A;
  const inScale = (midi) => MAJOR.includes((((midi - tonic) % 12) + 12) % 12);
  const scale = (octave, degree) => {
    const base = (octave + 1) * 12 + tonic;
    const steps = Math.floor(degree / 7);
    return base + steps * 12 + MAJOR[((degree % 7) + 7) % 7];
  };
  // Bass notes are the tonic or the fifth, never anything that fights the motif.
  const bass = [tonic, (tonic + 7) % 12].map((pc) => { let hz = midiHz(pc + 12); while (hz < 40) hz *= 2; while (hz >= 60) hz /= 2; return Number(hz.toFixed(2)); }).sort((a, b) => a - b);
  return { name: NAMES[tonic], tonic, inScale, scale, deep: bass[0], punch: bass[1] };
}

/**
 * The nearest allowed note to a sound's own pitch (MIDI), as a name: a scale
 * note, or the tonic or fifth in the bass. Moves a sound as little as it can.
 */
export function tunedNote(own, key) {
  const allowed = own < 48 ? (midi) => [key.tonic, (key.tonic + 7) % 12].includes(((midi % 12) + 12) % 12) : key.inScale;
  let best = Math.round(own);
  for (let reach = 0; reach < 8; reach += 1) {
    const candidates = [Math.round(own) - reach, Math.round(own) + reach].filter(allowed).sort((a, b) => Math.abs(a - own) - Math.abs(b - own));
    if (candidates.length) { best = candidates[0]; break; }
  }
  return midiName(best);
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const round3 = (value) => Math.round(value * 1000) / 1000;
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const WIDTH = 1080;
const DESIGN = (story) => Number(story?.format?.width) || WIDTH;

// Things that are light or a background, not an event worth a sound.
const SILENT_KINDS = new Set(["waveform", "bloom", "burst"]);
const PANEL_KINDS = new Set(["window", "timeline", "terminal", "meter", "lock-cards", "results", "downloads", "marker-snap", "frame-ruler", "scan-plane", "pad-grid", "stack", "card-wall"]);

/** Every time among a component's props: keys named at or ending in At, at any depth. */
function propTimes(value, key = "", out = []) {
  if (typeof value === "number") {
    if (/^(at|[a-z][a-z0-9]*At)$/.test(key) && Number.isFinite(value)) out.push(value);
  } else if (Array.isArray(value)) value.forEach((item) => propTimes(item, key, out));
  else if (value && typeof value === "object") for (const [name, item] of Object.entries(value)) propTimes(item, name, out);
  return out;
}

function walkElements(elements, visit, top = null) {
  for (const element of Array.isArray(elements) ? elements : []) {
    visit(element, top ?? element);
    walkElements(element.children, visit, top ?? element);
  }
}

/** A scene that opens big: the planner marked it high energy or a build. */
function opensBig(scene) {
  return scene.energy === "build" || Number(scene.energy) >= 3;
}

/**
 * The score of a resolved story. Returns {key, cues, room, silences}: cues
 * [{role, take, native, cue (kit family), at, volume, pan, sweep, align, shot,
 * intent, source: "score", event}], room [[seconds, level]].
 */
export function planScore(story, { seed = "", key: keyName = "A", density = 1 } = {}) {
  const key = scoreKey(keyName);
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : []).filter((scene) => num(scene.start) !== null);
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration ?? scenes.at(-1)?.end ?? 0);
  const width = DESIGN(story);
  const cues = [];
  const silences = [];
  const peaks = [];
  const turns = new Map();
  const random = (label) => unitHash(`score|${seed}|${label}`);

  const add = (role, at, volume, { pan = 0, sweep = null, align = "start", shot = null, why = role, note = null, native = null } = {}) => {
    if (!(at >= 0) || (duration > 0 && at >= duration - 0.02)) return null;
    const cue = { role, at: round3(at), volume: round3(volume), pan: round3(clamp(pan, -0.95, 0.95)), align, source: "score", shot, intent: `score: ${why}`, event: role };
    if (sweep) cue.sweep = sweep;
    if (native) {
      cue.native = native;
      cue.cue = native.type === "kick" ? "impact" : "tick";
    } else {
      const take = TAKES[role];
      const turn = turns.get(role) ?? 0;
      turns.set(role, turn + 1);
      const id = take.ids[turn % take.ids.length];
      const pass = Math.floor(turn / take.ids.length);
      cue.take = { id, ...(take.dur ? { dur: take.dur } : {}), ...(note ? { pitch: note } : {}), ...(pass ? { seed: pass + 1 } : {}) };
      cue.cue = take.family;
    }
    cues.push(cue);
    return cue;
  };
  const kick = (at, hz, decay, volume, shot, why) => add("kick", at, volume, { native: { type: "kick", hz, decay }, shot, why });
  const chip = (at, a, b, volume, pan, shot, why) => add("chip", at, volume, { pan, native: { type: "chip", a: midiName(a), b: midiName(b) }, shot, why });
  const pluck = (at, midi, volume, pan, shot, why) => add("pluck", at, volume, { pan, native: { type: "pluck", note: midiName(midi) }, shot, why });
  const motif = (at, octave, gap, volume, shot, why) => [0, 2, 4].forEach((degree, k) => pluck(at + gap * k, key.scale(octave, degree), volume, -0.45 + 0.45 * k, shot, why));
  const dip = (at, depth = 0.05, lead = 0.28) => silences.push({ from: round3(at - lead), to: round3(at), depth });
  const lift = (at, level = 1.25) => peaks.push({ at, level });

  // Rewards climb across the video: each one starts higher than the last.
  let level = 0;
  const levelUp = (at, shot, why) => {
    const start = level * 2;
    [0, 2, 4].forEach((degree, k) => pluck(at + 0.08 * k, key.scale(5, start + degree), 0.34 + 0.05 * k, -0.5 + 0.5 * k, shot, why));
    level += 1;
  };
  const grains = (from, to, startRate, endRate, volume, shot, why, { rising = false } = {}) => {
    const notes = [0, 1, 2, 4, 5, 7, 8, 9, 11].map((degree) => key.scale(5, degree));
    let t = from;
    let n = 0;
    while (t < to) {
      const u = (t - from) / Math.max(0.01, to - from);
      const midi = rising ? notes[Math.min(notes.length - 1, Math.floor(u * notes.length))] : notes[Math.floor(random(`grain|${from}|${n}`) * notes.length)];
      pluck(t, midi, volume * (0.6 + 0.5 * random(`grain-v|${from}|${n}`)), -0.95 + 1.9 * random(`grain-p|${from}|${n}`), shot, why);
      t += (0.7 + 0.6 * random(`grain-t|${from}|${n}`)) / (startRate + (endRate - startRate) * u);
      n += 1;
    }
  };

  const MOMENTS = {
    impact(at, shot, why) {
      dip(at);
      lift(at, 1.35);
      kick(at, key.deep, 1.2, 0.6, shot, why);
      add("impact", at, 0.45, { shot, why });
    },
    letdown(at, shot, why) {
      dip(at, 0, 0.3);
      lift(at, 1.1);
      add("sink", Math.max(0, at - 1.9), 0.5, { shot, why: `${why}: the floor falls away` });
      add("hollow", at, 0.55, { shot, why });
      add("sub", at, 0.5, { shot, why });
    },
    promise(at, shot, why) {
      motif(at, 4, 0.25, 0.42, shot, why);
    },
    reveal(at, shot, why) {
      lift(at, 1.2);
      add("lock", at - 0.3, 0.5, { shot, why: `${why}: the lock turns` });
      add("swell", at, 0.5, { align: "peak", shot, why });
      add("sting", at, 0.85, { align: "peak", shot, why });
      kick(at, key.punch, 0.7, 0.38, shot, why);
      levelUp(at + 0.06, shot, `${why}: level up`);
    },
    crystallise(at, shot, why) {
      silences.push({ from: round3(at - 1.2), to: round3(at - 0.8), depth: 0.12 });
      lift(at, 1.25);
      grains(at - 0.8, at, 3, 16, 0.3, shot, `${why}: grains speed up and climb`, { rising: true });
      add("snatch", at, 0.5, { align: "peak", shot, why });
      add("bloom", at, 0.85, { align: "peak", shot, why });
    },
    wonder(at, shot, why) {
      lift(at, 1.6);
      add("bigWhoosh", at, 0.8, { align: "peak", shot, why });
      kick(at, key.deep, 1, 0.32, shot, why);
      add("shimmer", at + 0.3, 0.3, { shot, why });
      grains(at + 0.3, at + 2.9, 12, 5, 0.2, shot, `${why}: drifting past`);
    },
    miss(at, shot, why) {
      silences.push({ from: round3(at - 0.05), to: round3(at + 0.6), depth: 0.12 });
      add("miss", at, 0.25, { pan: random(`miss|${at}`) > 0.5 ? 0.5 : -0.5, shot, why });
    },
    resolve(at, shot, why) {
      lift(at, 1.2);
      add("bloom", at, 0.65, { shot, why });
      motif(at - 0.47, 5, 0.24, 0.42, shot, why);
    }
  };

  const placedMoments = [];
  const moment = (kind, at, shot, why) => {
    if (placedMoments.some((other) => Math.abs(other - at) < 0.5)) return;
    placedMoments.push(at);
    MOMENTS[kind](at, shot, why);
  };

  // Moments the planner wrote come first: they are the story.
  for (const scene of scenes) {
    for (const hit of Array.isArray(scene.hits) ? scene.hits : []) {
      if (MOMENTS[hit?.moment] && num(hit.at) !== null) moment(hit.moment, hit.at, scene.id, `${hit.moment} (${hit.event})`);
    }
  }

  // Scene turns. A scene that opens big gets the room's whole width and a bass drum.
  let crossing = 1;
  let previousDolly = null;
  scenes.forEach((scene, index) => {
    const dolly = Number(scene.params?.stage?.dolly?.x);
    if (index > 0) {
      const direction = (Number.isFinite(dolly) && dolly !== 0 ? Math.sign(dolly) : previousDolly ? -Math.sign(previousDolly) : index % 2 ? 1 : -1) || 1;
      const hitsLater = (Array.isArray(scene.params?.elements) ? scene.params.elements : []).some((element) => element.kind === "frame-ruler");
      if (opensBig(scene) && !hitsLater) {
        dip(scene.start, 0.05, 0.25);
        lift(scene.start, 1.4);
        add("cross", scene.start, 0.95, { align: "peak", sweep: [-crossing, crossing], shot: scene.id, why: "crosses the room into a big scene" });
        kick(scene.start, key.deep, 1.1, 0.55, scene.id, "bass drum under the turn");
        crossing = -crossing;
      } else {
        add("whoosh", scene.start, 0.34, { pan: 0.5 * direction, align: "peak", shot: scene.id, why: "scene turn, moving with the camera" });
      }
    }
    if (Number.isFinite(dolly)) previousDolly = dolly;
  });

  // The hook and the close.
  const firstWord = num(story?.words?.[0]?.start) ?? num(scenes[0]?.start) ?? 0;
  if (scenes.length) {
    add("impact", Math.max(0.05, firstWord), 0.55, { shot: scenes[0].id, why: "the first word lands" });
    add("cross", Math.max(0.05, firstWord), 0.5, { align: "peak", sweep: [-0.7, 0.7], shot: scenes[0].id, why: "the hook arrives" });
  }
  const close = scenes.at(-1);
  if (close && !placedMoments.some((at) => at >= close.start)) moment("resolve", Math.min(duration - 0.5, close.start + 0.47), close.id, "the close");

  // The machines. Each scan hunts from its own start, climbing as it finds things.
  const scan = (start, end, rate, panFrom, panTo, gain, shot, why, finds = []) => {
    const steps = Math.max(2, Math.round((end - start) * rate));
    for (let k = 0; k < steps; k += 1) {
      const u = k / (steps - 1);
      add("key", start + (end - start) * u, gain * (k % 4 === 0 ? 1.25 : 0.85), { pan: panFrom + (panTo - panFrom) * u, shot, why });
    }
    finds.forEach((find) => {
      const low = key.scale(5, find.step);
      chip(find.at, low, key.scale(5, find.step + 2), gain * 0.95, find.pan, shot, `${why}: found one`);
      add("strike", find.at, gain * 1.2, { pan: find.pan, shot, why: `${why}: the type bar strikes` });
    });
  };
  const panOf = (rect) => (rect && Number.isFinite(rect.x) && Number.isFinite(rect.width) ? clamp(((rect.x + rect.width / 2) / width) * 2 - 1, -0.9, 0.9) : 0);
  let comboStep = 0;
  let lastScanEnd = -Infinity;
  // A scan close after the last one carries on climbing; a later one starts again.
  const startScan = (from) => {
    if (from - lastScanEnd > 2) comboStep = 0;
    lastScanEnd = from;
  };
  const combo = () => {
    const step = comboStep;
    comboStep += 2;
    return step;
  };
  const claimed = [];
  for (const scene of scenes) {
    const start = scene.start;
    const end = num(scene.end) ?? duration;
    const within = (t) => Math.min(end, start + t);
    walkElements(scene.params?.elements, (element, top) => {
      const props = element.props ?? {};
      const at = num(element.at) ?? 0;
      const pan = panOf(top.rect);
      if (element.kind === "timeline" && props.playhead && num(props.playhead.dur)) {
        const p = props.playhead;
        const from = start + (num(p.at) ?? at);
        const to = within((num(p.at) ?? at) + p.dur);
        const quiet = scene === scenes[0];
        const panFrom = (Number(p.from ?? 0) * 2 - 1) * 0.9;
        const panTo = (Number(p.to ?? 1) * 2 - 1) * 0.9;
        // A marker snapping in while the playhead runs is its find; otherwise it finds two along the way.
        const snap = (Array.isArray(scene.params?.elements) ? scene.params.elements : []).find((other) => other.kind === "marker-snap" && num(other.props?.snapAt) !== null);
        startScan(from);
        const along = (u) => ({ at: from + (to - from) * u, step: combo(), pan: panFrom + (panTo - panFrom) * u });
        const finds = quiet ? [] : snap ? [0.25, 0.65].map(along).concat([{ at: start + snap.props.snapAt, step: combo(), pan: panTo }]) : [0.3, 0.65].map(along);
        scan(from, to, quiet ? 9 : 12, panFrom, panTo, quiet ? 0.12 : 0.26, scene.id, "the playhead crosses the timeline", finds);
        lastScanEnd = to;
        claimed.push([from, to]);
      }
      if (element.kind === "scan-plane") {
        const from = start + (num(props.scanAt) ?? at);
        const to = within((num(props.scanAt) ?? at) + (num(props.scanDur) ?? 2));
        startScan(from);
        const markers = (Array.isArray(props.markers) ? props.markers : []).map((marker) => ({ at: start + (num(marker.at) ?? 0), step: combo(), pan: (Number(marker.x ?? 0.5) * 2 - 1) * 0.9 })).filter((find) => find.at < end);
        scan(from, to, 13, -0.9, 0.5, 0.34, scene.id, "the scan hunts along the timeline", markers);
        lastScanEnd = to;
        claimed.push([from, to]);
      }
      if (element.kind === "frame-ruler" && num(props.snapAt)) {
        const steps = clamp(Math.abs(Number(props.target ?? 8) - Number(props.start ?? 0)) || 8, 4, 12);
        const from = start + at + 0.1;
        const to = start + props.snapAt;
        // A scan just before it runs out of line: the carriage bell, and back.
        if (start - lastScanEnd < 1.5 && start - lastScanEnd > -0.2) {
          add("bell", start - 0.33, 0.4, { pan: 0.8, shot: scene.id, why: "carriage bell: end of the line" });
          add("carriage", start - 0.15, 0.34, { sweep: [0.8, -0.8], shot: scene.id, why: "the carriage returns" });
        }
        for (let k = 0; k < steps; k += 1) {
          const u = k / (steps - 1);
          const t = from + (to - from) * u ** 1.8;
          add("key", t, 0.3 + 0.18 * u, { pan, shot: scene.id, why: "the frame ruler steps, slowing" });
          const note = key.scale(5, k);
          chip(t, note, note, 0.1 + 0.07 * u, pan, scene.id, "the frame counter climbs");
        }
        const hit = start + (num(props.slot?.dropAt) ?? props.snapAt);
        moment("impact", hit, scene.id, "lands on the exact frame");
        add("shutter", hit, 0.6, { shot: scene.id, why: "the exact click" });
        add("sub", hit, 0.4, { shot: scene.id, why: "the weight of it" });
        claimed.push([from, to]);
      }
      if (element.kind === "meter") {
        const settle = start + (num(props.settleAt) ?? at + 0.6);
        const from = start + at;
        const detents = clamp(Math.round(Math.abs(Number(props.to ?? -14) - Number(props.from ?? -31)) * 0.65), 5, 14);
        for (let k = 0; k < detents; k += 1) {
          const u = k / Math.max(1, detents - 1);
          const degree = Math.round(u * 8);
          const quiet = scene === scenes[0] ? 0.45 : 1;
          add("detent", from + (settle - from) * u ** 2.2, 0.42 * quiet * (0.65 + 0.35 * u), { pan, shot: scene.id, why: "the analog dial clicks round", note: midiName(key.scale(6, degree - 1)) });
        }
        if (scene !== scenes[0]) {
          add("fader", from + 0.03, 0.3, { pan: -pan, shot: scene.id, why: "the fader slides" });
          add("seat", settle, 0.62, { pan: -pan, shot: scene.id, why: "the fader seats" });
          add("stop", settle, 0.5, { pan, shot: scene.id, why: "the dial stops dead" });
          if (props.rangeLabel !== false) [0, 4].forEach((degree, k) => pluck(settle + 0.06 + 0.08 * k, key.scale(6, degree), 0.36, pan, scene.id, "in range: a small reward"));
        }
        claimed.push([from, settle]);
      }
      // Paper: a fold creases panel by panel, a limb slithers out, a page's flaps snap up.
      if (element.kind === "paper-fold") {
        const open = start + (num(props.openAt) ?? at);
        const panels = Array.isArray(props.panels) ? props.panels.length : 0;
        add("move", open, 0.42, { pan, shot: scene.id, why: "the map unfolds" });
        for (let k = 0; k < panels; k += 1) add("strike", open + 0.06 + k * 0.09, 0.2 + 0.03 * k, { pan: -0.7 + (1.4 * k) / Math.max(1, panels - 1), shot: scene.id, why: "a fold creases open" });
        claimed.push([open, open + 0.9]);
      }
      if (element.kind === "limb") {
        add("carriage", start + (num(props.growAt) ?? at), 0.3, { pan, shot: scene.id, why: "a limb slides out from behind" });
      }
      if (element.kind === "paper-sheet" && num(props.flapAt) !== null && props.flaps) {
        add("latch", start + props.flapAt, 0.45, { pan: -0.6, shot: scene.id, why: "a side panel folds up" });
        add("latch", start + props.flapAt + 0.05, 0.45, { pan: 0.6, shot: scene.id, why: "a side panel folds up" });
      }
      if (element.kind === "marker-snap" && num(props.snapAt)) {
        add("latch", start + props.snapAt, 0.5, { pan, shot: scene.id, why: "the marker snaps in" });
      }
      if (element.kind === "lock-cards") {
        for (const card of Array.isArray(props.cards) ? props.cards : []) {
          if (num(card.unlockAt) !== null && card.unlockAt >= 0) moment("reveal", start + card.unlockAt, scene.id, `${card.name ?? "a tool"} unlocks`);
        }
      }
      if (element.kind === "downloads") {
        const arrivals = [...new Set(propTimes(props.items ?? []).filter((t) => t > at))].sort((a, b) => a - b).slice(0, 8);
        if (arrivals.length) add("zip", start + arrivals[0] - 0.3, 0.5, { pan: -pan, shot: scene.id, why: "a file flies out" });
        arrivals.forEach((t, k) => pluck(start + t, key.scale(4, k * 2), 0.34 + 0.02 * k, -0.45 + 0.3 * k, scene.id, "a file arrives"));
      }
      if (element.kind === "comment") {
        if (num(props.sendAt)) add("land", start + props.sendAt, 0.42, { pan, shot: scene.id, why: "the comment posts" });
        if (num(props.replyAt)) pluck(start + props.replyAt, key.scale(5, 4), 0.36, pan, scene.id, "the reply arrives");
      }
      if (element.kind === "burst") {
        const t = start + at;
        if (!placedMoments.some((other) => Math.abs(other - t) < 0.5)) moment("impact", t, scene.id, "a burst");
      }
    });
  }

  // Detail: everything else that changes on screen, panned to where it happens.
  // A low density drops the smallest; nothing sounds in the hush before a hit.
  const inHush = (t) => silences.some((span) => t >= span.from && t < span.to);
  const taken = cues.map((cue) => cue.at).sort((a, b) => a - b);
  const clear = (t, gap) => !taken.some((other) => Math.abs(other - t) < gap);
  const detail = [];
  for (const scene of scenes) {
    walkElements(scene.params?.elements, (element, top) => {
      if (SILENT_KINDS.has(element.kind)) return;
      const at = num(element.at) ?? 0;
      const pan = panOf(top.rect);
      const panel = PANEL_KINDS.has(element.kind);
      if (element.enter !== "cut") detail.push({ t: scene.start + at, role: panel ? "move" : "land", gain: panel ? 0.28 : element.kind === "host" ? 0.2 : 0.32, pan, shot: scene.id, kind: element.kind });
      for (const t of propTimes(element.props ?? {})) if (t > at) detail.push({ t: scene.start + t, role: "land", gain: 0.26, pan, shot: scene.id, kind: element.kind });
      if (Array.isArray(element.beats)) for (const beat of element.beats) if (num(beat.at) !== null) detail.push({ t: scene.start + beat.at, role: "tap", gain: element.kind === "host" ? 0.12 : 0.2, pan, shot: scene.id, kind: element.kind });
    });
  }
  detail.sort((a, b) => a.t - b.t);
  const amount = clamp(Number(density), 0, 1);
  let lastDetail = -Infinity;
  for (const entry of detail) {
    if (entry.role === "tap" && amount < 0.4) continue;
    if (amount < 0.2) continue;
    if (inHush(entry.t) || !clear(entry.t, 0.09) || entry.t - lastDetail < 0.09) continue;
    if (claimed.some(([from, to]) => entry.t >= from && entry.t <= to) && entry.role !== "move") continue;
    add(entry.role, entry.t, entry.gain, { pan: entry.pan * 1.3 + (random(`pan|${entry.t}`) - 0.5) * 0.3, align: entry.role === "move" ? "peak" : "start", shot: entry.shot, why: `${entry.kind} changes` });
    lastDetail = entry.t;
  }

  // Quiet ticks in any gap left, so the air is never empty, except in a hush.
  const placed = cues.map((cue) => cue.at).sort((a, b) => a - b);
  placed.forEach((a, i) => {
    const b = placed[i + 1] ?? duration - 0.3;
    if (b - a < 0.9 || amount < 0.4) return;
    let t = a + 0.25;
    let n = 0;
    while (t < b - 0.2) {
      if (!inHush(t)) add("tap", t, 0.08 + 0.05 * random(`air|${a}|${n}`), { pan: -0.8 + 1.6 * random(`air-p|${a}|${n}`), why: "the air stays alive" });
      t += 0.3 + 0.32 * random(`air-t|${a}|${n}`);
      n += 1;
    }
  });

  cues.sort((a, b) => a.at - b.at || String(a.role).localeCompare(String(b.role)));
  // Nothing but the hit itself plays in a hush. A kick or a riser ending on the hit starts inside it, by design.
  const kept = cues.filter((cue) => cue.align === "peak" || !silences.some((span) => cue.at >= span.from && cue.at < span.to && span.depth < 0.1));
  return { key: key.name, cues: kept, room: roomLevels(scenes, silences, peaks, duration), silences };
}

/** The room's level over time: follows each scene's energy, drops before a hit and swells on it. */
export function roomLevels(scenes, silences, peaks, duration) {
  const base = (scene) => (scene.energy === "build" ? 0.75 : clamp(0.35 + 0.15 * (Number(scene.energy) || 2), 0.4, 0.9));
  const points = new Map();
  const put = (t, level) => { if (t >= 0 && t <= duration) points.set(round3(t), round3(level)); };
  put(0, 0.2);
  scenes.forEach((scene) => put(Math.max(0.3, scene.start + 0.3), base(scene)));
  const hushed = (t) => silences.some((span) => t >= span.from && t <= span.to);
  for (const span of silences) {
    put(span.from - 0.15, base(scenes.findLast((scene) => scene.start <= span.from) ?? scenes[0]));
    put(span.from, span.depth);
    put(span.to, span.depth);
  }
  for (const peak of peaks) {
    if (!hushed(peak.at + 0.01)) put(peak.at + 0.01, peak.level);
    else put(peak.at + 0.02, peak.level);
    const scene = scenes.findLast((entry) => entry.start <= peak.at) ?? scenes[0];
    if (!hushed(peak.at + 1)) put(peak.at + 1, base(scene));
  }
  put(Math.max(0, duration - 0.3), 0);
  return [...points.entries()].sort((a, b) => a[0] - b[0]);
}
