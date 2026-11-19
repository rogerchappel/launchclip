// ElevenLabs Image & Video API adapter for generated footage
// (docs/GENERATED_FOOTAGE_RFC.md §5, §5.1). Opt-in and paid; nothing calls
// it unless the user names it, and it has no default model.
//
// Docs (read 2026-11-20):
//   https://elevenlabs.io/docs/capabilities/image-video
//   https://elevenlabs.io/docs/eleven-api/guides/cookbooks/image-and-video
//   https://elevenlabs.io/docs/api-reference/flows/image/create  (and /video/create)
//   https://elevenlabs.io/docs/api-reference/flows/image/get     (and /video/get)
//   https://elevenlabs.io/docs/eleven-api/guides/how-to/image-and-video/references
//
// Wire: POST /v1/flows/{image|video} with JSON {model_id, prompt, ...} →
// {id, status: "pending"}; GET /v1/flows/{image|video}/{id} → status
// pending | generating | completed {content_url, content_mime_type} |
// failed {failure_reason, error_message}. content_url is a signed URL that
// lasts about an hour, so fetch() re-reads the generation for a fresh one and
// downloads it WITHOUT the key. Webhooks exist; we poll (the docs ask for no
// more than every 2 s for images, 10 s for video — the caller paces polls).
// Auth is the xi-api-key header with ELEVENLABS_API_KEY from the environment,
// as in src/production_media.js and src/voice_isolation.js; the key is never
// logged and is scrubbed from every error.
//
// Account limits, surfaced as clear errors when the API returns them:
//   - API use needs a Pro plan or above (402 paid_plan_required).
//   - ByteDance models (Seedream, Seedance) are off by default over the API
//     and need approval from ElevenLabs (model_access_denied).
//   - Some models are unavailable in the United States; the docs name no
//     error code for this, so a refusal whose message mentions the region is
//     reported as such.
//
// Brief mapping:
//   - image.prompt → prompt; image.width/height → nearest aspect_ratio (the
//     API takes no pixel size; resolution is left to the model default).
//   - image.references → images[] as inline base64 (image step); for the
//     video step they go as images[] only when there is no start frame (Veo
//     rejects references next to a start frame, and wants a role on each).
//   - negative → negative_prompt only for Veo video models: no other model
//     has the field and the API rejects unknown fields.
//   - video.seconds + 2 × pad_seconds → duration_secs, rounded up. Models
//     take different durations (Veo: 4, 6, 8); the API rejects others.
//   - video.fps: the API has no fps field; it is not sent.
//   - startFrame: a file path (sent inline) or this provider's image job
//     (sent as a generation reference, no re-upload).
//
// Quote: the API exposes no cost estimate and no cost in responses, so quote
// is {amount: null, unit: "credits"} and fetch returns no cost. Licence: the
// API returns none, so it is "see provider terms: <url>". No seed is
// returned either.
//
// CLI wiring (`--generate elevenlabs:<model>`) is wave 2; this module only
// exports the factory.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const ELEVENLABS_TERMS_URL = "https://elevenlabs.io/terms-of-use";
const ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"];
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif" };
const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" };
const STATES = { pending: "queued", generating: "running", completed: "done", failed: "failed" };

export function nearestAspect(width, height) {
  const off = (a) => { const [w, h] = a.split(":"); return Math.abs(Math.log(w / h) - Math.log(width / height)); };
  return ASPECTS.reduce((best, a) => (off(a) < off(best) ? a : best));
}

async function inline(file) {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`ElevenLabs: unsupported reference image type: ${file}`);
  return { type: "inline_base64", content_base64: (await readFile(file)).toString("base64"), mime_type: mime };
}

