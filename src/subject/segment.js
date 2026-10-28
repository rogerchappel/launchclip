// One frame in, one alpha mask out. The frame is RGB24 at any size; the mask
// comes back at the same size as 0–255 values. Inference runs at the model's
// own resolution and the mask is scaled back with bilinear filtering.

import { maskStats } from "@launchclip/core/subject.mjs";
import { ensurePipeline, subjectModel, subjectPipeline } from "./models.js";

/**
 * → {model, inputSize(width, height), segment(rgb, width, height) → Promise<Uint8Array>, release()}
 * modelFile: the verified .onnx path (ensureModel). smooth: 0–0.9 blends each
 * mask with the previous one to damp flicker (0 = off). shortEdge overrides
 * the inference size of models that keep the aspect (faster, softer edges).
 */
export async function createSegmenter(modelId, modelFile, { smooth = 0, threads, shortEdge } = {}) {
  const base = subjectModel(modelId);
  const model = shortEdge && base.input.size.shortEdge ? { ...base, input: { ...base.input, size: { ...base.input.size, shortEdge: Number(shortEdge) } } } : base;
  const ort = await loadRuntime();
  const session = await ort.InferenceSession.create(modelFile, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
    ...(threads ? { intraOpNumThreads: threads } : {})
  });
  let previous = null;
  const segmenter = {
    model,
    inputSize: (width, height) => inputSize(model.input.size, width, height),
    async segment(rgb, width, height) {
      const { alpha, width: sw, height: sh } = await segmenter.segmentSmall(rgb, width, height);
      return resizeAlpha(alpha, sw, sh, width, height);
    },
    // The mask at the model's own resolution: {alpha: Float32Array 0–1, width, height}.
    async segmentSmall(rgb, width, height) {
      const size = inputSize(model.input.size, width, height);
      const tensor = new ort.Tensor("float32", toTensor(rgb, width, height, size, model.input), [1, 3, size.height, size.width]);
      const outputs = await session.run({ [model.input.name]: tensor });
      const raw = outputs[model.output.name].data;
      let small = model.output.stretch ? stretch(raw) : raw;
      if (smooth > 0 && previous && previous.length === small.length) {
        const blended = new Float32Array(small.length);
        for (let i = 0; i < small.length; i += 1) blended[i] = small[i] * (1 - smooth) + previous[i] * smooth;
        small = blended;
      }
      previous = small;
      return { alpha: small, width: size.width, height: size.height };
    },
    async release() {
      await session.release?.();
    }
  };
  return segmenter;
}

/**
 * Edges from `primary`, body from `filler`: the filler's mask is eroded by
 * `erode` of its own pixels, so only its confident interior survives, and
 * the result is the per-pixel maximum of the two. This fills the holes a
 * matting model can punch in low-contrast clothing without taking on the
 * filler's looser edges. The filler only counts inside the primary's body
 * box (padded by `pad` of the frame), so its stray blobs elsewhere (a lamp,
 * a chair) never enter the matte. Same interface as createSegmenter.
 */
export function fuseSegmenters(primary, filler, { erode = 3, pad = 0.02 } = {}) {
  return {
    model: primary.model,
    filler: filler.model,
    inputSize: primary.inputSize,
    async segment(rgb, width, height) {
      const edges = await primary.segment(rgb, width, height);
      const body = await filler.segmentSmall(rgb, width, height);
      const box = maskStats(sampleMask(edges, width, height, 180), 180, Math.max(2, Math.round((180 * height) / width))).body;
      if (!box) return edges;
      const interior = resizeAlpha(erodeAlpha(body.alpha, body.width, body.height, erode), body.width, body.height, width, height);
      const x0 = Math.max(0, Math.floor((box.x - box.w / 2 - pad) * width));
      const x1 = Math.min(width, Math.ceil((box.x + box.w / 2 + pad) * width));
      const y0 = Math.max(0, Math.floor((box.y - box.h / 2 - pad) * height));
      const y1 = Math.min(height, Math.ceil((box.y + box.h / 2 + pad) * height));
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = y * width + x;
          if (interior[i] > edges[i]) edges[i] = interior[i];
        }
      }
      return edges;
    },
    async release() {
      await primary.release();
      await filler.release();
    }
  };
}

