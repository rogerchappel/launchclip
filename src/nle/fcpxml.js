// FCPXML 1.10 writer for the NLE timeline model (src/nle/timeline.js), for
// Final Cut Pro and DaVinci Resolve.
//
//   resources  one <format> for the sequence (and one per differently sized
//              video asset), one <asset> per media file with a relative
//              <media-rep src>, and nothing else (captions need no effect)
//   spine      V1 as the primary storyline (base clips or the plate, <gap>s
//              between them, and a trailing gap so the spine spans the whole
//              timeline)
//   lanes      every other clip is connected to the spine element it starts
//              in: video tracks on lanes 1…n, audio on -1…-n, captions above
//              the video; connected `offset`s are in the parent's local time
//              (parent start + timeline time - parent offset)
//   roles      audioRole dialogue / music / effects, captions as
//              SRT?captionFormat=SRT.<lang>
//   markers    on the spine element that spans them, also in local time
//
// Times are exact rationals of the timeline rate ("1001/30000s" at 29.97).
import { createHash } from "node:crypto";
import { fcpTime, fcpTimeToFrames, frameDuration, parseRate } from "./time.js";
import { child, element, escapeXml, findAll, parseXml } from "./xml.js";

export const FCPXML_VERSION = "1.10";

/**
 * timeline → FCPXML text.
 * options: {absolute: root directory for absolute file:// URLs (default: relative
 * paths), event, project}
 */