export function createElevenLabsProvider({ imageModel, videoModel, draftVideoModel, fetch = globalThis.fetch, env = process.env, baseUrl = "https://api.elevenlabs.io" } = {}) {
  const apiKey = () => {
    const key = env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("ElevenLabs image/video generation is opt-in and needs ELEVENLABS_API_KEY in the environment. Nothing was sent.");
    return key;
  };
  const scrub = (text) => env.ELEVENLABS_API_KEY ? String(text).split(env.ELEVENLABS_API_KEY).join("[redacted]") : String(text);
  const modelFor = (step, tier) => {
    const model = step === "image" ? imageModel : (tier === "draft" && draftVideoModel) || videoModel;
    if (!model) throw new Error(`ElevenLabs: no ${step} model chosen; pass ${step === "image" ? "imageModel" : "videoModel"} (there is no default paid model)`);
    return model;
  };

  async function api(pathname, init = {}) {
    const key = apiKey();
    let response;
    try {
      response = await fetch(`${baseUrl}${pathname}`, { ...init, headers: { "xi-api-key": key, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) } });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error(`ElevenLabs request failed: ${scrub(error?.message ?? error)}`);
    }
    if (response.ok) return response.json();
    throw refusal(response.status, await response.text().catch(() => ""));
  }

  function refusal(status, body) {
    let detail = {};
    try { detail = JSON.parse(body).detail ?? {}; } catch {}
    const code = Array.isArray(detail) ? "validation_error" : detail.code ?? detail.status ?? "";
    const message = scrub(Array.isArray(detail) ? JSON.stringify(detail) : detail.message ?? body).slice(0, 500);
    let reason = `ElevenLabs API failed (${status}${code ? ` ${code}` : ""}): ${message}`;
    if (code === "paid_plan_required" || (status === 402 && /plan/i.test(message))) reason = `ElevenLabs Image & Video API needs a Pro plan or above (${status} ${code}): ${message}`;
    else if (code === "model_access_denied") reason = `ElevenLabs refused the model (model_access_denied). ByteDance models are off by default over the API and need approval from ElevenLabs: ${message}`;
    else if (/united states|\bregion\b|not available in your (country|location)/i.test(message)) reason = `ElevenLabs: this model is not available in your region (some models are unavailable in the US): ${message}`;
    return Object.assign(new Error(reason), { status, code });
  }

  return {
    id: "elevenlabs",
    steps: ["image", "video"],

    quote(_brief, step, tier) {
      modelFor(step, tier);
      return { amount: null, unit: "credits" };
    },

    async submit(brief, step, tier, { startFrame, signal } = {}) {
      signal?.throwIfAborted();
      const model = modelFor(step, tier);
      const { image } = brief;
      const refs = await Promise.all((image.references ?? []).map(inline));
      const body = { model_id: model, prompt: image.prompt, aspect_ratio: nearestAspect(image.width, image.height) };
      if (step === "image") {
        if (refs.length) body.images = refs;
      } else {
        const video = brief.video;
        if (!video) throw new Error(`ElevenLabs: brief ${brief.id} has no video step`);
        const veo = /^veo/i.test(model);
        body.prompt = video.prompt;
        body.duration_secs = Math.ceil(video.seconds + 2 * (video.pad_seconds ?? 0));
        if (veo && image.negative) body.negative_prompt = image.negative;
        if (startFrame) body.start_frame = typeof startFrame === "string" ? await inline(startFrame) : { type: "generation", generation_id: startFrame.id };
        else if (refs.length) body.images = veo ? refs.map((r) => ({ image: r, role: "subject" })) : refs;
      }
      signal?.throwIfAborted();
      const created = await api(`/v1/flows/${step}`, { method: "POST", body: JSON.stringify(body), signal });
      return { provider: "elevenlabs", id: created.id, step, model, brief_id: brief.id };
    },

    async poll(job) {
      const g = await api(`/v1/flows/${job.step}/${encodeURIComponent(job.id)}`);
      const state = STATES[g.status] ?? "running";
      return state === "failed" ? { state, error: `${g.failure_reason ?? "failed"}: ${scrub(g.error_message ?? "")}` } : { state };
    },

    async fetch(job, outDir) {
      // Re-read for a fresh signed URL: the one from an earlier poll may have expired.
      const g = await api(`/v1/flows/${job.step}/${encodeURIComponent(job.id)}`);
      if (g.status !== "completed") throw new Error(`ElevenLabs generation ${job.id} is ${g.status}, not completed`);
      const response = await fetch(g.content_url);
      if (!response.ok) throw new Error(`ElevenLabs download failed (${response.status})`);
      const ext = EXT[g.content_mime_type] ?? (job.step === "video" ? ".mp4" : ".png");
      await mkdir(outDir, { recursive: true });
      const file = path.join(outDir, `${job.brief_id}-${job.step}${ext}`);
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      return { file, model: job.model, licence: `see provider terms: ${ELEVENLABS_TERMS_URL}` };
    }
  };
}
