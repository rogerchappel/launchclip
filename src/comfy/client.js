// A client for a local ComfyUI server (docs/IMMERSIVE_SOUND_RFC.md §7,
// docs/FINISHING_AND_ELEMENTS_RFC.md §E.7). ComfyUI is GPL-3.0, so we speak
// only its HTTP API and copy no code: POST /prompt with our own API-format
// workflow, poll GET /history/{id}, fetch outputs with GET /view, cancel with
// POST /interrupt. Health is
// GET /system_stats plus GET /object_info (every node class and model file a
// template needs).
//
// Safety: the host must be loopback unless the caller passes allowRemote
// (the user named the host for this run); output filenames come only from
// /history; downloads and job time are capped.
import { randomUUID } from "node:crypto";

export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
export const COMFY_JOB_TIMEOUT_MS = 20 * 60_000;
export const COMFY_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** The server URL: explicit, else LAUNCHCLIP_COMFY_URL, else the default. Refuses non-loopback hosts unless allowRemote. */
export function comfyUrl(url, { env = process.env, allowRemote = false } = {}) {
  const raw = url || env.LAUNCHCLIP_COMFY_URL || DEFAULT_COMFY_URL;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`ComfyUI URL is not a URL: ${raw}`); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`ComfyUI URL must be http(s): ${raw}`);
  if (!LOOPBACK.has(parsed.hostname) && !allowRemote) throw new Error(`ComfyUI host ${parsed.hostname} is not loopback; LaunchClip only talks to a ComfyUI on this machine unless you pass --comfy-allow-remote for this run`);
  return parsed.origin;
}

/** Every class_type in an API-format workflow. */
export function workflowNodes(workflow) {
  return [...new Set(Object.values(workflow).map((node) => node.class_type))].sort();
}

/** Every {filename, subfolder, type} in one /history entry's outputs, from the given node ids (all nodes when none). */
export function historyFiles(entry, nodeIds = null) {
  const files = [];
  for (const [id, output] of Object.entries(entry?.outputs ?? {})) {
    if (nodeIds && !nodeIds.includes(id)) continue;
    for (const list of Object.values(output ?? {})) {
      if (!Array.isArray(list)) continue;
      for (const item of list) if (item && typeof item.filename === "string") files.push({ filename: item.filename, subfolder: item.subfolder ?? "", type: item.type ?? "output" });
    }
  }
  return files;
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); }, { once: true });
});

/**
 * client: {url, health(needs), run(workflow, {outputNodes}), download(file), interrupt()}.
 * needs: {nodes: [class_type], models: [{node, input, file}]}.
 */
export function createComfyClient({ url, env = process.env, allowRemote = false, fetch: fetchImpl = globalThis.fetch, timeoutMs = COMFY_JOB_TIMEOUT_MS, pollMs = 1000, maxBytes = COMFY_MAX_DOWNLOAD_BYTES, clientId = randomUUID() } = {}) {
  const base = comfyUrl(url, { env, allowRemote });
  const call = async (route, init = {}) => {
    let response;
    try { response = await fetchImpl(`${base}${route}`, init); } catch (error) { throw new Error(`ComfyUI at ${base} is not reachable (${error?.message ?? error})`); }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`ComfyUI ${init.method ?? "GET"} ${route.split("?")[0]} failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    return response;
  };
  const json = async (route, init) => (await call(route, init)).json();

  async function health({ nodes = [], models = [] } = {}) {
    let stats;
    let info;
    try { [stats, info] = await Promise.all([json("/system_stats"), json("/object_info")]); } catch (error) { return { ok: false, url: base, reason: error.message }; }
    const devices = (stats?.devices ?? []).map((device) => ({ name: device.name, type: device.type, vram_total: device.vram_total ?? null }));
    const missingNodes = nodes.filter((node) => !info?.[node]);
    // A loader's model list is its input's first element (object_info.CheckpointLoaderSimple.input.required.ckpt_name[0]), or ["COMBO", {options}] on newer servers.
    const missingModels = models.filter(({ node, input, file }) => {
      const spec = info?.[node]?.input?.required?.[input];
      const choices = spec?.[0] === "COMBO" ? spec[1]?.options : spec?.[0];
      return !Array.isArray(choices) || !choices.includes(file);
    }).map(({ file }) => file);
    const problems = [];
    if (missingNodes.length) problems.push(`missing node classes: ${missingNodes.join(", ")}`);
    if (missingModels.length) problems.push(`missing model files: ${missingModels.join(", ")}`);
    return { ok: !problems.length, url: base, comfyui: stats?.system?.comfyui_version ?? null, devices, missing_nodes: missingNodes, missing_models: missingModels, ...(problems.length ? { reason: problems.join("; ") } : {}) };
  }

  async function interrupt() {
    await call("/interrupt", { method: "POST" }).catch(() => {});
  }

  /** Queue a workflow and wait for it: → {prompt_id, files: [{filename, subfolder, type}]}. */
  async function run(workflow, { outputNodes = null, signal } = {}) {
    const queued = await json("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: clientId }) });
    const id = queued?.prompt_id;
    if (!id) throw new Error(`ComfyUI did not queue the workflow: ${JSON.stringify(queued?.node_errors ?? queued).slice(0, 300)}`);
    const deadline = Date.now() + timeoutMs;
    // shortcut: polls /history instead of the /ws progress stream; add the socket when a progress bar needs it.
    while (Date.now() < deadline) {
      const entry = (await json(`/history/${encodeURIComponent(id)}`))?.[id];
      if (entry?.status?.status_str === "error") {
        const failure = (entry.status.messages ?? []).find(([kind]) => kind === "execution_error")?.[1];
        throw new Error(`ComfyUI workflow failed${failure ? ` in ${failure.node_type}: ${failure.exception_message}` : ""}`);
      }
      if (entry && (entry.status?.completed || entry.status?.status_str === "success")) {
        const files = historyFiles(entry, outputNodes);
        if (!files.length) throw new Error("ComfyUI finished but returned no output files");
        return { prompt_id: id, files };
      }
      await wait(pollMs, signal);
    }
    await interrupt();
    throw new Error(`ComfyUI job ${id} passed the ${Math.round(timeoutMs / 1000)} s limit and was interrupted`);
  }

  async function download({ filename, subfolder = "", type = "output" }) {
    const response = await call(`/view?${new URLSearchParams({ filename, subfolder, type })}`);
    const length = Number(response.headers?.get?.("content-length"));
    if (length > maxBytes) throw new Error(`ComfyUI output ${filename} is ${length} bytes, over the ${maxBytes}-byte cap`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`ComfyUI output ${filename} is over the ${maxBytes}-byte cap`);
    return bytes;
  }

  return { url: base, clientId, health, run, download, interrupt };
}
