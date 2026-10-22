// Round-trip checks for the NLE writers: parse what a writer produced and
// compare every clip's timeline start, duration and source in point, the
// markers and the captions with the timeline model, frame for frame. Each
// function returns a list of mismatches ([] = the file matches the model).
import { readEdl, readSrt } from "./edl.js";
import { readFcpxml, validateFcpxml } from "./fcpxml.js";
import { readOtio } from "./otio.js";
import { framesToSeconds } from "./time.js";
import { readXmeml } from "./xmeml.js";

function expectedClips(timeline, { skipLinked = false, skipSequences = false } = {}) {
  const assets = new Map(timeline.assets.map((asset) => [asset.id, asset]));
  const list = [];
  for (const track of timeline.tracks) for (const item of track.clips) {
    if (skipLinked && item.linked) continue;
    const asset = assets.get(item.asset);
    if (skipSequences && asset?.kind === "image-sequence") continue;
    list.push({ track, item, asset });
  }
  return list;
}

function sameRate(a, b) {
  return a.num === b.num && a.den === b.den;
}

/** FCPXML: structural validation, then clips, captions and markers against the model. */
export function checkFcpxmlRoundTrip(timeline, xml, { absolute } = {}) {
  const problems = validateFcpxml(xml);
  let parsed;
  try { parsed = readFcpxml(xml); } catch (error) { return [...problems, error.message]; }
  if (!sameRate(parsed.rate, timeline.rate)) problems.push(`rate ${parsed.rate.num}/${parsed.rate.den} != ${timeline.rate.num}/${timeline.rate.den}`);
  if (parsed.rate.dropFrame !== timeline.rate.dropFrame) problems.push("drop-frame flag differs");
  if (parsed.duration !== timeline.duration) problems.push(`duration ${parsed.duration} != ${timeline.duration}`);
  const expected = expectedClips(timeline, { skipLinked: true, skipSequences: true });
  if (parsed.clips.length !== expected.length) problems.push(`${parsed.clips.length} clips, expected ${expected.length}`);
  for (const { track, item, asset } of expected) {
    const match = parsed.clips.find((entry) => entry.name === item.name && entry.start === item.start && entry.src === encodePath(asset.path, absolute ? `file://${absolute}` : null));
    if (!match) { problems.push(`${track.id} ${item.name} @${item.start} not found`); continue; }
    if (match.duration !== item.duration) problems.push(`${item.name}: duration ${match.duration} != ${item.duration}`);
    if (match.in !== item.in) problems.push(`${item.name}: in ${match.in} != ${item.in}`);
    if (match.enabled !== (track.enabled !== false && item.enabled !== false)) problems.push(`${item.name}: enabled flag differs`);
  }
  problems.push(...compareCaptions(parsed.captions, timeline));
  problems.push(...compareMarkers(parsed.markers, timeline));
  return problems;
}

/** xmeml: per-track clips (start/end/in/out), enabled flags, links and markers. */
export function checkXmemlRoundTrip(timeline, xml, { absolute } = {}) {
  const problems = [];
  let parsed;
  try { parsed = readXmeml(xml); } catch (error) { return [error.message]; }
  if (!sameRate(parsed.rate, timeline.rate)) problems.push(`rate ${parsed.rate.num}/${parsed.rate.den} != ${timeline.rate.num}/${timeline.rate.den}`);
  if (parsed.duration !== timeline.duration) problems.push(`duration ${parsed.duration} != ${timeline.duration}`);
  const assets = new Map(timeline.assets.map((asset) => [asset.id, asset]));
  for (const kind of ["video", "audio"]) {
    const tracks = timeline.tracks.filter((track) => track.kind === kind);
    if (parsed[kind].length !== tracks.length) { problems.push(`${parsed[kind].length} ${kind} tracks, expected ${tracks.length}`); continue; }
    tracks.forEach((track, index) => {
      const read = parsed[kind][index];
      if (read.enabled !== (track.enabled !== false)) problems.push(`${track.id}: enabled flag differs`);
      const clips = track.clips.filter((item) => assets.get(item.asset)?.kind !== "image-sequence").sort((a, b) => a.start - b.start);
      if (read.clips.length !== clips.length) { problems.push(`${track.id}: ${read.clips.length} clips, expected ${clips.length}`); return; }
      clips.forEach((item, k) => {
        const got = read.clips[k];
        const want = { start: item.start, end: item.start + item.duration, in: item.in, out: item.in + item.duration };
        for (const key of Object.keys(want)) if (got[key] !== want[key]) problems.push(`${track.id} ${item.name}: ${key} ${got[key]} != ${want[key]}`);
        if (got.pathurl !== encodePath(assets.get(item.asset).path, absolute ? `file://localhost${absolute}` : null)) problems.push(`${track.id} ${item.name}: pathurl ${got.pathurl}`);
        if (item.linked && !got.links.length) problems.push(`${track.id} ${item.name}: link to its video clip is missing`);
      });
    });
  }
  problems.push(...compareMarkers(parsed.markers, timeline));
  return problems;
}

