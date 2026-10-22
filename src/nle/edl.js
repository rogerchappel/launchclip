// CMX 3600 EDL for V1 of the NLE timeline model, plus SubRip captions.
//
// An EDL holds one video track, so it carries the base: footage-led trim
// segments as cuts from the recording's reel with source in/out timecode (and
// the recording's audio on A1, "B" events), or the plate. Gaps become black
// (BL) events so record timecode stays continuous. Markers ride along as
// "* LOC:" comments, which Resolve and Premiere read. Overlays, music and SFX
// are not representable: use FCPXML or xmeml for the full timeline.
//
// Timecode follows the timeline rate: 29.97/59.94 are drop-frame (";") with
// "FCM: DROP FRAME", everything else non-drop.
import { framesToSeconds, framesToTimecode, parseRate, timecodeToFrames } from "./time.js";

/** timeline → {edl, warnings}. options: {title, start: record start frame offset (default 0)} */
export function writeEdl(timeline, options = {}) {
  const rate = timeline.rate;
  const warnings = [];
  const recordStart = options.start ?? 0;
  const tc = (frames) => framesToTimecode(frames, rate, { start: 0 });
  const rec = (frames) => framesToTimecode(frames, rate, { start: recordStart });
  const assets = new Map(timeline.assets.map((asset) => [asset.id, asset]));
  const v1 = timeline.tracks.find((track) => track.id === "V1");
  const linked = new Set(timeline.tracks.flatMap((track) => track.clips).filter((item) => item.linked).map((item) => item.linked));
  const reels = new Map();
  const reelFor = (asset) => {
    if (!reels.has(asset.id)) {
      const stem = asset.path.split("/").pop().replace(/\.[^.]+$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7) || "REEL";
      let reel = stem;
      let n = 1;
      while ([...reels.values()].includes(reel)) reel = `${stem.slice(0, 6)}${n++}`;
      reels.set(asset.id, reel);
    }
    return reels.get(asset.id);
  };
  const lines = [`TITLE: ${sanitizeTitle(options.title ?? timeline.name)}`, `FCM: ${rate.dropFrame ? "DROP FRAME" : "NON-DROP FRAME"}`, ""];
  let event = 0;
  let cursor = 0;
  const push = (reel, channels, sourceIn, sourceOut, recordIn, recordOut, comments = []) => {
    event += 1;
    lines.push(`${String(event).padStart(3, "0")}  ${reel.padEnd(8)} ${channels.padEnd(5)} C        ${tc(sourceIn)} ${tc(sourceOut)} ${rec(recordIn)} ${rec(recordOut)}`);
    lines.push(...comments.map((comment) => `* ${comment}`));
    lines.push("");
  };
  const clips = [...(v1?.clips ?? [])].sort((a, b) => a.start - b.start);
  for (const item of clips) {
    const asset = assets.get(item.asset);
    if (item.start > cursor) push("BL", "V", 0, item.start - cursor, cursor, item.start);
    const channels = linked.has(item.id) ? "B" : "V";
    push(reelFor(asset), channels, item.in, item.in + item.duration, item.start, item.start + item.duration, [
      `FROM CLIP NAME: ${asset.path.split("/").pop()}`,
      `SOURCE FILE: ${asset.path}`
    ]);
    cursor = item.start + item.duration;
  }
  if (cursor < timeline.duration) push("BL", "V", 0, timeline.duration - cursor, cursor, timeline.duration);
  for (const marker of timeline.markers) {
    lines.push(`* LOC: ${rec(marker.frame)} ${marker.kind === "hit" ? "YELLOW" : marker.kind === "camera" ? "PURPLE" : "BLUE"}   ${marker.name.replace(/\s+/g, "_")}`);
  }
  const others = timeline.tracks.filter((track) => track.id !== "V1" && track.clips.some((item) => !item.linked));
  if (others.length) warnings.push(`the EDL carries V1 only; ${others.map((track) => track.id).join(", ")} are left out (use fcpxml or premiere for overlays, music and SFX)`);
  return { edl: `${lines.join("\n").replace(/\n+$/, "")}\n`, warnings };
}

/** Parse a CMX 3600 EDL (as written above) on `rate` (from parseRate) → {title, dropFrame, events: [{event, reel, channels, sourceIn, sourceOut, recordIn, recordOut, comments}], markers}. */
export function readEdl(text, rate) {
  const lines = String(text).split(/\r?\n/);
  const out = { title: null, dropFrame: false, events: [], markers: [] };
  let fcm = null;
  for (const line of lines) {
    if (line.startsWith("TITLE:")) out.title = line.slice(6).trim();
    else if (line.startsWith("FCM:")) { fcm = line.slice(4).trim(); out.dropFrame = fcm === "DROP FRAME"; }
    else if (/^\d{3}\s/.test(line)) {
      const parts = line.trim().split(/\s+/);
      const [event, reel, channels, transition, sIn, sOut, rIn, rOut] = parts;
      const r = parseRate({ num: rate.num, den: rate.den }, { dropFrame: out.dropFrame });
      out.events.push({ event: Number(event), reel, channels, transition, sourceIn: timecodeToFrames(sIn, r), sourceOut: timecodeToFrames(sOut, r), recordIn: timecodeToFrames(rIn, r), recordOut: timecodeToFrames(rOut, r), timecodes: [sIn, sOut, rIn, rOut], comments: [] });
    } else if (line.startsWith("* LOC:")) {
      const [timecode, color, ...name] = line.slice(6).trim().split(/\s+/);
      out.markers.push({ timecode, color, name: name.join(" ") });
    } else if (line.startsWith("* ") && out.events.length) out.events.at(-1).comments.push(line.slice(2));
  }
  if (!fcm) throw new Error("EDL has no FCM line");
  return out;
}

/** Caption clips (timeline.captions) → SubRip text. */
export function writeSrt(timeline) {
  const rate = timeline.rate;
  const blocks = (timeline.captions?.clips ?? []).map((item, index) => `${index + 1}\n${srtTime(framesToSeconds(item.start, rate))} --> ${srtTime(framesToSeconds(item.start + item.duration, rate))}\n${item.text}\n`);
  return blocks.join("\n");
}

/** Parse SubRip → [{index, start, end, text}] (seconds). */
export function readSrt(text) {
  return String(text).trim().split(/\r?\n\r?\n+/).filter(Boolean).map((block) => {
    const [index, times, ...body] = block.split(/\r?\n/);
    const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(times ?? "");
    if (!match) throw new Error(`Bad SRT timing line: ${times}`);
    const seconds = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    return { index: Number(index), start: seconds(...match.slice(1, 5)), end: seconds(...match.slice(5, 9)), text: body.join("\n") };
  });
}

function srtTime(seconds) {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function sanitizeTitle(value) {
  return String(value).replace(/[^\x20-\x7e]/g, "").slice(0, 70) || "LAUNCHCLIP";
}
