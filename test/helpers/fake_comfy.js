// A fake ComfyUI HTTP API for tests (no model, no GPU): a fetch that answers
// /system_stats, /object_info, /prompt, /history/{id}, /view, /upload/image
// and /interrupt the way a real server does. objectInfo: node class →
// {input: {required}}; output(workflow, n) → Buffer for the n-th job;
// pending: polls that return {} before the job is done; fail: an
// execution_error message.
export const FAKE_OBJECT_INFO = Object.freeze({
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [["stable-audio-open-1.0.safetensors", "sd_xl_base_1.0.safetensors", "flux1-schnell-fp8.safetensors"]] } } },
  CLIPLoader: { input: { required: { clip_name: [["t5_base.safetensors", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"]] } } },
  UNETLoader: { input: { required: { unet_name: ["COMBO", { options: ["wan2.2_ti2v_5B_fp16.safetensors"] }] } } },
  VAELoader: { input: { required: { vae_name: [["wan2.2_vae.safetensors"]] } } },
  UpscaleModelLoader: { input: { required: { model_name: [["RealESRGAN_x4plus.pth"]] } } }
});

export function fakeComfy({ objectInfo = null, output = () => Buffer.alloc(2048, 7), pending = 1, fail = null, filename = "launchclip_00001_.flac", down = false } = {}) {
  const calls = [];
  const jobs = new Map();
  const info = objectInfo ?? { ...FAKE_OBJECT_INFO };
  const ok = (body) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    calls.push({ method: init.method ?? "GET", path: pathname, url, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
    if (down) throw new TypeError("fetch failed (ECONNREFUSED)");
    if (pathname === "/system_stats") return ok({ system: { comfyui_version: "0.3.fake" }, devices: [{ name: "mps", type: "mps", vram_total: 0 }] });
    if (pathname === "/object_info") {
      // Real servers list every class; the fake also knows every class a template uses unless objectInfo was given.
      return ok(objectInfo ? info : new Proxy(info, { get: (target, key) => target[key] ?? { input: { required: {} } } }));
    }
    if (pathname === "/prompt") {
      const id = `p${jobs.size + 1}`;
      jobs.set(id, { workflow: JSON.parse(init.body).prompt, polls: 0, n: jobs.size });
      return ok({ prompt_id: id, number: jobs.size, node_errors: {} });
    }
    if (pathname.startsWith("/history/")) {
      const id = decodeURIComponent(pathname.slice(9));
      const job = jobs.get(id);
      if (!job || job.polls++ < pending) return ok({});
      if (fail) return ok({ [id]: { outputs: {}, status: { status_str: "error", completed: false, messages: [["execution_error", { node_type: "KSampler", exception_message: fail }]] } } });
      const out = Object.keys(job.workflow).at(-1);
      return ok({ [id]: { outputs: { [out]: { audio: [{ filename: filename.replace("00001", String(job.n + 1).padStart(5, "0")), subfolder: "launchclip", type: "output" }] } }, status: { status_str: "success", completed: true, messages: [] } } });
    }
    if (pathname === "/view") {
      const n = Number(/_(\d+)_/.exec(searchParams.get("filename"))?.[1] ?? 1) - 1;
      const job = [...jobs.values()][n];
      const bytes = output(job?.workflow, n);
      return { ok: true, status: 200, headers: new Headers({ "content-length": String(bytes.length) }), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
    }
    if (pathname === "/upload/image") return ok({ name: init.body.get("image").name ?? "upload.png", subfolder: "", type: "input" });
    if (pathname === "/interrupt") return ok({});
    return { ok: false, status: 404, headers: new Headers(), text: async () => "not found" };
  };
  return { fetch, calls, jobs };
}
