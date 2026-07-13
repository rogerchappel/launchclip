import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeShotFile, validateHyperFramesRoot } from "./frame_director.js";
import { ensureTimelineRegistration } from "./hyperframes_timeline.js";
import { describeJobOutput, ProductionJobStore, semanticHash } from "./job_store.js";
import { OpenAIResponsesClient } from "./openai_responses.js";
import { FRAME_BUNDLE_SCHEMA, PRODUCTION_PATHS, validateFrameBundle } from "./production_contracts.js";
import { repairProductionPlan } from "./production_plan_repair.js";

const REPAIR_INSTRUCTIONS = `You are repairing one previously authored HyperFrames shot after independent review.

Return a complete replacement frame-bundle JSON. Fix every supplied finding at the smallest scope. Preserve everything listed in each finding and everything in the prior bundle that does not conflict with the repair. Do not redesign unrelated elements.

The replacement must remain a deterministic modular HyperFrames composition: one correctly sized local-time root, class="clip" for timed elements, no remote assets, no fetches, no audio/video tags, and all media requested at the host root with structured placement. Keep exact factual copy and evidence IDs. Presenter video follows one continuous production timeline: its source_start_seconds equals the shot's global start_seconds plus the request's shot-local start_seconds, so a later layout never restarts the take at zero.

Register a paused GSAP timeline exactly on window.__timelines[shot_id]. Give every timeline-visible clip a stable descriptive ID. Style the root by its ID, not a root class. Use only declared @font-face families or Arial, Georgia, or Courier New. Never tween font-size, width, height, top, left, padding, or other reflow properties; use transform and opacity, with initial transforms owned by gsap.set rather than CSS.

Motion assertions must be truthful. When native inspection reports motion_frozen for a must_remain_live assertion, set must_remain_live false unless the asserted element itself has clearly perceptible, inspection-visible transform or opacity motion across the required interval. Do not add imperceptible drift or tiny opacity changes merely to satisfy an assertion.

Every planned shot.visual object and event remains part of the repair contract. Preserve data-visual-object-id identity, return one motion.events record for every planned visible event, and ensure its selector visibly changes at the exact planned time. Never fix a composition issue by replacing semantic graphics with caption cards, and never leave an SFX-bound event without a visible target.`;

