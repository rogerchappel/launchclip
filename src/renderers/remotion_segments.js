// Remotion segment rendering for the partial-render loop (src/render_segments.js).
//
// Every segment is rendered through the Remotion API (one bundle, one browser,
// one selectComposition for all of them) with `frameRange`, video-only, as a
// lossless H.264 mezzanine: libx264 -qp 0, yuv420p, a fresh IDR at frame 0 of
// each file. Lossless segments join with a stream copy, and one delivery encode
// with exactly the settings `remotion render` uses (same codec, pixel format,
// CRF and preset, through Remotion's own bundled FFmpeg/x264) then gives the
// same frames as a full render: the delivery encoder sees the same yuv420p
// pictures in the same order. Encoding each segment at the delivery CRF and
// joining those instead differs from a full render by x264 rate control at
// every join (per-frame SSIM down to 0.99), so the mezzanine is what makes the
// partial render frame-identical.
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const REMOTION_VERSION = require("@remotion/renderer/package.json").version;
const COMPOSITION_ID = "LaunchclipStory";

/** Mezzanine settings: lossless, so segment joins are invisible after the delivery encode. */
export const MEZZANINE = Object.freeze({ codec: "h264", encoder: "libx264", qp: 0, x264Preset: "ultrafast", pixelFormat: "yuv420p" });

/**
 * The delivery encode settings of `remotion render` for each finish quality
 * (src/renderers/remotion.js renderArgs): draft passes --crf 28
 * --x264-preset veryfast; high leaves Remotion's defaults (CRF 18 for H.264,
 * x264's default preset).
 */
export const DELIVERY = Object.freeze({
  draft: Object.freeze({ crf: 28, x264Preset: "veryfast" }),
  high: Object.freeze({ crf: 18, x264Preset: null })
});

export function deliverySettings(quality = "draft") {
  const settings = DELIVERY[String(quality)];
  if (!settings) throw new Error(`unknown quality "${quality}" (draft or high)`);
  return settings;
}

/**
 * ffmpegOverride for renderMedia: in the encoding pass the default `-crf N`
 * becomes `-qp 0` (lossless); the later stream-copy (stitch) pass is left alone.
 */
export function losslessArgs(args) {
  const out = [...args];
  const encoder = out.indexOf("-c:v");
  if (encoder >= 0 && out[encoder + 1] === "copy") return out;
  if (encoder < 0 || out[encoder + 1] !== "libx264") throw new Error(`lossless segments need libx264; Remotion chose ${out[encoder + 1] ?? "no encoder"}`);
  const crf = out.indexOf("-crf");
  if (crf >= 0) out.splice(crf, 2, "-qp", String(MEZZANINE.qp));
  else out.splice(encoder + 2, 0, "-qp", String(MEZZANINE.qp));
  return out;
}

