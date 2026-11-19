// fal.ai provider adapter (docs/GENERATED_FOOTAGE_RFC.md §5, §5.1): one
// adapter for many hosted models. Text to image ("image" step) and image to
// video ("video" step), through fal's queue API with plain fetch.
//
//   const fal = createFalProvider({imageModel, videoModel, draftVideoModel?, fetch?, env?});
//   const job = await fal.submit(brief, 'image', 'final', {signal});
//   while ((await fal.poll(job)).state !== 'done') …   // 'failed' carries error
//   const {file, seed, model, licence} = await fal.fetch(job, outDir);
//
// Models are the user's choice, as fal endpoint ids, and nothing is chosen
// for them: e.g. imageModel 'fal-ai/flux/dev', videoModel
// 'fal-ai/kling-video/o3/standard/image-to-video' or 'fal-ai/veo3.1/image-to-video'.
// draftVideoModel, when set, is used for the 'draft' tier of the video step.
// The key comes from FAL_KEY in env only; it is sent in the Authorization
// header to fal and never logged, returned or written anywhere.
//
// How the brief maps to fal inputs. Each model has its own input schema, so
// the adapter reads it from fal's model metadata (OpenAPI) and only sends a
// field the model takes:
//   image: prompt, image_size {width, height} (or aspect_ratio when the model takes only that), negative_prompt (if taken),
//          references as image_urls (if taken; otherwise not sent).
//   video: prompt (motion and camera only), image_url = the start frame,
//          duration = seconds + pad_seconds at each end, rounded up to the
//          model's nearest allowed value (fal models take enum strings such
//          as "5" or "6s"), aspect_ratio from the image size (if taken),
//          negative_prompt from the image half (if taken).
// Local files (start frame, references) go inline as base64 data: URIs,
// which fal accepts for any URL input; fal's documented upload is SDK-only.
//
// quote() reads fal's pricing endpoint. When the unit is one it can't turn
// into a total for this brief (or the currency is not USD) it returns
// {amount: null, unit: 'usd'}: the money gate then needs a budget on
// recorded spend instead of a quote. Prices are never written in code.
//
// licence comes from fal's model metadata (license_type) when present, and
// always points at the model page; the adapter never guesses one.
//
// Docs (read 2026-11):
//   queue: https://fal.ai/docs/documentation/model-apis/inference/queue.md
//   submit: https://fal.ai/docs/api-reference/inference-api/queue/submit.md
//           https://fal.ai/docs/api-reference/inference-api/queue/submit-path.md
//   errors: https://fal.ai/docs/documentation/model-apis/request-errors.md
//   files (data URIs): https://fal.ai/docs/documentation/model-apis/fal-cdn.md
//   models: https://fal.ai/docs/platform-apis/v1/models.md
//   pricing: https://fal.ai/docs/platform-apis/v1/models/pricing.md
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const QUEUE = 'https://queue.fal.run';
const API = 'https://api.fal.ai/v1';
const PAGE = 'https://fal.ai/models/';
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

