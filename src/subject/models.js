// Person segmentation models for the subject stage. Each runs on CPU through
// onnxruntime-node, which also backs HyperFrames' remove-background. Every
// model here is Apache-2.0; a model is added only after its licence is
// checked (docs/SUBJECT_EFFECTS_RFC.md §3).
//
// Weights live in $LAUNCHCLIP_HOME/models (default ~/.launchclip/models) and
// are fetched on first use, then verified against the pinned sha256.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pinnedHome } from "../state_dirs.js";

// input: how a frame becomes the model's tensor.
//   size: {width, height} fixed, or {shortEdge, multiple} keeping the aspect.
//   scale: "unit" (x / 255) or "max" (x / the frame's max value, as U²-Net was trained).
//   mean, std: per-channel normalisation after scaling.
// output: which output holds the alpha, and whether to stretch it to 0–1.
export const SUBJECT_MODELS = Object.freeze({
  modnet: Object.freeze({
    id: "modnet",
    name: "MODNet portrait matting",
    licence: "Apache-2.0",
    source: "https://github.com/ZHKKKe/MODNet (ONNX export: huggingface.co/Xenova/modnet)",
    url: "https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx",
    file: "modnet.onnx",
    bytes: 25888640,
    sha256: "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9",
    input: { name: "input", size: { shortEdge: 512, multiple: 32 }, scale: "unit", mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
    output: { name: "output", stretch: false }
  }),
  "mediapipe-selfie": Object.freeze({
    id: "mediapipe-selfie",
    name: "MediaPipe selfie segmentation",
    licence: "Apache-2.0",
    source: "https://github.com/google-ai-edge/mediapipe (ONNX export: huggingface.co/onnx-community/mediapipe_selfie_segmentation)",
    url: "https://huggingface.co/onnx-community/mediapipe_selfie_segmentation/resolve/main/onnx/model.onnx",
    file: "mediapipe-selfie.onnx",
    bytes: 462352,
    sha256: "3241ac4ad8aa35bdaf33946776db29f7c283a413aa0b0dacb9483594b4531aad",
    input: { name: "pixel_values", size: { width: 256, height: 256 }, scale: "unit", mean: [0, 0, 0], std: [1, 1, 1] },
    output: { name: "alphas", stretch: false }
  }),
  "u2net-human": Object.freeze({
    id: "u2net-human",
    name: "U²-Net human segmentation",
    licence: "Apache-2.0",
    source: "https://github.com/xuebinqin/U-2-Net (ONNX export: github.com/danielgatis/rembg)",
    url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx",
    file: "u2net_human_seg.onnx",
    bytes: 175997641,
    sha256: "01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c",
    input: { name: "input.1", size: { width: 320, height: 320 }, scale: "max", mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
    output: { name: "1959", stretch: true }
  })
});

// Pipelines combine models. modnet-fused takes MODNet's edges at a 384 px
// short edge and fills the holes MODNet punches in low-contrast clothing from
// MediaPipe's eroded mask, bounded to MODNet's body box (segment.js
// fuseSegmenters). It won the 2026-10-24 bake-off (RFC §4.2).
export const SUBJECT_PIPELINES = Object.freeze({
  "modnet-fused": Object.freeze({ id: "modnet-fused", name: "MODNet edges with MediaPipe fill", primary: "modnet", shortEdge: 384, fill: "mediapipe-selfie" })
});

// Mattes use the pipeline; the probe only needs presence and framing, so it
// uses the fast MediaPipe model alone (about 13 ms a frame).
export const DEFAULT_SUBJECT_MODEL = "modnet-fused";
export const DEFAULT_PROBE_MODEL = "mediapipe-selfie";

export function subjectModel(id = "modnet") {
  const model = SUBJECT_MODELS[id];
  if (!model) throw new Error(`Unknown subject model "${id}". Known models: ${Object.keys(SUBJECT_MODELS).join(", ")}`);
  return model;
}

/** A pipeline or a single model as a pipeline: {id, primary, shortEdge?, fill?, models: [model ids]}. */
export function subjectPipeline(id = DEFAULT_SUBJECT_MODEL) {
  const pipeline = SUBJECT_PIPELINES[id];
  if (pipeline) return { ...pipeline, models: [pipeline.primary, ...(pipeline.fill ? [pipeline.fill] : [])] };
  if (SUBJECT_MODELS[id]) return { id, primary: id, models: [id] };
  throw new Error(`Unknown subject model "${id}". Known models: ${[...Object.keys(SUBJECT_PIPELINES), ...Object.keys(SUBJECT_MODELS)].join(", ")}`);
}

/** ~/.launchclip/models, or $LAUNCHCLIP_HOME/models. */
export function modelsDir({ home, env = process.env } = {}) {
  if (!home && pinnedHome("models")) return pinnedHome("models");
  return path.join(home ?? env.LAUNCHCLIP_HOME ?? path.join(os.homedir(), ".launchclip"), "models");
}

export function modelPath(id, options = {}) {
  return path.join(options.dir ?? modelsDir(options), subjectModel(id).file);
}

/** → {id, installed, models: [{id, path, installed}]} without touching the network. */
export async function modelStatus(id = DEFAULT_SUBJECT_MODEL, options = {}) {
  const models = [];
  for (const modelId of subjectPipeline(id).models) {
    const file = modelPath(modelId, options);
    let installed = false;
    try {
      installed = (await stat(file)).size === subjectModel(modelId).bytes;
    } catch {}
    models.push({ id: modelId, path: file, installed });
  }
  return { id, installed: models.every((model) => model.installed), models };
}

/** Every model a pipeline needs, downloaded and verified. → {modelId: path} */
export async function ensurePipeline(id = DEFAULT_SUBJECT_MODEL, options = {}) {
  const files = {};
  for (const modelId of subjectPipeline(id).models) files[modelId] = await ensureModel(modelId, options);
  return files;
}

/**
 * The model's local path, downloading and verifying it when missing.
 * download: false makes a missing model an error instead.
 */
export async function ensureModel(id, { download = true, fetchImpl = fetch, log = () => {}, ...options } = {}) {
  const model = subjectModel(id);
  const file = modelPath(id, options);
  if ((await modelStatus(id, options)).installed && (await sha256File(file)) === model.sha256) return file;
  if (!download) throw new Error(`The ${model.name} model is not installed at ${file}. Run: launchclip subject setup --model ${id}`);
  await mkdir(path.dirname(file), { recursive: true });
  log(`Downloading ${model.name} (${Math.round(model.bytes / 1e5) / 10} MB, ${model.licence}) from ${model.url}`);
  const response = await fetchImpl(model.url);
  if (!response.ok || !response.body) throw new Error(`Could not download ${model.url}: HTTP ${response.status}`);
  const partial = `${file}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const digest = await sha256File(partial);
  if (digest !== model.sha256) {
    await rm(partial, { force: true });
    throw new Error(`${model.file} failed verification (sha256 ${digest}, expected ${model.sha256})`);
  }
  await rename(partial, file);
  return file;
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

export async function onnxRuntimeAvailable() {
  try {
    await import("onnxruntime-node");
    return true;
  } catch {
    return false;
  }
}