/** FFmpeg arguments of the delivery encode (video only). */
export function deliveryArgs(input, output, quality = "draft") {
  const { crf, x264Preset } = deliverySettings(quality);
  return ["-y", "-hide_banner", "-loglevel", "error", "-i", path.resolve(input), "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(x264Preset ? ["-preset", x264Preset] : []), "-video_track_timescale", "90000", "-crf", String(crf), "-an", "-map_metadata", "-1", path.resolve(output)];
}

// Bundles are cached outside the project (the project is the bundle's public
// dir, linked rather than copied, so a bundle inside it would link to itself).
// The key covers the kit sources, the entry and the font files the bundle
// lists through getStaticFiles().
async function cachedBundle({ entry, project, kitHash, bundleRoot }) {
  const fonts = await listFonts(project);
  const key = createHash("sha256").update(JSON.stringify({ remotion: REMOTION_VERSION, entry: path.resolve(entry), project: path.resolve(project), kitHash, fonts })).digest("hex").slice(0, 24);
  const root = bundleRoot ?? path.join(os.tmpdir(), "launchclip-remotion-bundles");
  const dir = path.join(root, key);
  if (existsSync(path.join(dir, "index.html")) && existsSync(path.join(dir, "bundle.js"))) return { serveUrl: dir, cached: true };
  await mkdir(root, { recursive: true });
  const temporary = path.join(root, `${key}.${process.pid}.${Date.now()}`);
  const { bundle } = await import("@remotion/bundler");
  await bundle({ entryPoint: path.resolve(entry), publicDir: path.resolve(project), symlinkPublicDir: true, outDir: temporary, enableCaching: true, onProgress: () => {} });
  await rm(dir, { recursive: true, force: true });
  await rename(temporary, dir);
  return { serveUrl: dir, cached: false };
}

async function listFonts(project) {
  try { return (await readdir(path.join(project, "assets", "fonts"))).sort(); }
  catch { return []; }
}

/**
 * Render segments of the LaunchclipStory composition.
 * segments: [{startFrame, endFrame (exclusive), output}]
 * Calls onSegment(segment, seconds) after each one. Returns
 * {bundle: {cached, seconds}, segments: [{output, seconds}]}.
 */
export async function renderRemotionSegments({ entry, project, props, segments, kitHash, concurrency, bundleRoot, onSegment, logLevel = "error" }) {
  const { openBrowser, renderMedia, selectComposition } = await import("@remotion/renderer");
  const bundleStarted = performance.now();
  const { serveUrl, cached } = await cachedBundle({ entry, project, kitHash, bundleRoot });
  const bundleSeconds = (performance.now() - bundleStarted) / 1000;
  const results = [];
  if (!segments.length) return { bundle: { cached, seconds: bundleSeconds }, segments: results };
  const browser = await openBrowser("chrome", { logLevel });
  try {
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props, puppeteerInstance: browser, logLevel });
    for (const segment of segments) {
      const started = performance.now();
      await mkdir(path.dirname(segment.output), { recursive: true });
      await renderMedia({
        serveUrl,
        composition,
        inputProps: props,
        codec: MEZZANINE.codec,
        pixelFormat: MEZZANINE.pixelFormat,
        x264Preset: MEZZANINE.x264Preset,
        muted: true,
        frameRange: [segment.startFrame, segment.endFrame - 1],
        outputLocation: path.resolve(segment.output),
        overwrite: true,
        puppeteerInstance: browser,
        logLevel,
        ...(concurrency != null && concurrency !== "auto" ? { concurrency: Number(concurrency) || concurrency } : {}),
        ffmpegOverride: ({ args }) => losslessArgs(args)
      });
      const seconds = (performance.now() - started) / 1000;
      results.push({ output: segment.output, seconds });
      onSegment?.(segment, seconds);
    }
  } finally {
    await browser.close({ silent: true }).catch(() => {});
  }
  return { bundle: { cached, seconds: bundleSeconds }, segments: results };
}

/**
 * The whole soundtrack as Remotion mixes it (an audio-only render). Used when
 * a footage base plays its own audio under the mix, which a plain mux of
 * audio.mix cannot reproduce.
 */
export async function renderRemotionAudio({ entry, project, props, output, kitHash, bundleRoot, logLevel = "error" }) {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const { serveUrl } = await cachedBundle({ entry, project, kitHash, bundleRoot });
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props, logLevel });
  await mkdir(path.dirname(output), { recursive: true });
  await renderMedia({ serveUrl, composition, inputProps: props, codec: "aac", outputLocation: path.resolve(output), overwrite: true, logLevel });
  return { output };
}

/**
 * Encode the joined mezzanine with the delivery settings, through Remotion's
 * bundled FFmpeg (the x264 build `remotion render` encodes with).
 */
export async function encodeRemotionDelivery(input, output, { quality = "draft" } = {}) {
  const args = deliveryArgs(input, output, quality);
  const { RenderInternals } = await import("@remotion/renderer");
  if (typeof RenderInternals?.callFf !== "function") throw new Error("@remotion/renderer no longer exposes its FFmpeg (RenderInternals.callFf)");
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await RenderInternals.callFf({ bin: "ffmpeg", args, indent: false, logLevel: "error", binariesDirectory: null, cancelSignal: undefined });
  return { output: path.resolve(output), args };
}

export function remotionSegmentInfo() {
  return { remotion: REMOTION_VERSION, mezzanine: MEZZANINE, delivery: DELIVERY };
}