// Nearest-neighbour copy of a byte mask at `targetWidth` wide.
function sampleMask(alpha, width, height, targetWidth) {
  const targetHeight = Math.max(2, Math.round((targetWidth * height) / width));
  const out = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) out[y * targetWidth + x] = alpha[sy * width + Math.min(width - 1, Math.floor(((x + 0.5) * width) / targetWidth))];
  }
  return out;
}

// Separable min filter (square kernel of radius r) on a float mask.
export function erodeAlpha(alpha, width, height, radius) {
  if (radius <= 0) return alpha;
  const horizontal = new Float32Array(alpha.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let min = 1;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const value = alpha[y * width + Math.min(width - 1, Math.max(0, x + dx))];
        if (value < min) min = value;
      }
      horizontal[y * width + x] = min;
    }
  }
  const out = new Float32Array(alpha.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let min = 1;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const value = horizontal[Math.min(height - 1, Math.max(0, y + dy)) * width + x];
        if (value < min) min = value;
      }
      out[y * width + x] = min;
    }
  }
  return out;
}

/**
 * The segmenter for a pipeline or model id, fetching its models as needed.
 * options: ensureModel options plus {smooth, threads, shortEdge}.
 */
export async function createSubjectSegmenter(id, options = {}) {
  const pipeline = subjectPipeline(id);
  const files = await ensurePipeline(id, options);
  const primary = await createSegmenter(pipeline.primary, files[pipeline.primary], { ...options, shortEdge: options.shortEdge ?? pipeline.shortEdge });
  if (!pipeline.fill) return primary;
  return fuseSegmenters(primary, await createSegmenter(pipeline.fill, files[pipeline.fill], { threads: options.threads }));
}

async function loadRuntime() {
  try {
    const module = await import("onnxruntime-node");
    return module.default ?? module;
  } catch (error) {
    throw new Error(`The subject stage needs onnxruntime-node, which did not load (${error.message}). Reinstall LaunchClip, then run: launchclip doctor`);
  }
}

export function inputSize(size, width, height) {
  if (size.width && size.height) return { width: size.width, height: size.height };
  const scale = size.shortEdge / Math.min(width, height);
  const snap = (value) => Math.max(size.multiple, Math.round((value * scale) / size.multiple) * size.multiple);
  return { width: snap(width), height: snap(height) };
}

// RGB24 → NCHW float32 at the model size (bilinear), scaled and normalised.
export function toTensor(rgb, width, height, size, input) {
  const { width: tw, height: th } = size;
  const plane = tw * th;
  const out = new Float32Array(plane * 3);
  let max = 255;
  if (input.scale === "max") {
    max = 1;
    for (let i = 0; i < width * height * 3; i += 1) if (rgb[i] > max) max = rgb[i];
  }
  const sx = width / tw;
  const sy = height / th;
  for (let y = 0; y < th; y += 1) {
    const fy = Math.min(height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < tw; x += 1) {
      const fx = Math.min(width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = fx - x0;
      for (let c = 0; c < 3; c += 1) {
        const a = rgb[(y0 * width + x0) * 3 + c];
        const b = rgb[(y0 * width + x1) * 3 + c];
        const d = rgb[(y1 * width + x0) * 3 + c];
        const e = rgb[(y1 * width + x1) * 3 + c];
        const value = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
        out[c * plane + y * tw + x] = (value / max - input.mean[c]) / input.std[c];
      }
    }
  }
  return out;
}

// Float alpha (0–1) at sw × sh → Uint8 at dw × dh, bilinear.
export function resizeAlpha(alpha, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y += 1) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x += 1) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const value = (alpha[y0 * sw + x0] * (1 - wx) + alpha[y0 * sw + x1] * wx) * (1 - wy) + (alpha[y1 * sw + x0] * (1 - wx) + alpha[y1 * sw + x1] * wx) * wy;
      out[y * dw + x] = Math.max(0, Math.min(255, Math.round(value * 255)));
    }
  }
  return out;
}

function stretch(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = (values[i] - min) / range;
  return out;
}
