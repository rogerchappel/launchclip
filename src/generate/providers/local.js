// Local provider (docs/GENERATED_FOOTAGE_RFC.md §5 class 2, docs/LOCAL_GENERATION.md):
// drives a ComfyUI server the user runs on this machine, for text to image
// ("image" step) and image to video ("video" step). Nothing is bundled and
// no weights are downloaded: the user installs ComfyUI and the models.
//
//   const local = createLocalProvider({imageModel: 'flux-schnell.json', videoModel: 'wan22-ti2v-5b.json', cwd});
//   const job = await local.submit(brief, 'image', 'final', {signal});
//   while ((await local.poll(job)).state !== 'done') …
//   const {file, model, licence} = await local.fetch(job, outDir);
//
// A "model" is a ComfyUI workflow exported in API format (File → Export
// (API)), with placeholders the adapter fills. A string value that is
// exactly a placeholder becomes the value itself (a number stays a number):
//   {{prompt}} {{negative}} {{width}} {{height}} {{seed}}           (both steps)
//   {{start_frame}} {{frames}} {{fps}} {{seconds}}                   (video step)
// The workflow carries one extra top-level key, "launchclip", which is
// removed before it is sent:
//   {"model": "FLUX.1 [schnell]", "licence": "apache-2.0 (model card: <url>)",
//    "seconds_per_image": 20,            // image step: measured on this Mac
//    "seconds_per_second": 600,          // video step: compute per output second
//    "fps": 24, "frames_multiple": 4}    // video: frames = n·multiple + 1 (Wan 4, LTX 8)
// licence is required and is copied from the model card by the person who
// wrote the workflow; the adapter never guesses one. Without a rate the quote
// is {amount: null, unit: 'seconds'} and make then needs --max-generations.
//
// The server address is COMFYUI_URL (default http://127.0.0.1:8188).
// Routes used (https://docs.comfy.org/development/comfyui-server/comms_routes):
// POST /prompt, GET /history/{id}, GET /view, POST /upload/image,
// POST /queue {delete}, POST /interrupt.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:8188';
const EXTS = { image: /\.(png|jpe?g|webp)$/i, video: /\.(mp4|webm|mov|gif|webp)$/i };