export function createFalProvider({ imageModel, videoModel, draftVideoModel, fetch: doFetch = globalThis.fetch, env = process.env } = {}) {
  if (!imageModel && !videoModel) throw new Error('fal: name a model, imageModel and/or videoModel (fal endpoint ids, e.g. "fal-ai/flux/dev")');
  const metadata = new Map();

  function headers() {
    const key = env.FAL_KEY;
    if (!key) throw new Error('fal: FAL_KEY is not set. Create a key at https://fal.ai/dashboard/keys and export it as FAL_KEY.');
    return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  }

  async function call(url, { method = 'GET', body, signal } = {}) {
    const response = await doFetch(url, { method, headers: headers(), body: body && JSON.stringify(body), signal });
    if (!response.ok) throw new Error(`fal: ${method} ${url} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return response.json();
  }

  function modelFor(step, tier) {
    const model = step === 'image' ? imageModel : (tier === 'draft' && draftVideoModel) || videoModel;
    if (!model) throw new Error(`fal: no model set for the ${step} step`);
    return model;
  }

  // Model metadata with its OpenAPI schema, once per model. Optional: without
  // it the adapter sends the basic fields and marks the licence "see terms".
  function meta(model) {
    if (!metadata.has(model)) {
      metadata.set(model, call(`${API}/models?endpoint_id=${encodeURIComponent(model)}&expand=openapi-3.0`)
        .then((out) => out.models?.find((m) => m.endpoint_id === model) ?? null)
        .catch((error) => { if (/FAL_KEY/.test(error.message)) throw error; return null; }));
    }
    return metadata.get(model);
  }

  async function plan(brief, step, tier) {
    const model = modelFor(step, tier);
    const info = await meta(model);
    const props = inputProperties(info?.openapi);
    const video = step === 'video' ? brief.video : null;
    if (step === 'video' && !video) throw new Error(`fal: brief ${brief.id} has no video half`);
    const seconds = video ? pickDuration(video.seconds + 2 * (video.pad_seconds ?? 0), props?.duration?.enum) : null;
    return { model, info, props, seconds };
  }

  return {
    id: 'fal',
    steps: [imageModel && 'image', videoModel && 'video'].filter(Boolean),

    async quote(brief, step, tier) {
      const { model, seconds } = await plan(brief, step, tier);
      const out = await call(`${API}/models/pricing?endpoint_id=${encodeURIComponent(model)}`);
      const price = out.prices?.find((p) => p.endpoint_id === model);
      if (!price || String(price.currency).toUpperCase() !== 'USD') return { amount: null, unit: 'usd' };
      const unit = String(price.unit).toLowerCase().replace(/s$/, '');
      const quantity = { image: step === 'image' ? 1 : null, video: step === 'video' ? 1 : null, second: seconds && Number.parseFloat(seconds),
        megapixel: step === 'image' ? (brief.image.width * brief.image.height) / 1e6 : null }[unit];
      return { amount: quantity ? price.unit_price * quantity : null, unit: 'usd' };
    },

    async submit(brief, step, tier, { startFrame, signal } = {}) {
      signal?.throwIfAborted();
      const { model, props, seconds } = await plan(brief, step, tier);
      const input = step === 'image' ? await imageInput(brief.image, props) : await videoInput(brief, startFrame, seconds, props);
      const out = await call(`${QUEUE}/${model}`, { method: 'POST', body: input, signal });
      const job = { provider: 'fal', model, step, request_id: out.request_id, status_url: out.status_url, response_url: out.response_url, cancel_url: out.cancel_url };
      // Kept off the job's JSON so a ledger can store the job as is.
      Object.defineProperty(job, 'signal', { value: signal, enumerable: false });
      return job;
    },

    async poll(job) {
      if (job.signal?.aborted) {
        await call(job.cancel_url, { method: 'PUT' }).catch(() => {});
        return { state: 'failed', error: 'aborted' };
      }
      const out = await call(job.status_url, { signal: job.signal });
      if (out.status === 'IN_QUEUE') return { state: 'queued' };
      if (out.status === 'IN_PROGRESS') return { state: 'running' };
      if (out.status === 'COMPLETED') return out.error ? { state: 'failed', error: `${out.error_type ?? 'error'}: ${out.error}` } : { state: 'done' };
      return { state: 'failed', error: `unknown fal status ${out.status}` };
    },

    async fetch(job, outDir) {
      const out = await call(job.response_url, { signal: job.signal });
      const media = job.step === 'image' ? out.images?.[0] : out.video;
      if (!media?.url) throw new Error(`fal: ${job.model} returned no ${job.step} for request ${job.request_id}`);
      // Media URLs are public fal CDN links; the key is not sent there.
      const response = await doFetch(media.url, { signal: job.signal });
      if (!response.ok) throw new Error(`fal: download of ${job.step} for request ${job.request_id} failed (${response.status})`);
      const ext = EXT[media.content_type] || path.extname(new URL(media.url).pathname).slice(1) || (job.step === 'image' ? 'png' : 'mp4');
      await mkdir(outDir, { recursive: true });
      const file = path.join(outDir, `${job.request_id}.${ext}`);
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      const info = await meta(job.model);
      const page = `${PAGE}${job.model}`;
      const licence = info?.metadata?.license_type ? `${info.metadata.license_type} (fal metadata); see provider terms: ${page}` : `see provider terms: ${page}`;
      return { file, ...(out.seed != null && { seed: out.seed }), model: job.model, licence };
    }
  };
}

async function imageInput(image, props) {
  const input = { prompt: image.prompt };
  // Models take either a size or an aspect ratio (nano-banana: aspect_ratio only, square by default).
  const ratio = aspect(image.width, image.height);
  if (props?.aspect_ratio?.enum?.includes(ratio) && !props?.image_size) input.aspect_ratio = ratio;
  else input.image_size = { width: image.width, height: image.height };
  if (image.negative && props?.negative_prompt) input.negative_prompt = image.negative;
  if (image.references?.length && props?.image_urls) input.image_urls = await Promise.all(image.references.map(dataUri));
  return input;
}

async function videoInput(brief, startFrame, duration, props) {
  if (!startFrame) throw new Error(`fal: the video step for ${brief.id} needs a startFrame (the approved keyframe)`);
  const input = { prompt: brief.video.prompt, image_url: await dataUri(startFrame), duration };
  const ratio = aspect(brief.image.width, brief.image.height);
  if (props?.aspect_ratio?.enum?.includes(ratio)) input.aspect_ratio = ratio;
  if (brief.image.negative && props?.negative_prompt) input.negative_prompt = brief.image.negative;
  return input;
}

// The input fields a model takes, from its OpenAPI document.
// shortcut: merges every schema named *Input; read the POST requestBody $ref if a model ships several inputs.
export function inputProperties(openapi) {
  const schemas = openapi?.components?.schemas;
  if (!schemas) return null;
  const inputs = Object.entries(schemas).filter(([name, schema]) => /Input$/.test(name) && schema.properties);
  return inputs.length ? Object.assign({}, ...inputs.map(([, schema]) => schema.properties)) : null;
}

// The smallest allowed duration that covers the clip, keeping the model's own
// spelling ("5", "6s"); the longest when none does. Without a list, whole seconds.
export function pickDuration(seconds, allowed) {
  if (!allowed?.length) return String(Math.ceil(seconds));
  const sorted = [...allowed].sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b));
  return sorted.find((value) => Number.parseFloat(value) >= seconds) ?? sorted.at(-1);
}

function aspect(width, height) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

async function dataUri(file) {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`fal: ${file} is not a png, jpeg or webp image`);
  return `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
}