export async function repairProduction(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const qaDir = path.join(workspace, PRODUCTION_PATHS.qa);
  const [intake, evidence, plan, critique] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(workspace, PRODUCTION_PATHS.plan)),
    options.trigger === "verification"
      ? Promise.resolve({ verdict: "ship", findings: [] })
      : readOptionalJson(path.join(qaDir, "critique.json"), { verdict: "ship", findings: [] })
  ]);
  const deterministicFindings = await collectDeterministicRepairFindings(workspace, plan);
  if (critique.verdict === "ship" && !deterministicFindings.length) {
    return { stage: "production-repair", status: "not-needed", repaired: [], deterministic_findings: 0 };
  }
  const findings = critique.verdict === "ship"
    ? deterministicFindings
    : [...critique.findings, ...deterministicFindings];
  const broadScopes = new Set(["script", "plan", "audio"]);
  const broadFindings = critique.verdict === "replan"
    ? critique.findings
    : findings.filter((finding) => broadScopes.has(finding.repair_scope));
  if (broadFindings.length) {
    const planRepair = await (adapters.repairProductionPlan ?? repairProductionPlan)(workspace, broadFindings, {
      model: options.model,
      reasoning: options.reasoning,
      semanticAttempts: options.semanticAttempts,
      maxAttempts: options.maxAttempts,
      maxOutputTokens: options.maxOutputTokens,
      background: options.background,
      pro: options.pro
    }, adapters.plan);
    return {
      stage: "production-repair",
      status: "replanned",
      repaired: [],
      deterministic_findings: deterministicFindings.length,
      plan: planRepair,
      actions: { plan_revised: true, audio: "regenerate", frames: "all", assemble: true },
      blockers: [],
      next: "Regenerate audio and all frames from the revised plan, then assemble, verify, and render a new draft."
    };
  }
  if (critique.verdict === "replan") throw new Error("Critique returned replan without an actionable finding");
  const repairableScopes = new Set(["frame", "frames", "assembly", "design"]);
  const repairable = findings.filter((finding) => repairableScopes.has(finding.repair_scope) && finding.shot_ids.length);
  const unsupported = findings.filter((finding) => !repairable.includes(finding));
  const byShot = new Map();
  for (const finding of repairable) {
    for (const shotId of finding.shot_ids) {
      if (!byShot.has(shotId)) byShot.set(shotId, []);
      byShot.get(shotId).push(finding);
    }
  }
  if (!byShot.size) throw new Error(`Critique requires broader work before frame repair: ${unsupported.map((entry) => `${entry.id}:${entry.repair_scope}`).join(", ") || "no repairable shot IDs"}`);
  const store = adapters.store ?? await ProductionJobStore.open(workspace, { create: false });
  const client = adapters.client ?? new OpenAIResponsesClient();
  const images = await snapshotImages(path.join(qaDir, "snapshots"), Number(options.maxSnapshots ?? 8));
  const repaired = [];
  const tasks = [...byShot].map(([shotId, findings]) => async () => {
    const shot = plan.shots.find((entry) => entry.id === shotId);
    if (!shot) throw new Error(`Critique references unknown shot: ${shotId}`);
    const prior = await readJson(safeShotFile(path.join(workspace, PRODUCTION_PATHS.frames), shotId, ".json"));
    const repairInputHash = semanticHash({
      worker: "frame-repair.v3",
      model: options.model ?? "gpt-5.6",
      reasoning: options.reasoning ?? "high",
      shot,
      findings,
      prior
    });
    const canonicalJobId = `frame:${shotId}`;
    const canonical = store.get(canonicalJobId);
    if (canonical?.status !== "succeeded") throw new Error(`Canonical frame job must succeed before repair: ${canonicalJobId}`);
    const jobId = `repair:${shotId}`;
    let current = store.get(jobId);
    if (current && current.input_hash !== repairInputHash) {
      if (current.status !== "stale") await store.markStaleFrom([jobId]);
      current = store.get(jobId);
    }
    if (!current) {
      await store.add({ id: jobId, kind: "frame-repair", depends_on: ["creative-plan"], input_hash: repairInputHash, max_attempts: Number(options.maxAttempts ?? 3) });
      current = store.get(jobId);
    }
    if (current.status === "succeeded") {
      const verification = await store.verifyOutputs(jobId);
      if (verification.ok) {
        await store.replaceSucceededOutputs(canonicalJobId, current.outputs);
        repaired.push({ shot_id: shotId, findings: findings.map((entry) => entry.id), bundle: safeShotFile(path.join(workspace, PRODUCTION_PATHS.frames), shotId, ".json"), html: safeShotFile(path.join(workspace, PRODUCTION_PATHS.frames), shotId, ".html"), response_id: current.remote?.response_id ?? null, cached: true });
        return;
      }
      await store.markStaleFrom([jobId]);
      current = store.get(jobId);
    }
    let resumeResponseId = null;
    if (current.status === "running" || current.status === "submitted") {
      if (!current.remote?.response_id) throw new Error(`Repair job is ${current.status} without a resumable response id: ${jobId}`);
      resumeResponseId = current.remote.response_id;
    } else {
      if (current.status === "failed" || current.status === "stale") await store.retry(jobId, { inputHash: repairInputHash });
      await store.markRunning(jobId, { provider: "openai", response_id: null, status: "repairing" });
    }
    try {
      let previousCandidate = null;
      let validationErrors = [];
      const semanticAttempts = Number(options.semanticAttempts ?? 2);
      if (!Number.isInteger(semanticAttempts) || semanticAttempts <= 0) throw new Error("Repair semantic attempts must be a positive integer");
      for (let attempt = 1; attempt <= semanticAttempts; attempt += 1) {
        const request = {
          model: options.model ?? "gpt-5.6",
          reasoningEffort: options.reasoning ?? "high",
          reasoningContext: "current_turn",
          instructions: REPAIR_INSTRUCTIONS,
          input: JSON.stringify({
            global_design: plan.design,
            format: plan.format,
            shot,
            findings,
            prior_bundle: previousCandidate ?? prior,
            validation_errors_to_repair: validationErrors,
            available_resources: intake.resources.map((entry) => ({ id: entry.id, role: entry.role, type: entry.type, local_path: entry.is_remote ? null : entry.location })),
            evidence_index: evidence.items.map((entry) => ({ id: entry.id, title: entry.title, provenance: entry.provenance }))
          }),
          images,
          schema: FRAME_BUNDLE_SCHEMA,
          schemaName: "launchclip_repaired_frame_bundle",
          background: options.background !== false,
          maxOutputTokens: Number(options.maxOutputTokens ?? 36_000),
          promptCacheKey: "launchclip:frame-repair:v2",
          metadata: { job_id: jobId, shot_id: shotId, repair_findings: findings.length, attempt },
          onSubmitted: async (response) => store.markRunning(jobId, { provider: "openai", response_id: response.id, status: response.status })
        };
        const result = resumeResponseId ? await client.resumeStructured(resumeResponseId, request) : await client.runStructured(request);
        resumeResponseId = null;
        const candidate = { ...result.value, html: ensureTimelineRegistration(result.value.html, shotId) };
        const validation = validateFrameBundle(candidate, {
          shotId,
          shot,
          format: plan.format,
          evidenceIds: evidence.items.map((entry) => entry.id),
          resourceIds: intake.resources.map((entry) => entry.id),
          resourceRoles: Object.fromEntries(intake.resources.map((entry) => [entry.id, entry.role])),
          allowedAssetPaths: intake.resources.filter((entry) => !entry.is_remote && entry.type !== "directory").map((entry) => entry.location)
        });
        validationErrors = [...validation.errors, ...validateHyperFramesRoot(candidate.html, shot, plan.format)];
        if (validationErrors.length) {
          previousCandidate = candidate;
          if (attempt < semanticAttempts) continue;
          throw new Error(`Repaired frame ${shotId} failed validation: ${validationErrors.join("; ")}`);
        }
        const paths = await writeFrameArtifacts(workspace, candidate);
        await store.markRunning(jobId, { provider: "openai", response_id: result.response_id, status: result.status });
        const outputs = await Promise.all(paths.map((filePath) => describeJobOutput(workspace, filePath)));
        await store.replaceSucceededOutputs(canonicalJobId, outputs);
        await store.markSucceeded(jobId, outputs, result.usage);
        repaired.push({ shot_id: shotId, findings: findings.map((entry) => entry.id), bundle: paths[0], html: paths[1], response_id: result.response_id, cached: false });
        break;
      }
    } catch (error) {
      if (["running", "submitted"].includes(store.get(jobId)?.status)) await store.markFailed(jobId, error);
      throw error;
    }
  });
  await runPool(tasks, Number(options.concurrency ?? 3));
  return {
    stage: "production-repair",
    status: unsupported.length ? "partially-repaired" : "repaired",
    repaired,
    deterministic_findings: deterministicFindings.length,
    blockers: unsupported.map((finding) => ({ id: finding.id, repair_scope: finding.repair_scope, instruction: finding.instruction })),
    next: "Re-run launchclip assemble and production-verify; resolve any listed blockers before production-render."
  };
}

