// ComfyUI workflow templates: API-format workflow JSON we wrote, from core
// nodes only, with the inputs a caller may set written as "{{name}}" strings
// and their defaults in `inputs`. LaunchClip runs no workflow it did not
// template (custom nodes run arbitrary Python), so there is no way to pass
// one in. Each template names its model, the files a loader must list, and
// the model's licence; a licence off the open allowlist needs the user's
// --allow-model-licence <id>, and the id travels with every output.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { workflowNodes } from "./client.js";

export const TEMPLATE_DIR = path.join(import.meta.dirname, "templates");
export const TEMPLATE_SCHEMA = "launchclip.comfy-template.v1";

// open: allowed without --allow-model-licence. Re-verify a row when its template changes.
export const MODEL_LICENCES = Object.freeze({
  "apache-2.0": { name: "Apache License 2.0", open: true },
  mit: { name: "MIT License", open: true },
  "bsd-3-clause": { name: "BSD 3-Clause License", open: true },
  "creativeml-openrail++-m": { name: "CreativeML Open RAIL++-M (use-based restrictions)", open: true },
  "stability-ai-community": { name: "Stability AI Community License (free under US$1M annual revenue; enterprise licence above)", open: false },
  "ltxv-open-weights": { name: "LTX-Video open weights licence (check its terms)", open: false }
});

export function licenceName(id) {
  return MODEL_LICENCES[id]?.name ?? id;
}

/** Throws unless the template's model licence is open or the user allowed it by id. */
export function assertLicence(template, allow = []) {
  const id = template.model.licence;
  if (MODEL_LICENCES[id]?.open || allow.includes(id)) return id;
  throw new Error(`ComfyUI template ${template.id} uses ${template.model.name}, licensed under ${licenceName(id)}, which is not on the open-licence allowlist. Nothing was sent. Pass --allow-model-licence ${id} if your use is within its terms.`);
}

export function validateTemplate(template) {
  const where = `ComfyUI template ${template?.id ?? "(unnamed)"}`;
  if (template?.schema_version !== TEMPLATE_SCHEMA) throw new Error(`${where} is not ${TEMPLATE_SCHEMA}`);
  if (!template.model?.licence || !Array.isArray(template.model.files)) throw new Error(`${where} has no model licence or files`);
  if (!template.workflow || !Array.isArray(template.output_nodes) || !template.output_nodes.every((id) => template.workflow[id])) throw new Error(`${where} has no workflow or a missing output node`);
  const used = new Set(JSON.stringify(template.workflow).match(/"\{\{(\w+)\}\}"/g)?.map((slot) => slot.slice(3, -3)) ?? []);
  const unknown = [...used].filter((name) => !(name in (template.inputs ?? {})));
  if (unknown.length) throw new Error(`${where} binds inputs with no default: ${unknown.join(", ")}`);
  return template;
}

export async function loadTemplate(id, { dir = TEMPLATE_DIR } = {}) {
  if (!/^[a-z0-9-]+$/.test(String(id))) throw new Error(`Bad ComfyUI template id: ${id}`);
  let text;
  try { text = await readFile(path.join(dir, `${id}.json`), "utf8"); } catch { throw new Error(`Unknown ComfyUI template ${id}. Templates: ${(await listTemplates({ dir })).join(", ")}`); }
  return validateTemplate(JSON.parse(text));
}

export async function listTemplates({ dir = TEMPLATE_DIR } = {}) {
  return (await readdir(dir)).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort();
}

/** The workflow with every "{{name}}" replaced by values[name] ?? the default. Values must match the default's type. */
export function bindTemplate(template, values = {}) {
  for (const [name, value] of Object.entries(values)) {
    if (!(name in template.inputs)) throw new Error(`ComfyUI template ${template.id} has no input "${name}"`);
    if (typeof value !== typeof template.inputs[name] || (typeof value === "number" && !Number.isFinite(value))) throw new Error(`ComfyUI template ${template.id} input "${name}" must be a ${typeof template.inputs[name]}`);
  }
  const bound = { ...template.inputs, ...values };
  const fill = (node) => {
    if (typeof node === "string") { const slot = /^\{\{(\w+)\}\}$/.exec(node); return slot ? bound[slot[1]] : node; }
    if (Array.isArray(node)) return node.map(fill);
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, fill(value)]));
    return node;
  };
  return fill(template.workflow);
}

/** What health() must find for this template: its node classes and model files. */
export function templateNeeds(template) {
  return { nodes: workflowNodes(template.workflow), models: template.model.files };
}

/** The cache key of one bound workflow: every input, model file and the seed are in it. */
export function workflowKey(template, workflow) {
  return createHash("sha256").update(JSON.stringify({ template: template.id, workflow })).digest("hex");
}