/** EDL: V1 events (black fills gaps) with source and record timecode, and SRT captions. */
export function checkEdlRoundTrip(timeline, edl, srt = null) {
  const problems = [];
  let parsed;
  try { parsed = readEdl(edl, timeline.rate); } catch (error) { return [error.message]; }
  if (parsed.dropFrame !== timeline.rate.dropFrame) problems.push("FCM drop-frame flag differs");
  const v1 = [...(timeline.tracks.find((track) => track.id === "V1")?.clips ?? [])].sort((a, b) => a.start - b.start);
  const events = parsed.events.filter((event) => event.reel !== "BL");
  if (events.length !== v1.length) problems.push(`${events.length} V1 events, expected ${v1.length}`);
  v1.forEach((item, index) => {
    const event = events[index];
    if (!event) return;
    if (event.recordIn !== item.start || event.recordOut !== item.start + item.duration) problems.push(`event ${event.event}: record ${event.recordIn}-${event.recordOut} != ${item.start}-${item.start + item.duration}`);
    if (event.sourceIn !== item.in || event.sourceOut !== item.in + item.duration) problems.push(`event ${event.event}: source ${event.sourceIn}-${event.sourceOut} != ${item.in}-${item.in + item.duration}`);
  });
  let cursor = 0;
  for (const event of parsed.events) {
    if (event.recordIn !== cursor) problems.push(`event ${event.event} starts at ${event.recordIn}, expected ${cursor} (record timecode must be continuous)`);
    cursor = event.recordOut;
  }
  if (cursor !== timeline.duration) problems.push(`the EDL ends at frame ${cursor}, the timeline lasts ${timeline.duration}`);
  if (srt !== null) {
    const captions = readSrt(srt);
    const clips = timeline.captions?.clips ?? [];
    if (captions.length !== clips.length) problems.push(`${captions.length} SRT captions, expected ${clips.length}`);
    clips.forEach((item, index) => {
      const read = captions[index];
      if (!read) return;
      const start = framesToSeconds(item.start, timeline.rate), end = framesToSeconds(item.start + item.duration, timeline.rate);
      if (Math.abs(read.start - start) > 0.0015 || Math.abs(read.end - end) > 0.0015) problems.push(`SRT ${index + 1}: ${read.start}-${read.end} != ${start}-${end}`);
      if (read.text !== item.text) problems.push(`SRT ${index + 1}: text differs`);
    });
  }
  return problems;
}

/** OTIO: tracks, clips (gap-accumulated starts), source ranges and markers. */
export function checkOtioRoundTrip(timeline, text) {
  const problems = [];
  let parsed;
  try { parsed = readOtio(text); } catch (error) { return [error.message]; }
  if (Math.abs(parsed.rate - timeline.rate.fps) > 1e-9) problems.push(`rate ${parsed.rate} != ${timeline.rate.fps}`);
  const ordered = [...timeline.tracks.filter((track) => track.kind === "video"), ...timeline.tracks.filter((track) => track.kind === "audio")];
  if (parsed.tracks.length !== ordered.length) problems.push(`${parsed.tracks.length} tracks, expected ${ordered.length}`);
  ordered.forEach((track, index) => {
    const read = parsed.tracks[index];
    if (!read) return;
    const clips = [...track.clips].sort((a, b) => a.start - b.start);
    if (read.clips.length !== clips.length) { problems.push(`${track.id}: ${read.clips.length} clips, expected ${clips.length}`); return; }
    clips.forEach((item, k) => {
      const got = read.clips[k];
      if (got.start !== item.start || got.duration !== item.duration || got.in !== item.in) problems.push(`${track.id} ${item.name}: ${got.start}+${got.duration} in ${got.in} != ${item.start}+${item.duration} in ${item.in}`);
    });
  });
  problems.push(...compareMarkers(parsed.markers, timeline));
  return problems;
}

function compareCaptions(read, timeline) {
  const problems = [];
  const clips = timeline.captions?.clips ?? [];
  if (read.length !== clips.length) return [`${read.length} captions, expected ${clips.length}`];
  clips.forEach((item, index) => {
    const got = read[index];
    if (got.start !== item.start || got.duration !== item.duration) problems.push(`caption ${index + 1}: ${got.start}+${got.duration} != ${item.start}+${item.duration}`);
    if (got.text !== item.text) problems.push(`caption ${index + 1}: text ${JSON.stringify(got.text)} != ${JSON.stringify(item.text)}`);
  });
  return problems;
}

function compareMarkers(read, timeline) {
  const want = timeline.markers.map((marker) => `${marker.frame}:${marker.name}`).sort();
  const got = read.map((marker) => `${marker.frame}:${marker.name}`).sort();
  if (want.length !== got.length) return [`${got.length} markers, expected ${want.length}`];
  const missing = want.filter((entry, index) => entry !== got[index]);
  return missing.length ? [`markers differ: ${missing.slice(0, 5).join(", ")}`] : [];
}

// The URL a writer emits for a media path: relative, or under an absolute root.
function encodePath(relativePath, prefix = null) {
  const encoded = String(relativePath).split("/").map(encodeURIComponent).join("/");
  if (!prefix) return encoded;
  const [scheme, root] = prefix.startsWith("file://localhost") ? ["file://localhost", prefix.slice(16)] : ["file://", prefix.slice(7)];
  return `${scheme}${root.replace(/\/+$/, "").split("/").map(encodeURIComponent).join("/")}/${encoded}`;
}
