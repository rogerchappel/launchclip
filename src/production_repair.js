import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateHyperFramesRoot } from "./frame_director.js";
import { describeJobOutput, ProductionJobStore } from "./job_store.js";
import { OpenAIResponsesClient } from "./openai_responses.js";
import { FRAME_BUNDLE_SCHEMA, PRODUCTION_PATHS, validateFrameBundle } from "./production_contracts.js";

const REPAIR_INSTRUCTIONS = `You are repairing one previously authored HyperFrames shot after independent review.

Return a complete replacement frame-bundle JSON. Fix every supplied finding at the smallest scope. Preserve everything listed in each finding and everything in the prior bundle that does not conflict with the repair. Do not redesign unrelated elements.

The replacement must remain a deterministic modular HyperFrames composition: one correctly sized local-time root, class="clip" for timed elements, no remote assets, no fetches, no audio/video tags, and all media requested at the host root with structured placement. Keep exact factual copy and evidence IDs.`;

export async function repairProduction(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const qaDir = path.join(workspace, PRODUCTION_PATHS.qa);
  const [intake, evidence, plan, critique] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(workspace, PRODUCTION_PATHS.plan)),
    readJson(path.join(qaDir, "critique.json"))
  ]);
  if (critique.verdict === "ship") return { stage: "production-repair", status: "not-needed", repaired: [] };
  const unsupported = critique.findings.filter((finding) => !["frame", "frames"].includes(finding.repair_scope));
  if (critique.verdict === "replan" || unsupported.length) {
    throw new Error(`Critique requires broader work before frame repair: ${unsupported.map((entry) => `${entry.id}:${entry.repair_scope}`).join(", ") || "replan"}`);
  }
  const byShot = new Map();
  for (const finding of critique.findings) {
    for (const shotId of finding.shot_ids) {
      if (!byShot.has(shotId)) byShot.set(shotId, []);
      byShot.get(shotId).push(finding);
    }
  }
  if (!byShot.size) throw new Error("Frame repair critique did not identify any shot IDs");
  const store = adapters.store ?? await ProductionJobStore.open(workspace, { create: false });
  const jobIds = [...byShot.keys()].map((shotId) => `frame:${shotId}`);
  await store.markStaleFrom(jobIds);
  const client = adapters.client ?? new OpenAIResponsesClient();
  const images = await snapshotImages(path.join(qaDir, "snapshots"), Number(options.maxSnapshots ?? 8));
  const repaired = [];
  for (const [shotId, findings] of byShot) {
    const shot = plan.shots.find((entry) => entry.id === shotId);
    if (!shot) throw new Error(`Critique references unknown shot: ${shotId}`);
    const prior = await readJson(path.join(workspace, PRODUCTION_PATHS.frames, `${shotId}.json`));
    const jobId = `frame:${shotId}`;
    await store.retry(jobId);
    await store.markRunning(jobId, { provider: "openai", response_id: null, status: "repairing" });
    try {
      const result = await client.runStructured({
        model: options.model ?? "gpt-5.6",
        reasoningEffort: options.reasoning ?? "high",
        reasoningContext: "current_turn",
        instructions: REPAIR_INSTRUCTIONS,
        input: JSON.stringify({
          global_design: plan.design,
          format: plan.format,
          shot,
          findings,
          prior_bundle: prior,
          available_resources: intake.resources.map((entry) => ({ id: entry.id, role: entry.role, type: entry.type, local_path: entry.is_remote ? null : entry.location })),
          evidence_index: evidence.items.map((entry) => ({ id: entry.id, title: entry.title, provenance: entry.provenance }))
        }),
        images,
        schema: FRAME_BUNDLE_SCHEMA,
        schemaName: "launchclip_repaired_frame_bundle",
        background: options.background !== false,
        maxOutputTokens: Number(options.maxOutputTokens ?? 36_000),
        promptCacheKey: "launchclip:frame-repair:v1",
        metadata: { job_id: jobId, shot_id: shotId, repair_findings: findings.length }
      });
      const validation = validateFrameBundle(result.value, {
        shotId,
        evidenceIds: evidence.items.map((entry) => entry.id),
        resourceIds: intake.resources.map((entry) => entry.id)
      });
      const errors = [...validation.errors, ...validateHyperFramesRoot(result.value.html, shot, plan.format)];
      if (errors.length) throw new Error(`Repaired frame ${shotId} failed validation: ${errors.join("; ")}`);
      const paths = await writeFrameArtifacts(workspace, result.value);
      await store.markRunning(jobId, { provider: "openai", response_id: result.response_id, status: result.status });
      const outputs = await Promise.all(paths.map((filePath) => describeJobOutput(workspace, filePath)));
      await store.markSucceeded(jobId, outputs, result.usage);
      repaired.push({ shot_id: shotId, findings: findings.map((entry) => entry.id), bundle: paths[0], html: paths[1], response_id: result.response_id });
    } catch (error) {
      await store.markFailed(jobId, error);
      throw error;
    }
  }
  return { stage: "production-repair", status: "repaired", repaired, next: "Re-run launchclip assemble, production-verify, and production-render." };
}

async function writeFrameArtifacts(workspace, bundle) {
  const directory = path.join(workspace, PRODUCTION_PATHS.frames);
  const paths = [path.join(directory, `${bundle.shot_id}.json`), path.join(directory, `${bundle.shot_id}.html`), path.join(directory, `${bundle.shot_id}.motion.json`)];
  await writeAtomic(paths[0], `${JSON.stringify(bundle, null, 2)}\n`);
  await writeAtomic(paths[1], `${bundle.html.trim()}\n`);
  await writeAtomic(paths[2], `${JSON.stringify(bundle.motion, null, 2)}\n`);
  return paths;
}

async function snapshotImages(directory, limit) {
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  return Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    return { url: `data:${mime};base64,${(await readFile(filePath)).toString("base64")}`, detail: "original" };
  }));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, filePath);
}