export function writeFcpxml(timeline, options = {}) {
  const rate = timeline.rate;
  const t = (frames) => fcpTime(frames, rate);
  const usable = (asset) => asset.kind !== "image-sequence";
  const warnings = [];

  // ---- resources
  const formats = [{ id: "r1", width: timeline.width, height: timeline.height }];
  const formatFor = (asset) => {
    if (!asset.hasVideo) return null;
    const width = asset.width ?? timeline.width, height = asset.height ?? timeline.height;
    let format = formats.find((entry) => entry.width === width && entry.height === height);
    if (!format) { format = { id: `r${formats.length + 1}`, width, height }; formats.push(format); }
    return format.id;
  };
  const assetIds = new Map();
  const assetLines = [];
  const assets = timeline.assets.filter(usable);
  const skipped = timeline.assets.filter((asset) => !usable(asset));
  if (skipped.length) warnings.push(`FCPXML cannot reference PNG sequences; ${skipped.length} overlay clip${skipped.length === 1 ? " is" : "s are"} left out (import media/overlays/<scene>/ as image sequences, or export with --overlays prores4444)`);
  for (const asset of assets) formatFor(asset);
  const assetIdBase = formats.length + 1;
  assets.forEach((asset, index) => {
    const id = `r${assetIdBase + index}`;
    assetIds.set(asset.id, id);
    const format = formatFor(asset);
    assetLines.push(element("asset", {
      id,
      name: asset.name,
      uid: uid(asset.path),
      start: "0s",
      duration: t(asset.duration),
      hasVideo: asset.hasVideo ? "1" : undefined,
      format: format ?? undefined,
      videoSources: asset.hasVideo ? "1" : undefined,
      hasAudio: asset.hasAudio ? "1" : undefined,
      audioSources: asset.hasAudio ? "1" : undefined,
      audioChannels: asset.hasAudio ? String(asset.audioChannels ?? 2) : undefined,
      audioRate: asset.hasAudio ? String(asset.audioRate ?? 48000) : undefined
    }, [element("media-rep", { kind: "original-media", src: mediaUrl(asset.path, options.absolute) }, null, "        ")], "      "));
  });
  const formatLines = formats.map((format) => element("format", {
    id: format.id,
    name: format.id === "r1" ? formatName(timeline) : undefined,
    frameDuration: frameDuration(rate),
    width: String(format.width),
    height: String(format.height),
    colorSpace: "1-1-1 (Rec. 709)"
  }, null, "      "));

  // ---- spine (V1)
  const v1 = timeline.tracks.find((track) => track.id === "V1");
  const spine = [];
  let cursor = 0;
  for (const item of [...(v1?.clips ?? [])].sort((a, b) => a.start - b.start)) {
    if (!assetIds.has(item.asset)) continue;
    if (item.start > cursor) spine.push({ kind: "gap", offset: cursor, duration: item.start - cursor, start: 0 });
    spine.push({ kind: "clip", clip: item, offset: item.start, duration: item.duration, start: item.in, track: v1 });
    cursor = item.start + item.duration;
  }
  if (cursor < timeline.duration) spine.push({ kind: "gap", offset: cursor, duration: timeline.duration - cursor, start: 0 });
  for (const item of spine) { item.anchored = []; item.markers = []; }
  const parentAt = (frame) => spine.find((item) => frame >= item.offset && frame < item.offset + item.duration) ?? spine.at(-1);
  const local = (parent, frame) => parent.start + (frame - parent.offset);

  // ---- connected clips
  const videoTracks = timeline.tracks.filter((track) => track.kind === "video");
  const audioTracks = timeline.tracks.filter((track) => track.kind === "audio");
  for (const track of timeline.tracks) {
    if (track.id === "V1") continue;
    const lane = track.kind === "video" ? videoTracks.indexOf(track) : -(audioTracks.indexOf(track) + 1);
    for (const item of track.clips) {
      if (item.linked) continue; // the linked V1 asset-clip already carries this audio
      if (!assetIds.has(item.asset)) continue;
      const parent = parentAt(item.start);
      parent.anchored.push({ track, clip: item, lane, offset: local(parent, item.start) });
    }
  }
  const captionLane = videoTracks.length;
  const role = `SRT?captionFormat=SRT.${timeline.captions?.language ?? "en"}`;
  for (const item of timeline.captions?.clips ?? []) {
    const parent = parentAt(item.start);
    parent.anchored.push({ caption: item, lane: captionLane, offset: local(parent, item.start) });
  }
  for (const marker of timeline.markers) {
    const parent = parentAt(marker.frame);
    parent.markers.push({ marker, start: local(parent, marker.frame) });
  }

  let styleCount = 0;
  const clipAttributes = (item, track, extra = {}) => ({
    name: item.name,
    ref: assetIds.get(item.asset),
    lane: extra.lane === undefined || extra.lane === 0 ? undefined : String(extra.lane),
    offset: t(extra.offset ?? item.start),
    duration: t(item.duration),
    start: t(item.in),
    enabled: track.enabled === false || item.enabled === false ? "0" : undefined,
    srcEnable: item.videoOnly ? "video" : undefined,
    audioRole: track.kind === "audio" || (item.kind === "base" && !item.videoOnly) ? track.kind === "audio" ? track.role : "dialogue" : undefined
  });
  const volume = (item, indent) => (typeof item.volume === "number" && Math.abs(item.volume - 1) > 1e-6 ? element("adjust-volume", { amount: `${decibels(item.volume)}dB` }, null, indent) : null);
  const anchoredLine = (entry, indent) => {
    if (entry.caption) {
      styleCount += 1;
      const id = `ts${styleCount}`;
      return element("caption", { name: entry.caption.name, lane: String(entry.lane), offset: t(entry.offset), duration: t(entry.caption.duration), role }, [
        `${indent}  <text placement="bottom"><text-style ref="${id}">${escapeText(entry.caption.text)}</text-style></text>`,
        element("text-style-def", { id }, [element("text-style", { font: ".AppleSystemUIFont", fontSize: "13", fontFace: "Regular", fontColor: "1 1 1 1", backgroundColor: "0 0 0 1" }, null, `${indent}    `)], `${indent}  `)
      ], indent);
    }
    return element("asset-clip", clipAttributes(entry.clip, entry.track, { lane: entry.lane, offset: entry.offset }), [volume(entry.clip, `${indent}  `)].filter(Boolean), indent);
  };
  const markerLine = ({ marker, start }, indent) => element("marker", { start: t(start), duration: t(1), value: marker.name, note: marker.note || undefined }, null, indent);
  const spineLines = spine.map((item) => {
    const indent = "                        ";
    const children = [];
    if (item.kind === "clip") { const level = volume(item.clip, `${indent}  `); if (level) children.push(level); }
    for (const entry of item.anchored.sort((a, b) => a.offset - b.offset || b.lane - a.lane)) children.push(anchoredLine(entry, `${indent}  `));
    for (const entry of item.markers.sort((a, b) => a.start - b.start)) children.push(markerLine(entry, `${indent}  `));
    if (item.kind === "gap") return element("gap", { name: "Gap", offset: t(item.offset), duration: t(item.duration), start: t(item.start) }, children, indent);
    return element("asset-clip", clipAttributes(item.clip, item.track, { offset: item.offset }), children, indent);
  });

  const event = options.event ?? "LaunchClip";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="${FCPXML_VERSION}">
    <resources>
${[...formatLines, ...assetLines].join("\n")}
    </resources>
    <library>
        <event name="${escapeAttr(event)}">
            <project name="${escapeAttr(options.project ?? timeline.name)}">
                <sequence format="r1" duration="${t(timeline.duration)}" tcStart="0s" tcFormat="${rate.dropFrame ? "DF" : "NDF"}" audioLayout="stereo" audioRate="48k">
                    <spine>
${spineLines.join("\n")}
                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>
`;
  return { xml, warnings };
}

/**
 * Read an FCPXML document written by writeFcpxml back into a flat timing list
 * for round-trip checks: {rate, duration, clips: [{name, ref, src, lane, start,
 * duration, in, enabled, role}], captions: [{start, duration, text}], markers: [{frame, name}]}
 * with every time in timeline frames (connected offsets resolved through
 * their parent).
 */
export function readFcpxml(xml) {
  const { root } = parseXml(xml);
  if (root.name !== "fcpxml") throw new Error(`root element is <${root.name}>, not <fcpxml>`);
  const resources = child(root, "resources");
  const sequence = findAll(root, "sequence")[0];
  if (!sequence) throw new Error("FCPXML has no <sequence>");
  const format = findAll(resources, "format").find((entry) => entry.attributes.id === sequence.attributes.format);
  if (!format) throw new Error(`sequence format ${sequence.attributes.format} is not in <resources>`);
  const [fdNum, fdDen] = format.attributes.frameDuration.replace(/s$/, "").split("/").map(Number);
  const rate = parseRate(`${fdDen}/${fdNum}`, { dropFrame: sequence.attributes.tcFormat === "DF" });
  const frames = (value) => fcpTimeToFrames(value ?? "0s", rate);
  const assets = new Map(findAll(resources, "asset").map((asset) => [asset.attributes.id, asset]));
  const out = { rate, duration: frames(sequence.attributes.duration), clips: [], captions: [], markers: [] };
  const spine = findAll(sequence, "spine")[0];
  for (const item of spine.children) {
    const offset = frames(item.attributes.offset);
    const start = frames(item.attributes.start);
    const toTimeline = (value) => offset + frames(value) - start;
    if (item.name === "asset-clip") out.clips.push(clipTiming(item, offset, 0));
    for (const nested of item.children) {
      if (nested.name === "asset-clip") out.clips.push(clipTiming(nested, toTimeline(nested.attributes.offset), Number(nested.attributes.lane ?? 0)));
      else if (nested.name === "caption") out.captions.push({ start: toTimeline(nested.attributes.offset), duration: frames(nested.attributes.duration), text: findAll(nested, "text-style").map((node) => node.text).join("").trim(), lane: Number(nested.attributes.lane ?? 0) });
      else if (nested.name === "marker") out.markers.push({ frame: toTimeline(nested.attributes.start), name: nested.attributes.value });
    }
  }
  return out;

  function clipTiming(node, start, lane) {
    const asset = assets.get(node.attributes.ref);
    return {
      name: node.attributes.name,
      ref: node.attributes.ref,
      src: child(asset, "media-rep")?.attributes.src ?? null,
      lane,
      start,
      duration: frames(node.attributes.duration),
      in: frames(node.attributes.start),
      enabled: node.attributes.enabled !== "0",
      role: node.attributes.audioRole ?? null
    };
  }
}

/**
 * Structural checks of an FCPXML document (used when Apple's DTD is not
 * available offline): version, resources referenced by id, element order the
 * DTD requires, frame-grid times, lanes, and connected clips inside their
 * parents' time. → list of problems ([] = valid).
 */
export function validateFcpxml(xml) {
  const problems = [];
  let doc;
  try { doc = parseXml(xml); } catch (error) { return [error.message]; }
  const { root, doctype } = doc;
  if (doctype !== "fcpxml") problems.push(`DOCTYPE must be fcpxml; got ${doctype}`);
  if (root.name !== "fcpxml") return [...problems, `root must be <fcpxml>; got <${root.name}>`];
  if (root.attributes.version !== FCPXML_VERSION) problems.push(`version must be ${FCPXML_VERSION}`);
  const order = root.children.map((node) => node.name);
  if (order[0] !== "resources") problems.push("<resources> must come first");
  if (!order.includes("library")) problems.push("missing <library>");
  const resources = child(root, "resources");
  const ids = new Map();
  for (const node of resources?.children ?? []) {
    if (!["format", "asset", "effect", "media"].includes(node.name)) problems.push(`unexpected <${node.name}> in <resources>`);
    if (!node.attributes.id) problems.push(`<${node.name}> needs an id`);
    else if (ids.has(node.attributes.id)) problems.push(`duplicate resource id ${node.attributes.id}`);
    else ids.set(node.attributes.id, node);
  }
  for (const asset of findAll(resources, "asset")) {
    const rep = child(asset, "media-rep");
    if (!rep?.attributes.src) problems.push(`asset ${asset.attributes.id} needs a <media-rep src>`);
    if (rep && rep.attributes.kind !== "original-media") problems.push(`asset ${asset.attributes.id} media-rep kind must be original-media`);
    if (asset.attributes.format && ids.get(asset.attributes.format)?.name !== "format") problems.push(`asset ${asset.attributes.id} names unknown format ${asset.attributes.format}`);
    if (!asset.attributes.hasVideo && !asset.attributes.hasAudio) problems.push(`asset ${asset.attributes.id} has neither video nor audio`);
  }
  const sequence = findAll(root, "sequence")[0];
  if (!sequence) return [...problems, "missing <sequence>"];
  const format = ids.get(sequence.attributes.format);
  if (format?.name !== "format") return [...problems, `sequence format ${sequence.attributes.format} is not a <format>`];
  let rate;
  try {
    const [num, den] = format.attributes.frameDuration.replace(/s$/, "").split("/").map(Number);
    rate = parseRate(`${den}/${num}`, { dropFrame: sequence.attributes.tcFormat === "DF" });
  } catch (error) { return [...problems, `frameDuration: ${error.message}`]; }
  if (!["DF", "NDF"].includes(sequence.attributes.tcFormat)) problems.push("sequence tcFormat must be DF or NDF");
  if (sequence.attributes.tcFormat === "DF" && !rate.ntsc) problems.push("DF timecode needs an NTSC rate");
  const frames = (value, where) => {
    try { return fcpTimeToFrames(value ?? "0s", rate); } catch (error) { problems.push(`${where}: ${error.message}`); return 0; }
  };
  const total = frames(sequence.attributes.duration, "sequence duration");
  const spine = child(sequence, "spine");
  if (!spine) return [...problems, "sequence has no <spine>"];
  let cursor = 0;
  const STORY = new Set(["asset-clip", "gap", "caption", "title", "clip", "ref-clip", "video", "audio", "spine"]);
  for (const item of spine.children) {
    if (!STORY.has(item.name)) { problems.push(`unexpected <${item.name}> in <spine>`); continue; }
    if (item.attributes.lane) problems.push(`spine element ${item.attributes.name} must not have a lane`);
    const offset = frames(item.attributes.offset, `${item.name} ${item.attributes.name} offset`);
    const duration = frames(item.attributes.duration, `${item.name} ${item.attributes.name} duration`);
    const start = frames(item.attributes.start, `${item.name} ${item.attributes.name} start`);
    if (offset !== cursor) problems.push(`spine element ${item.attributes.name} starts at frame ${offset}, expected ${cursor} (the primary storyline must be contiguous)`);
    if (duration <= 0) problems.push(`spine element ${item.attributes.name} needs a positive duration`);
    cursor = offset + duration;
    if (item.name === "asset-clip") checkRef(item);
    // DTD order inside a clip: intrinsic params (adjust-*), anchored items, markers.
    let phase = 0;
    for (const nested of item.children) {
      const kind = nested.name.startsWith("adjust-") ? 0 : nested.name === "marker" || nested.name === "chapter-marker" ? 2 : 1;
      if (kind < phase) problems.push(`<${nested.name}> is out of order inside ${item.attributes.name} (adjust-*, then connected clips, then markers)`);
      phase = Math.max(phase, kind);
      if (kind === 1) {
        if (!["asset-clip", "caption", "title", "clip", "video", "audio", "gap"].includes(nested.name)) problems.push(`unexpected <${nested.name}> inside ${item.attributes.name}`);
        if (!nested.attributes.lane || Number(nested.attributes.lane) === 0) problems.push(`connected ${nested.name} ${nested.attributes.name} needs a non-zero lane`);
        const at = frames(nested.attributes.offset, `${nested.attributes.name} offset`);
        if (at < start || at >= start + duration) problems.push(`connected ${nested.name} ${nested.attributes.name} offset ${at} is outside its parent's local range [${start}, ${start + duration})`);
        frames(nested.attributes.duration, `${nested.attributes.name} duration`);
        if (nested.name === "asset-clip") checkRef(nested);
        if (nested.name === "caption" && !/^(SRT|iTT|CEA608)\?captionFormat=/.test(nested.attributes.role ?? "")) problems.push(`caption ${nested.attributes.name} needs a caption role`);
      }
      if (kind === 2) {
        const at = frames(nested.attributes.start, `marker ${nested.attributes.value}`);
        if (at < start || at >= start + duration) problems.push(`marker ${nested.attributes.value} is outside its parent's local range`);
        if (!nested.attributes.value) problems.push("marker needs a value");
      }
    }
  }
  if (cursor !== total) problems.push(`the spine ends at frame ${cursor}, the sequence lasts ${total}`);
  const styles = findAll(root, "text-style-def").map((node) => node.attributes.id);
  if (new Set(styles).size !== styles.length) problems.push("text-style-def ids must be unique");
  return problems;

  function checkRef(node) {
    const asset = ids.get(node.attributes.ref);
    if (asset?.name !== "asset") { problems.push(`asset-clip ${node.attributes.name} references unknown asset ${node.attributes.ref}`); return; }
    const inPoint = frames(node.attributes.start, `${node.attributes.name} start`);
    const length = frames(node.attributes.duration, `${node.attributes.name} duration`);
    const available = frames(asset.attributes.duration, `asset ${asset.attributes.id} duration`);
    if (inPoint + length > available) problems.push(`asset-clip ${node.attributes.name} runs past its asset (${inPoint}+${length} > ${available} frames)`);
    if (node.attributes.audioRole && !/^(dialogue|music|effects)(\.|$)/.test(node.attributes.audioRole)) problems.push(`asset-clip ${node.attributes.name} has a non-standard audioRole ${node.attributes.audioRole}`);
  }
}

function formatName(timeline) {
  const { width, height, rate } = timeline;
  const standard = { "1920x1080": "1080p", "1280x720": "720p", "3840x2160": "2160p" }[`${width}x${height}`];
  const fps = rate.ntsc ? String(Math.round(rate.fps * 100)) : String(rate.timebase);
  return standard ? `FFVideoFormat${standard}${fps}` : undefined;
}

function mediaUrl(relativePath, absoluteRoot) {
  const encoded = String(relativePath).split("/").map(encodeURIComponent).join("/");
  if (!absoluteRoot) return encoded;
  const root = String(absoluteRoot).replace(/\/+$/, "").split("/").map(encodeURIComponent).join("/");
  return `file://${root}/${encoded}`;
}

function uid(value) {
  return createHash("md5").update(String(value)).digest("hex").toUpperCase();
}

function decibels(linear) {
  if (!(linear > 0)) return "-96";
  return (20 * Math.log10(linear)).toFixed(1);
}

const escapeAttr = escapeXml;
const escapeText = escapeXml;