export async function collectDeterministicRepairFindings(workspacePath, plan) {
  const workspace = path.resolve(workspacePath);
  const findings = [];
  const lintPath = path.join(workspace, PRODUCTION_PATHS.qa, "lint.json");
  const lintInfo = await optionalStat(lintPath);
  const lint = lintInfo ? await readJson(lintPath) : null;
  for (const shot of plan.shots ?? []) {
    const reportPath = path.join(workspace, PRODUCTION_PATHS.qa, "shot-inspect", shot.id, "inspect.json");
    const framePath = safeShotFile(path.join(workspace, PRODUCTION_PATHS.frames), shot.id, ".html");
    const [reportInfo, frameInfo] = await Promise.all([optionalStat(reportPath), optionalStat(framePath)]);
    if (!frameInfo) continue;
    const rawIssues = [];
    if (reportInfo && reportInfo.mtimeMs >= frameInfo.mtimeMs) {
      const report = await readJson(reportPath);
      if (report.ok === false) {
        const inspectIssues = Array.isArray(report.stdout?.issues)
          ? report.stdout.issues.filter((issue) => issue?.severity === "error")
          : [];
        rawIssues.push(...(inspectIssues.length ? inspectIssues : [{
          code: "inspect_failed",
          severity: "error",
          message: String(report.stderr || "Shot-local HyperFrames inspection failed without structured issue details.").slice(0, 2_000),
          selector: null,
          fixHint: "Correct the shot-local runtime or composition error, then make native inspection pass."
        }]));
      }
    }
    if (lintInfo && lintInfo.mtimeMs >= frameInfo.mtimeMs) {
      const expectedFile = `${shot.id}.html`;
      const lintFindings = Array.isArray(lint?.stdout?.findings) ? lint.stdout.findings : [];
      rawIssues.push(...lintFindings
        .filter((finding) => ["error", "warning"].includes(finding?.severity) && path.basename(String(finding.file ?? "")) === expectedFile)
        .map(lintRepairIssue));
    }
    const issues = uniqueIssues(rawIssues);
    if (!issues.length) continue;
    const codes = issues.map((issue) => String(issue.code ?? "inspect_failed"));
    findings.push({
      id: `native-${shot.id}`,
      severity: "major",
      category: nativeCategory(codes),
      shot_ids: [shot.id],
      start_seconds: Number.isFinite(Number(shot.start_seconds)) ? Number(shot.start_seconds) : null,
      end_seconds: Number.isFinite(Number(shot.end_seconds)) ? Number(shot.end_seconds) : null,
      evidence: `Shot-local HyperFrames inspection failed with ${issues.length} unique blocking issue${issues.length === 1 ? "" : "s"}: ${issues.map(describeNativeIssue).join("; ")}`,
      repair_scope: "frame",
      instruction: `Make native shot-local inspection pass by correcting these issues: ${issues.map(describeNativeIssue).join("; ")}. Do not hide a real defect with a layout-allow annotation; use one only when the overlap or off-canvas state is visibly intentional and remains legible. Motion assertions must describe motion on the asserted element itself.`,
      preserve: ["Factual copy and evidence grounding", "The established art direction", "Unrelated composition and motion"]
    });
  }
  return findings;
}

function uniqueIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = [issue.code, issue.selector, issue.message].map((value) => String(value ?? "")).join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeNativeIssue(issue) {
  const selector = issue.selector ? ` at ${issue.selector}` : "";
  const hint = issue.fixHint ? ` (${String(issue.fixHint).trim()})` : "";
  return `${issue.code ?? "inspect_failed"}${selector}: ${String(issue.message ?? "inspection failed").trim()}${hint}`;
}

function lintRepairIssue(finding) {
  const message = String(finding.message ?? "HyperFrames lint failed");
  return {
    code: /GSAP tweens overlap/i.test(message) ? "motion_tween_overlap" : `lint_${String(finding.rule ?? "warning").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    severity: finding.severity,
    message,
    selector: finding.selector ?? null,
    fixHint: "Resolve the lint finding without weakening strict verification."
  };
}

function nativeCategory(codes) {
  if (codes.every((code) => code.startsWith("motion_"))) return "motion";
  if (codes.every((code) => code.includes("text") || code.includes("typography"))) return "typography";
  return "composition";
}

async function optionalStat(filePath) {
  try { return await stat(filePath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function runPool(tasks, concurrency) {
  if (!Number.isInteger(concurrency) || concurrency <= 0) throw new Error("Repair concurrency must be a positive integer");
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      await tasks[index]();
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  const failed = settled.find((entry) => entry.status === "rejected");
  if (failed) throw failed.reason;
}

async function writeFrameArtifacts(workspace, bundle) {
  const directory = path.join(workspace, PRODUCTION_PATHS.frames);
  const paths = [safeShotFile(directory, bundle.shot_id, ".json"), safeShotFile(directory, bundle.shot_id, ".html"), safeShotFile(directory, bundle.shot_id, ".motion.json")];
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

async function readOptionalJson(filePath, fallback = null) {
  try { return await readJson(filePath); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, filePath);
}
