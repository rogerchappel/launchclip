// One cached ComfyUI generation: check the licence, bind the template, and
// return the cached file for those exact inputs, or check the server's health
// (once per client and template), run it, save the output under its key and
// log it. Callers treat any thrown error as "no generated file" and fall back
// to what they did before ComfyUI existed.
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../atomic_write.js";
import { assertLicence, bindTemplate, licenceName, templateNeeds, workflowKey } from "./templates.js";

const checked = new WeakMap();

/** health() once per client and template; throws with the reason when the server cannot run it. */
export async function ensureReady(client, template) {
  const seen = checked.get(client) ?? new Map();
  checked.set(client, seen);
  if (!seen.has(template.id)) seen.set(template.id, client.health(templateNeeds(template)));
  const health = await seen.get(template.id);
  if (!health.ok) throw new Error(`ComfyUI cannot run ${template.id}: ${health.reason}`);
  return health;
}

/**
 * → {file, key, cached, template, model, licence, licence_name, seed, prompt}.
 * options: {client, template, values, cacheDir, allowLicences, ledger (a JSONL path), extra (ledger fields), now}.
 */
export async function generateWithComfy({ client, template, values = {}, cacheDir, allowLicences = [], ledger = null, extra = {}, now = () => new Date().toISOString() }) {
  const licence = assertLicence(template, allowLicences);
  const workflow = bindTemplate(template, values);
  const key = workflowKey(template, workflow);
  const metaFile = path.join(cacheDir, `${key}.json`);
  const describe = (file, cached) => ({ file, key, cached, template: template.id, model: template.model.name, licence, licence_name: licenceName(licence), seed: values.seed ?? template.inputs.seed ?? null, prompt: values.prompt ?? template.inputs.prompt ?? null });
  if (existsSync(metaFile)) {
    const meta = JSON.parse(await readFile(metaFile, "utf8"));
    const file = path.join(cacheDir, meta.file);
    if (existsSync(file)) return describe(file, true);
  }
  if (!client) throw new Error(`ComfyUI output for ${template.id} is not cached and no ComfyUI client was given`);
  await ensureReady(client, template);
  const started = Date.now();
  const { prompt_id: promptId, files } = await client.run(workflow, { outputNodes: template.output_nodes });
  const extension = (path.extname(files[0].filename).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) ?? [".bin"])[0];
  const name = `${key}${extension}`;
  await mkdir(cacheDir, { recursive: true });
  await writeFileAtomic(path.join(cacheDir, name), await client.download(files[0]));
  const result = describe(path.join(cacheDir, name), false);
  await writeFileAtomic(metaFile, `${JSON.stringify({ file: name, template: template.id, model: template.model.name, licence, values: { ...template.inputs, ...values }, prompt_id: promptId, created_at: now() }, null, 2)}\n`);
  if (ledger) {
    await mkdir(path.dirname(ledger), { recursive: true });
    await appendFile(ledger, `${JSON.stringify({ ...extra, provider: "comfy", template: template.id, model: template.model.name, seed: result.seed, key, licence, cost: { amount: 0, unit: "local" }, seconds: Math.round((Date.now() - started) / 100) / 10, file: result.file, at: now() })}\n`);
  }
  return result;
}
