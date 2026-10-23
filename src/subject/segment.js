// One frame in, one alpha mask out. The frame is RGB24 at any size; the mask
// comes back at the same size as 0–255 values. Inference runs at the model's
// own resolution and the mask is scaled back with bilinear filtering.

import { subjectModel } from "./models.js";

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
  return {
    model,
    inputSize: (width, height) => inputSize(model.input.size, width, height),
    async segment(rgb, width, height) {
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
      return resizeAlpha(small, size.width, size.height, width, height);
    },
    async release() {
      await session.release?.();
    }
  };
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