export function createLocalProvider({ imageModel, videoModel, draftVideoModel, env = process.env, fetch: doFetch = globalThis.fetch, cwd = process.cwd() } = {}) {
  if (!imageModel && !videoModel) throw new Error('local: name a ComfyUI workflow (API format), e.g. --generate local:flux-schnell.json (docs/LOCAL_GENERATION.md)');
  const base = String(env.COMFYUI_URL || DEFAULT_URL).replace(/\/+$/, '');
  const clientId = randomUUID();
  const workflows = new Map();

  async function call(route, { method = 'GET', json, body, signal, raw = false } = {}) {
    let response;
    try {
      response = await doFetch(`${base}${route}`, { method, signal, ...(json ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) } : body ? { body } : {}) });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error(`local: ComfyUI is not answering at ${base} (${error?.cause?.code ?? error?.message}). Start it (python main.py in your ComfyUI folder, or the ComfyUI app) or set COMFYUI_URL.`);
    }
    if (!response.ok) throw new Error(`local: ${method} ${route} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return raw ? response : response.json();
  }

  function workflow(step, tier) {
    const file = step === 'image' ? imageModel : (tier === 'draft' && draftVideoModel) || videoModel;
    if (!file) throw new Error(`local: no workflow set for the ${step} step`);
    if (!workflows.has(file)) workflows.set(file, loadWorkflow(path.resolve(cwd, file)));
    return workflows.get(file);
  }

  return {
    id: 'local',
    steps: [imageModel && 'image', videoModel && 'video'].filter(Boolean),

    async quote(brief, step, tier) {
      const { meta } = await workflow(step, tier);
      const rate = step === 'image' ? meta.seconds_per_image : meta.seconds_per_second;
      if (!(rate > 0)) return { amount: null, unit: 'seconds' };
      return { amount: step === 'image' ? rate : rate * clipSeconds(brief), unit: 'seconds' };
    },

    async submit(brief, step, tier, { startFrame, signal } = {}) {
      signal?.throwIfAborted();
      const { graph, meta, file } = await workflow(step, tier);
      const values = { prompt: brief.image.prompt, negative: brief.image.negative ?? '', width: brief.image.width, height: brief.image.height, seed: seedFor(brief) };
      if (step === 'video') {
        if (!brief.video) throw new Error(`local: brief ${brief.id} has no video half`);
        if (!startFrame) throw new Error(`local: the video step for ${brief.id} needs a startFrame (the approved keyframe)`);
        const fps = meta.fps ?? brief.video.fps ?? 24;
        const multiple = meta.frames_multiple ?? 4;
        Object.assign(values, { prompt: brief.video.prompt, fps, seconds: clipSeconds(brief), frames: Math.ceil((clipSeconds(brief) * fps) / multiple) * multiple + 1, start_frame: await upload(startFrame, signal) });
      }
      const out = await call('/prompt', { method: 'POST', json: { prompt: fill(graph, values), client_id: clientId }, signal });
      if (out.error) throw new Error(`local: ComfyUI refused ${file}: ${JSON.stringify(out.error).slice(0, 300)}`);
      const job = { provider: 'local', model: meta.model, step, request_id: out.prompt_id, licence: meta.licence, seed: values.seed, submitted_at: Date.now() };
      Object.defineProperty(job, 'signal', { value: signal, enumerable: false });
      return job;
    },

    async poll(job) {
      if (job.signal?.aborted) {
        // Drop it from the queue if it is waiting; stop it if it is the one running.
        await call('/queue', { method: 'POST', json: { delete: [job.request_id] } }).catch(() => {});
        if ((await call('/queue').catch(() => null))?.queue_running?.some((item) => item[1] === job.request_id)) await call('/interrupt', { method: 'POST' }).catch(() => {});
        return { state: 'failed', error: 'aborted' };
      }
      const entry = (await call(`/history/${encodeURIComponent(job.request_id)}`))[job.request_id];
      if (!entry) return { state: 'running' };
      if (entry.status?.status_str === 'error') return { state: 'failed', error: errorText(entry.status) };
      return entry.status?.completed === false ? { state: 'running' } : { state: 'done' };
    },

    async fetch(job, outDir) {
      const entry = (await call(`/history/${encodeURIComponent(job.request_id)}`, { signal: job.signal }))[job.request_id];
      const media = Object.values(entry?.outputs ?? {}).flatMap((node) => Object.values(node).filter(Array.isArray).flat())
        .find((item) => item?.filename && item.type !== 'temp' && EXTS[job.step].test(item.filename));
      if (!media) throw new Error(`local: ComfyUI returned no saved ${job.step} for prompt ${job.request_id}; does the workflow end in a Save node?`);
      const query = new URLSearchParams({ filename: media.filename, subfolder: media.subfolder ?? '', type: media.type ?? 'output' });
      const response = await call(`/view?${query}`, { signal: job.signal, raw: true });
      await mkdir(outDir, { recursive: true });
      const file = path.join(outDir, `${job.request_id}${path.extname(media.filename).toLowerCase()}`);
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      // Local cost is time: the wall-clock seconds from submit to fetch, queue included.
      return { file, seed: job.seed, model: job.model, licence: job.licence, cost: { amount: Math.round((Date.now() - job.submitted_at) / 100) / 10, unit: 'seconds' } };
    }
  };

  async function upload(file, signal) {
    const form = new FormData();
    form.append('image', new Blob([await readFile(file)]), `launchclip-${path.basename(file)}`);
    form.append('overwrite', 'true');
    const out = await call('/upload/image', { method: 'POST', body: form, signal });
    return out.subfolder ? `${out.subfolder}/${out.name}` : out.name;
  }
}

/** A workflow file → {graph, meta, file}; meta needs model and licence. */
export async function loadWorkflow(file) {
  let parsed;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
    throw new Error(`local: can't read the ComfyUI workflow ${file}: ${error.message}`);
  }
  const { launchclip: meta, ...graph } = parsed ?? {};
  if (!meta?.model || !meta?.licence) throw new Error(`local: ${file} needs a "launchclip": {"model", "licence"} block, the licence copied from the model card (docs/LOCAL_GENERATION.md)`);
  if (!Object.values(graph).some((node) => node?.class_type)) throw new Error(`local: ${file} is not a ComfyUI API-format workflow (export it with File → Export (API))`);
  return { graph, meta, file };
}

/** Every string that is exactly "{{name}}" → values[name]; unknown names stay as they are. */
export function fill(graph, values) {
  const walk = (value) => {
    if (typeof value === 'string') {
      const match = /^\{\{(\w+)\}\}$/.exec(value);
      return match && match[1] in values ? values[match[1]] : value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, walk(inner)]));
    return value;
  };
  return walk(graph);
}

const clipSeconds = (brief) => brief.video.seconds + 2 * (brief.video.pad_seconds ?? 0);

// The same brief gets the same seed, so a re-run reproduces the shot.
function seedFor(brief) {
  let hash = 0;
  for (const char of String(brief.brief_hash ?? brief.id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

function errorText(status) {
  const message = status.messages?.find(([kind]) => kind === 'execution_error')?.[1];
  return message ? `${message.node_type ?? 'node'}: ${message.exception_message ?? 'error'}`.trim() : 'ComfyUI reported an error';
}
