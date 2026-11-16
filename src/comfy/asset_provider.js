// ComfyUI as an asset provider (docs/FINISHING_AND_ELEMENTS_RFC.md §E.7,
// docs/GENERATED_FOOTAGE_RFC.md §5 class 2): `launchclip make --asset-provider
// comfy` answers the planner's shot requests (src/asset_provider.js) with
// stills from a plate template and short clips from a draft video template on
// a local ComfyUI. Any failure (no server, a missing node or model, a job
// error) is "no shot" (null), so the planner designs the scene in code as it
// does with no provider. Every made file is cached by its inputs and logged in
// <project>/qa/generation-log.jsonl with its model's licence.
import { createHash } from "node:crypto";
import path from "node:path";
import { createComfyClient } from "./client.js";
import { generateWithComfy } from "./generate.js";
import { assertLicence, loadTemplate } from "./templates.js";

export const COMFY_PLATE_TEMPLATES = Object.freeze(["plate-flux-schnell", "plate-sdxl"]);
export const COMFY_VIDEO_TEMPLATE = "draft-wan-5b";
const NEVER = "no text, no lettering, no logos, no watermark";

/** A size near `pixels` with the request's aspect, both sides multiples of `step`. */
export function generationSize(format, { pixels, step }) {
  const aspect = Number(format?.width) > 0 && Number(format?.height) > 0 ? format.width / format.height : 16 / 9;
  const snap = (value) => Math.max(step, Math.round(value / step) * step);
  return { width: snap(Math.sqrt(pixels * aspect)), height: snap(Math.sqrt(pixels / aspect)) };
}

/** Wan's frame count: 4n + 1 at 24 fps, from the request's duration, capped at 121 (5 s). */
export function wanFrames(duration) {
  const frames = Math.round((Number(duration) > 0 ? Number(duration) : 3) * 24);
  return Math.min(121, Math.max(25, Math.round((frames - 1) / 4) * 4 + 1));
}

/** The prompt for one shot request: what it shows, a plate's emptiness, and what never appears. */
export function shotText(request) {
  const plate = request.role === "background" ? ", wide establishing shot, nobody in frame, slow steady camera" : "";
  return `${String(request.shows ?? "").trim()}${plate}. Photographic, natural light. ${NEVER}.`;
}

export async function createComfyAssetProvider({ project, url, env = process.env, allowRemote = false, allowLicences = [], plate = COMFY_PLATE_TEMPLATES[0], fetch, client = null, notice = (line) => process.stderr.write(`${line}\n`) } = {}) {
  if (!COMFY_PLATE_TEMPLATES.includes(plate)) throw new Error(`--comfy-plate must be ${COMFY_PLATE_TEMPLATES.join(" or ")}; got ${plate}`);
  const templates = { image: await loadTemplate(plate), video: await loadTemplate(COMFY_VIDEO_TEMPLATE) };
  for (const template of Object.values(templates)) assertLicence(template, allowLicences);
  const comfy = client ?? createComfyClient({ url, env, allowRemote, fetch });
  const told = new Set();
  return {
    id: "comfy",
    async findShot(request) {
      const kind = request.type === "video" && !request.still ? "video" : "image";
      const template = templates[kind];
      const seed = parseInt(createHash("sha256").update(String(request.shows)).digest("hex").slice(0, 8), 16);
      const values = { prompt: shotText(request), seed, ...generationSize(request.format, kind === "video" ? { pixels: 832 * 480, step: 32 } : { pixels: 1024 * 1024, step: 64 }), ...(kind === "video" ? { frames: wanFrames(request.duration) } : {}) };
      try {
        const made = await generateWithComfy({ client: comfy, template, values, allowLicences, cacheDir: path.join(project, ".launchclip", "cache", "comfy"), ledger: path.join(project, "qa", "generation-log.jsonl"), extra: { shot: request.scene_id ?? request.id, tier: kind === "video" ? "draft" : "plate" } });
        return { kind, file: made.file, description: request.shows, source: { provider: "comfy", id: made.key, model: made.model, template: made.template, license: made.licence, generated: true, prompt: values.prompt, seed } };
      } catch (error) {
        // One notice per reason, not per request: a down server fails every shot the same way.
        if (!told.has(error.message)) { told.add(error.message); notice(`comfy: ${error.message}; that shot is drawn in code`); }
        return null;
      }
    }
  };
}
