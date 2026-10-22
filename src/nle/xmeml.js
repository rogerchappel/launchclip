// Final Cut Pro 7 XML (xmeml version 4) writer for the NLE timeline model, the
// interchange Adobe Premiere Pro imports (File > Import) and DaVinci Resolve
// reads as "FCP 7 XML".
//
// Every timeline track becomes one <track>; clips carry start/end (timeline
// frames) and in/out (source frames) on the sequence rate. NTSC rates use the
// nominal timebase with <ntsc>TRUE</ntsc> and drop-frame timecode. Each media
// file is described once (<file id> with <pathurl>, a relative path unless
// absolute URLs are asked for) and referenced by id afterwards. Footage-led
// base clips are linked to their recording audio on A1. Overlay clips declare
// <alphatype>straight</alphatype>. Captions are not representable in xmeml:
// the export writes captions.srt beside it (Premiere: File > Import, then drag
// to the timeline as a caption track).
import { framesToTimecode, parseRate } from "./time.js";
import { child, childText, element, findAll, parseXml, textElement } from "./xml.js";

export const XMEML_VERSION = "4";

/** timeline → {xml, warnings}. options: {absolute: root for absolute file:// URLs} */
export function writeXmeml(timeline, options = {}) {
  const rate = timeline.rate;
  const warnings = [];
  const rateXml = (indent) => element("rate", {}, [textElement("timebase", rate.timebase, `${indent}  `), textElement("ntsc", rate.ntsc ? "TRUE" : "FALSE", `${indent}  `)], indent);
  const timecodeXml = (indent) => element("timecode", {}, [
    rateXml(`${indent}  `),
    textElement("string", framesToTimecode(0, rate), `${indent}  `),
    textElement("frame", 0, `${indent}  `),
    textElement("displayformat", rate.dropFrame ? "DF" : "NDF", `${indent}  `)
  ], indent);
  const assets = new Map(timeline.assets.map((asset) => [asset.id, asset]));
  const described = new Set();
  const fileIds = new Map(timeline.assets.map((asset, index) => [asset.id, `file-${index + 1}`]));
  const skipped = timeline.assets.filter((asset) => asset.kind === "image-sequence");
  if (skipped.length) warnings.push(`xmeml cannot reference PNG sequences; ${skipped.length} overlay clip${skipped.length === 1 ? " is" : "s are"} left out (export with --overlays prores4444 for Premiere)`);
  const fileXml = (asset, indent) => {
    const id = fileIds.get(asset.id);
    if (described.has(asset.id)) return element("file", { id }, null, indent);
    described.add(asset.id);
    const media = [];
    if (asset.hasVideo) media.push(element("video", {}, [element("samplecharacteristics", {}, [
      rateXml(`${indent}      `),
      textElement("width", asset.width ?? timeline.width, `${indent}      `),
      textElement("height", asset.height ?? timeline.height, `${indent}      `),
      textElement("anamorphic", "FALSE", `${indent}      `),
      textElement("pixelaspectratio", "square", `${indent}      `),
      textElement("fielddominance", "none", `${indent}      `)
    ], `${indent}    `)], `${indent}  `));
    if (asset.hasAudio) media.push(element("audio", {}, [
      element("samplecharacteristics", {}, [textElement("depth", 16, `${indent}      `), textElement("samplerate", asset.audioRate ?? 48000, `${indent}      `)], `${indent}    `),
      textElement("channelcount", asset.audioChannels ?? 2, `${indent}    `)
    ], `${indent}  `));
    return element("file", { id }, [
      textElement("name", asset.path.split("/").pop(), `${indent}  `),
      textElement("pathurl", fileUrl(asset.path, options.absolute), `${indent}  `),
      rateXml(`${indent}  `),
      textElement("duration", asset.duration, `${indent}  `),
      timecodeXml(`${indent}  `),
      element("media", {}, media, `${indent}  `)
    ], indent);
  };

  let clipCount = 0;
  const clipIds = new Map();
  const idFor = (item) => {
    if (!clipIds.has(item.id)) clipIds.set(item.id, `clipitem-${++clipCount}`);
    return clipIds.get(item.id);
  };
  // Footage-led links: V1 clip ↔ its A1 recording audio.
  const links = new Map();
  for (const track of timeline.tracks) for (const item of track.clips) if (item.linked) {
    links.set(item.linked, item);
    links.set(item.id, timeline.tracks.flatMap((entry) => entry.clips).find((other) => other.id === item.linked));
  }
  const videoTracks = timeline.tracks.filter((track) => track.kind === "video");
  const audioTracks = timeline.tracks.filter((track) => track.kind === "audio");
  const clipXml = (item, track, indent) => {
    const asset = assets.get(item.asset);
    const enabled = track.enabled !== false && item.enabled !== false;
    const children = [
      textElement("masterclipid", `masterclip-${fileIds.get(asset.id).slice(5)}`, `${indent}  `),
      textElement("name", item.name, `${indent}  `),
      textElement("enabled", enabled ? "TRUE" : "FALSE", `${indent}  `),
      textElement("duration", asset.duration, `${indent}  `),
      rateXml(`${indent}  `),
      textElement("start", item.start, `${indent}  `),
      textElement("end", item.start + item.duration, `${indent}  `),
      textElement("in", item.in, `${indent}  `),
      textElement("out", item.in + item.duration, `${indent}  `)
    ];
    if (track.kind === "video") children.push(textElement("alphatype", item.alpha ? "straight" : "none", `${indent}  `));
    children.push(fileXml(asset, `${indent}  `));
    children.push(element("sourcetrack", {}, [textElement("mediatype", track.kind, `${indent}    `), textElement("trackindex", 1, `${indent}    `)], `${indent}  `));
    if (track.kind === "audio" && typeof item.volume === "number" && Math.abs(item.volume - 1) > 1e-6) {
      children.push(element("filter", {}, [element("effect", {}, [
        textElement("name", "Audio Levels", `${indent}      `),
        textElement("effectid", "audiolevels", `${indent}      `),
        textElement("effectcategory", "audiolevels", `${indent}      `),
        textElement("effecttype", "audiolevels", `${indent}      `),
        textElement("mediatype", "audio", `${indent}      `),
        element("parameter", {}, [
          textElement("parameterid", "level", `${indent}        `),
          textElement("name", "Level", `${indent}        `),
          textElement("valuemin", 0, `${indent}        `),
          textElement("valuemax", 3.98109, `${indent}        `),
          textElement("value", round5(item.volume), `${indent}        `)
        ], `${indent}      `)
      ], `${indent}    `)], `${indent}  `));
    }
    const partner = links.get(item.id);
    if (partner) {
      const pairs = track.kind === "video" ? [[item, "video", videoTracks.indexOf(track) + 1], [partner, "audio", audioTracks.findIndex((entry) => entry.clips.includes(partner)) + 1]] : [[partner, "video", videoTracks.findIndex((entry) => entry.clips.includes(partner)) + 1], [item, "audio", audioTracks.indexOf(track) + 1]];
      for (const [target, mediatype, trackindex] of pairs) {
        const clipindex = timeline.tracks.find((entry) => entry.clips.includes(target)).clips.indexOf(target) + 1;
        children.push(element("link", {}, [
          textElement("linkclipref", idFor(target), `${indent}    `),
          textElement("mediatype", mediatype, `${indent}    `),
          textElement("trackindex", trackindex, `${indent}    `),
          textElement("clipindex", clipindex, `${indent}    `)
        ], `${indent}  `));
      }
    }
    return element("clipitem", { id: idFor(item) }, children, indent);
  };
  const trackXml = (track, indent) => {
    const clips = track.clips.filter((item) => assets.get(item.asset)?.kind !== "image-sequence").sort((a, b) => a.start - b.start).map((item) => clipXml(item, track, `${indent}  `));
    return element("track", {}, [...clips, textElement("enabled", track.enabled === false ? "FALSE" : "TRUE", `${indent}  `), textElement("locked", "FALSE", `${indent}  `)], indent);
  };

  const markers = timeline.markers.map((marker) => element("marker", {}, [
    textElement("name", marker.name, "      "),
    textElement("comment", marker.note ?? "", "      "),
    textElement("in", marker.frame, "      "),
    textElement("out", -1, "      ")
  ], "    "));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
${element("xmeml", { version: XMEML_VERSION }, [element("sequence", { id: "sequence-1" }, [
    textElement("uuid", sequenceUuid(timeline), "    "),
    textElement("name", timeline.name, "    "),
    textElement("duration", timeline.duration, "    "),
    rateXml("    "),
    timecodeXml("    "),
    element("media", {}, [
      element("video", {}, [
        element("format", {}, [element("samplecharacteristics", {}, [
          rateXml("          "),
          textElement("width", timeline.width, "          "),
          textElement("height", timeline.height, "          "),
          textElement("anamorphic", "FALSE", "          "),
          textElement("pixelaspectratio", "square", "          "),
          textElement("fielddominance", "none", "          ")
        ], "        ")], "      "),
        ...videoTracks.map((track) => trackXml(track, "      "))
      ], "    "),
      element("audio", {}, [
        textElement("numOutputChannels", 2, "      "),
        element("format", {}, [element("samplecharacteristics", {}, [textElement("depth", 16, "          "), textElement("samplerate", 48000, "          ")], "        ")], "      "),
        ...audioTracks.map((track) => trackXml(track, "      "))
      ], "    ")
    ], "    "),
    ...markers
  ], "  ")])}
`;
  return { xml, warnings };
}

/**
 * Read an xmeml document back: {rate, duration, video: [track], audio: [track],
 * markers} where track = {enabled, clips: [{id, name, start, end, in, out,
 * enabled, pathurl, alphatype, links}]}. File references resolve through ids.
 */
export function readXmeml(xml) {
  const { root } = parseXml(xml);
  if (root.name !== "xmeml") throw new Error(`root element is <${root.name}>, not <xmeml>`);
  const sequence = child(root, "sequence");
  const rateNode = child(sequence, "rate");
  const timebase = Number(childText(rateNode, "timebase"));
  const ntsc = childText(rateNode, "ntsc") === "TRUE";
  const displayformat = childText(child(sequence, "timecode"), "displayformat");
  const rate = parseRate(ntsc ? `${timebase * 1000}/1001` : String(timebase), { dropFrame: displayformat === "DF" });
  const files = new Map();
  for (const file of findAll(sequence, "file")) if (child(file, "pathurl")) files.set(file.attributes.id, childText(file, "pathurl"));
  const media = child(sequence, "media");
  const tracks = (kind) => findAll(child(media, kind) ?? { children: [] }, "track").map((track) => ({
    enabled: childText(track, "enabled") !== "FALSE",
    clips: track.children.filter((node) => node.name === "clipitem").map((clip) => ({
      id: clip.attributes.id,
      name: childText(clip, "name"),
      start: Number(childText(clip, "start")),
      end: Number(childText(clip, "end")),
      in: Number(childText(clip, "in")),
      out: Number(childText(clip, "out")),
      enabled: childText(clip, "enabled") !== "FALSE",
      pathurl: files.get(child(clip, "file")?.attributes.id) ?? null,
      alphatype: childText(clip, "alphatype"),
      links: clip.children.filter((node) => node.name === "link").map((link) => childText(link, "linkclipref"))
    }))
  }));
  return {
    rate,
    duration: Number(childText(sequence, "duration")),
    video: tracks("video"),
    audio: tracks("audio"),
    markers: sequence.children.filter((node) => node.name === "marker").map((marker) => ({ name: childText(marker, "name"), frame: Number(childText(marker, "in")) }))
  };
}

function fileUrl(relativePath, absoluteRoot) {
  const encoded = String(relativePath).split("/").map(encodeURIComponent).join("/");
  if (!absoluteRoot) return encoded;
  const root = String(absoluteRoot).replace(/\/+$/, "").split("/").map(encodeURIComponent).join("/");
  return `file://localhost${root}/${encoded}`;
}

function sequenceUuid(timeline) {
  // Deterministic, so golden snapshots stay stable.
  let hash = 0x811c9dc5;
  for (const char of `${timeline.name}:${timeline.duration}:${timeline.width}x${timeline.height}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  const hex = hash.toString(16).padStart(8, "0");
  return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(4, 7)}-${hex}${hex.slice(0, 4)}`.toUpperCase();
}

function round5(value) {
  return Math.round(value * 1e5) / 1e5;
}
