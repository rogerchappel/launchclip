import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFrameSelection, safeShotFile, sanitizeFrameBundle, validateHyperFramesRoot, writeFrameArtifacts } from "./frame_director.js";
import { verifyFrameCandidate } from "./frame_candidate_verify.js";
import { ensureTimelineRegistration } from "./hyperframes_timeline.js";
import { describeJobOutput, ProductionJobStore, semanticHash } from "./job_store.js";
import { createStructuredClient, modelRouteKey, parseModelRoutes } from "./model_provider.js";
import { PRODUCTION_PATHS, validateFrameBundle } from "./production_contracts.js";
import { repairProductionPlan } from "./production_plan_repair.js";

const REPAIR_INSTRUCTIONS = `You are repairing one previously authored HyperFrames shot after independent review.

Return only a small source-edit patch. Fix every supplied finding at the smallest scope. Preserve everything listed in each finding and everything in the prior bundle that does not conflict with the repair. Do not return or rewrite the complete frame bundle, complete HTML, or an unrelated component. Do not redesign unrelated elements.

Each edit targets one exact source string in html, motion, root_media_requests, evidence_ids, visible_copy, or preserve. Exact target sources are supplied unescaped between named source markers. Copy each find string verbatim from inside the matching marker; the markers themselves are not source. The find string must occur exactly once in that target. Include enough unchanged surrounding text to make it unique, then replace only the minimum necessary characters. Prefer changing an existing declaration, selector, assertion, or local component over replacing a large block.

The replacement must remain a deterministic modular HyperFrames composition: one correctly sized local-time root, class="clip" for timed elements, no remote assets, no fetches, no audio/video tags, and all media requested at the host root with structured placement. Keep exact factual copy and evidence IDs. Presenter video follows one continuous production timeline: its source_start_seconds equals the shot's global start_seconds plus the request's shot-local start_seconds, so a later layout never restarts the take at zero.

Register a paused GSAP timeline exactly on window.__timelines[shot_id]. Give every timeline-visible clip a stable descriptive ID. Style the root by its ID, not a root class. Use only declared @font-face families or Arial, Georgia, or Courier New. Never tween font-size, width, height, top, left, padding, or other reflow properties; use transform and opacity, with initial transforms owned by gsap.set rather than CSS.

Motion assertions must be truthful. When native inspection reports motion_frozen for a must_remain_live assertion, set must_remain_live false unless the asserted element itself has clearly perceptible, inspection-visible transform or opacity motion across the required interval. Do not add imperceptible drift or tiny opacity changes merely to satisfy an assertion.

Every planned shot.visual object and event remains part of the repair contract. Preserve data-visual-object-id identity, return one motion.events record for every planned visible event, and ensure its selector visibly changes at the exact planned time. Never fix a composition issue by replacing semantic graphics with caption cards, and never leave an SFX-bound event without a visible target.`;

export const FRAME_PATCH_VERSION = "launchclip.frame-patch.v1";
export const FRAME_PATCH_SCHEMA = {
  type: "object",
  properties: {
    schema_version: { type: "string", enum: [FRAME_PATCH_VERSION] },
    shot_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$" },
    summary: { type: "string", maxLength: 500 },
    edits: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["html", "motion", "root_media_requests", "evidence_ids", "visible_copy", "preserve"] },
          find: { type: "string", minLength: 1, maxLength: 1_000 },
          replace: { type: "string", maxLength: 1_200 }
        },
        required: ["target", "find", "replace"],
        additionalProperties: false
      }
    }
  },
  required: ["schema_version", "shot_id", "summary", "edits"],
  additionalProperties: false
};

export async function repairProduction(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  if (options.verification?.infrastructure_failed?.length) throw infrastructureRepairError(options.verification.infrastructure_failed);
  const qaDir = path.join(workspace, PRODUCTION_PATHS.qa);
  const [intake, evidence, plan, critique] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(workspace, PRODUCTION_PATHS.plan)),
    options.trigger === "verification"
      ? Promise.resolve({ verdict: "ship", findings: [] })
      : readOptionalJson(path.join(qaDir, "critique.json"), { verdict: "ship", findings: [] })
  ]);
  const deterministicFindings = await collectDeterministicRepairFindings(workspace, plan, { maxIssuesPerShot: options.maxIssuesPerShot });
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
  const routes = repairModelRoutes(options, intake);
  const images = await snapshotImages(path.join(qaDir, "snapshots"), Number(options.maxSnapshots ?? 8));
  const repaired = [];
  const tasks = [...byShot].map(([shotId, findings]) => async () => {
    const shot = plan.shots.find((entry) => entry.id === shotId);
    if (!shot) throw new Error(`Critique references unknown shot: ${shotId}`);
    const prior = (await readFrameSelection(workspace, shotId)).bundle;
    const repairInputHash = semanticHash({
      worker: "frame-repair.v7",
      candidate_verification: "browser-snapshot.v1",
      routes: routes.map(modelRouteKey),
      max_patch_ratio: Number(options.maxPatchRatio ?? .35),
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
      await store.markRunning(jobId, { provider: routes[0].provider, response_id: null, status: "repairing" });
    }
    try {
      let previousCandidate = prior;
      let validationErrors = [];
      const semanticAttempts = Number(options.semanticAttempts ?? 2);
      if (!Number.isInteger(semanticAttempts) || semanticAttempts <= 0) throw new Error("Repair semantic attempts must be a positive integer");
      let completed = false;
      let totalAttempt = 0;
      for (const [routeIndex, route] of routes.entries()) {
        const client = adapters.client ?? (adapters.createClient ?? createStructuredClient)(route);
        const attemptsForRoute = routeIndex === 0 ? semanticAttempts : 1;
        for (let routeAttempt = 1; routeAttempt <= attemptsForRoute; routeAttempt += 1) {
          totalAttempt += 1;
          const request = {
            model: route.model,
            reasoningEffort: route.reasoning,
            reasoningContext: "current_turn",
            instructions: REPAIR_INSTRUCTIONS,
            input: buildRepairInput({
              plan,
              shot,
              findings,
              prior: previousCandidate,
              validationErrors,
              maxPatchRatio: options.maxPatchRatio,
              resources: intake.resources,
              evidenceItems: evidence.items
            }),
            images: client.supportsImages === false ? [] : images,
            schema: FRAME_PATCH_SCHEMA,
            schemaName: "launchclip_frame_patch",
            background: options.background !== false,
            maxOutputTokens: Number(options.maxOutputTokens ?? 8_000),
            promptCacheKey: "launchclip:frame-repair-patch:v1",
            metadata: { job_id: jobId, shot_id: shotId, repair_findings: findings.length, attempt: totalAttempt, route: routeIndex + 1 },
            onSubmitted: async (response) => store.markRunning(jobId, { provider: route.provider, response_id: response.id, status: response.status })
          };
          let result;
          try {
            result = resumeResponseId && routeIndex === 0 && client.supportsResume !== false
              ? await client.resumeStructured(resumeResponseId, request)
              : await client.runStructured(request);
            resumeResponseId = null;
            const patched = applyFramePatch(previousCandidate, result.value, {
              maxPatchRatio: options.maxPatchRatio,
              allowPartial: route.provider === "ollama",
              allowRetarget: route.provider === "ollama"
            });
            const normalized = { ...patched.bundle, html: ensureTimelineRegistration(patched.bundle.html, shotId) };
            const sanitized = sanitizeFrameBundle(normalized, {
              shot,
              format: plan.format,
              resourceRoles: Object.fromEntries(intake.resources.map((entry) => [entry.id, entry.role]))
            });
            const candidate = sanitized.bundle;
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
            previousCandidate = candidate;
            if (validationErrors.length) continue;
            const candidateVerification = await (adapters.verifyCandidate ?? verifyFrameCandidate)(workspace, candidate, {
              shot,
              format: plan.format,
              attempt: `${totalAttempt}-${route.provider}-${route.model}`
            }, { run: adapters.run });
            if (!candidateVerification?.ok) {
              if (candidateVerification?.failure_kind === "infrastructure") throw infrastructureRepairError([`candidate:${shotId}`]);
              validationErrors = [`Candidate visual verification failed: ${candidateVerification?.error ?? "the mounted frame did not pass browser snapshots"}`];
              continue;
            }
            const paths = await writeFrameArtifacts(workspace, candidate);
            await store.markRunning(jobId, { provider: route.provider, response_id: result.response_id, status: result.status });
            const outputs = await Promise.all(paths.map((filePath) => describeJobOutput(workspace, filePath)));
            await store.replaceSucceededOutputs(canonicalJobId, outputs);
            await store.markSucceeded(jobId, outputs, result.usage);
            repaired.push({
              shot_id: shotId,
              findings: findings.map((entry) => entry.id),
              bundle: paths[0],
              html: paths[1],
              response_id: result.response_id,
              provider: route.provider,
              model: result.model,
              patch: { edits: patched.edits, rejected_edits: patched.rejectedEdits.length, changed_ratio: patched.changedRatio },
              candidate_verification: { report: candidateVerification.report ?? null, snapshots: candidateVerification.snapshots ?? null },
              cached: false
            });
            completed = true;
            break;
          } catch (error) {
            if (error.code === "LAUNCHCLIP_PRODUCTION_INFRASTRUCTURE_FAILED") throw error;
            resumeResponseId = null;
            validationErrors = [`Patch attempt ${totalAttempt} via ${route.provider}:${route.model} failed: ${error.message}`];
          }
        }
        if (completed) break;
      }
      if (!completed) throw new Error(`Repaired frame ${shotId} exhausted small-patch routes: ${validationErrors.join("; ")}`);
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

export function buildRepairInput({ plan, shot, findings, prior, validationErrors = [], maxPatchRatio = .35, resources = [], evidenceItems = [] }) {
  const context = {
    global_design: plan.design,
    format: plan.format,
    shot,
    findings,
    validation_errors_to_repair: validationErrors,
    patch_limits: { maximum_edits: 12, maximum_changed_ratio: Number(maxPatchRatio ?? .35) },
    prior_identity: { schema_version: prior.schema_version, shot_id: prior.shot_id },
    available_resources: resources.map((entry) => ({ id: entry.id, role: entry.role, type: entry.type })),
    allowed_evidence_ids: evidenceItems.map((entry) => entry.id)
  };
  const sources = {
    html: String(prior.html ?? ""),
    motion: JSON.stringify(prior.motion, null, 2),
    root_media_requests: JSON.stringify(prior.root_media_requests, null, 2),
    evidence_ids: JSON.stringify(prior.evidence_ids, null, 2),
    visible_copy: JSON.stringify(prior.visible_copy, null, 2),
    preserve: JSON.stringify(prior.preserve, null, 2)
  };
  return [
    "Repair context:",
    "<launchclip-context-json>",
    JSON.stringify(context, null, 2),
    "</launchclip-context-json>",
    "Exact target sources follow. Copy find strings verbatim from the matching marker; do not include the marker.",
    ...Object.entries(sources).flatMap(([target, source]) => [
      `<launchclip-source target="${target}">`,
      source,
      "</launchclip-source>"
    ])
  ].join("\n");
}

export function applyFramePatch(bundle, patch, options = {}) {
  if (patch?.schema_version !== FRAME_PATCH_VERSION) throw patchError(`schema_version must be ${FRAME_PATCH_VERSION}`);
  if (patch?.shot_id !== bundle?.shot_id) throw patchError(`shot_id must remain ${bundle?.shot_id}`);
  if (!Array.isArray(patch?.edits) || !patch.edits.length || patch.edits.length > 12) throw patchError("patch must contain 1-12 edits");
  const candidate = structuredClone(bundle);
  const originals = new Map();
  const sources = new Map();
  const rejectedEdits = [];
  const acceptedEdits = [];
  for (const target of ["html", "motion", "root_media_requests", "evidence_ids", "visible_copy", "preserve"]) {
    const source = target === "html" ? String(candidate.html ?? "") : JSON.stringify(candidate[target], null, 2);
    originals.set(target, source);
    sources.set(target, source);
  }
  let changedCharacters = 0;
  for (const [index, edit] of patch.edits.entries()) {
    if (!sources.has(edit?.target)) throw patchError(`edits[${index}] has unsupported target ${edit?.target}`);
    const find = String(edit.find ?? "");
    const replace = String(edit.replace ?? "");
    if (!find) throw patchError(`edits[${index}].find must not be empty`);
    if (find.length > 1_000) throw patchError(`edits[${index}].find exceeds 1000 characters`);
    if (replace.length > 1_200) throw patchError(`edits[${index}].replace exceeds 1200 characters`);
    let target = edit.target;
    let source = sources.get(target);
    let occurrences = countOccurrences(source, find);
    if (occurrences === 0 && options.allowRetarget) {
      const matches = [...sources].filter(([, candidate]) => countOccurrences(candidate, find) === 1);
      if (matches.length === 1) {
        [target, source] = matches[0];
        occurrences = 1;
      }
    }
    if (occurrences !== 1) {
      const reason = `find string must occur exactly once in ${edit.target}; found ${occurrences}`;
      if (!options.allowPartial) throw patchError(`edits[${index}] ${reason}`);
      rejectedEdits.push({ index, target: edit.target, reason });
      continue;
    }
    sources.set(target, source.replace(find, replace));
    changedCharacters += Math.max(find.length, replace.length);
    acceptedEdits.push(target === edit.target ? edit : { ...edit, target });
  }
  if (!acceptedEdits.length) {
    const previews = rejectedEdits.slice(0, 3).map((entry) => {
      const find = String(patch.edits[entry.index]?.find ?? "").slice(0, 160);
      return `edit ${entry.index} ${entry.target} ${entry.reason}; find=${JSON.stringify(find)}`;
    });
    throw patchError(`no exact edits were applicable${rejectedEdits.length ? `; rejected ${rejectedEdits.length}: ${previews.join(" | ")}` : ""}`);
  }
  const touchedCharacters = [...new Set(acceptedEdits.map((edit) => edit.target))]
    .reduce((total, target) => total + originals.get(target).length, 0);
  const changedRatio = touchedCharacters ? changedCharacters / touchedCharacters : 1;
  const maximum = Number(options.maxPatchRatio ?? .35);
  if (!Number.isFinite(maximum) || maximum <= 0 || maximum > 1) throw new Error("maxPatchRatio must be greater than 0 and at most 1");
  if (changedRatio > maximum) throw patchError(`patch changes ${(changedRatio * 100).toFixed(1)}% of its targets; maximum is ${(maximum * 100).toFixed(1)}%`);
  candidate.html = sources.get("html");
  for (const target of ["motion", "root_media_requests", "evidence_ids", "visible_copy", "preserve"]) {
    try { candidate[target] = JSON.parse(sources.get(target)); }
    catch (error) { throw patchError(`patch made ${target} invalid JSON: ${error.message}`); }
  }
  return { bundle: candidate, edits: acceptedEdits.length, rejectedEdits, changedRatio: Number(changedRatio.toFixed(4)) };
}

function repairModelRoutes(options, intake) {
  const defaults = {
    provider: options.provider ?? intake.model?.provider ?? "openai",
    model: options.model ?? "gpt-5.6-luna",
    reasoning: options.reasoning ?? "medium",
    baseUrl: options.baseUrl,
    supportsImages: options.supportsImages
  };
  return parseModelRoutes(options.routes, defaults);
}

function countOccurrences(source, value) {
  let count = 0;
  let cursor = 0;
  while ((cursor = source.indexOf(value, cursor)) >= 0) {
    count += 1;
    cursor += Math.max(1, value.length);
  }
  return count;
}

function patchError(message) {
  const error = new Error(`Invalid frame patch: ${message}`);
  error.code = "LAUNCHCLIP_INVALID_FRAME_PATCH";
  return error;
}

export async function collectDeterministicRepairFindings(workspacePath, plan, options = {}) {
  const workspace = path.resolve(workspacePath);
  const maxIssuesPerShot = Number(options.maxIssuesPerShot ?? 4);
  if (!Number.isInteger(maxIssuesPerShot) || maxIssuesPerShot <= 0) throw new Error("Repair issues per shot must be a positive integer");
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
        if (report.failure_kind === "infrastructure") throw infrastructureRepairError([`inspect:${shot.id}`]);
        const inspectIssues = currentHyperFramesIssues(report.stdout);
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
    const unique = uniqueIssues(rawIssues);
    const errors = unique.filter((issue) => String(issue?.severity ?? "").toLowerCase() === "error");
    const allIssues = (errors.length ? errors : unique).sort((left, right) => nativeIssueRank(left) - nativeIssueRank(right));
    const issues = allIssues.slice(0, maxIssuesPerShot);
    if (!issues.length) continue;
    const codes = issues.map((issue) => String(issue.code ?? "inspect_failed"));
    findings.push({
      id: `native-${shot.id}`,
      severity: "major",
      category: nativeCategory(codes),
      shot_ids: [shot.id],
      start_seconds: Number.isFinite(Number(shot.start_seconds)) ? Number(shot.start_seconds) : null,
      end_seconds: Number.isFinite(Number(shot.end_seconds)) ? Number(shot.end_seconds) : null,
      evidence: `Shot-local HyperFrames inspection repair batch contains ${issues.length} of ${allIssues.length} unique blocking issue${allIssues.length === 1 ? "" : "s"}: ${issues.map(describeNativeIssue).join("; ")}`,
      repair_scope: "frame",
      instruction: `Make native shot-local inspection pass by correcting these issues: ${issues.map(describeNativeIssue).join("; ")}. Do not hide a real defect with a layout-allow annotation; use one only when the overlap or off-canvas state is visibly intentional and remains legible. Motion assertions must describe motion on the asserted element itself.`,
      preserve: ["Factual copy and evidence grounding", "The established art direction", "Unrelated composition and motion"]
    });
  }
  return findings;
}

function nativeIssueRank(issue) {
  const severity = String(issue?.severity ?? "").toLowerCase() === "error" ? 0 : 10;
  const code = String(issue?.code ?? "");
  if (code === "console_error") return severity;
  if (code.startsWith("motion_")) return severity + 1;
  if (code.includes("text") || code.includes("overlap") || code.includes("overflow") || code.includes("occluded")) return severity + 2;
  if (code.includes("contrast")) return severity + 3;
  return severity + 4;
}

function currentHyperFramesIssues(stdout) {
  const sections = [stdout?.lint, stdout?.runtime, stdout?.layout, stdout?.motion, stdout?.contrast];
  const issues = [
    ...(Array.isArray(stdout?.issues) ? stdout.issues : []),
    ...(Array.isArray(stdout?.findings) ? stdout.findings : []),
    ...sections.flatMap((section) => Array.isArray(section?.findings) ? section.findings : [])
  ];
  return issues.filter((issue) => ["error", "warning"].includes(String(issue?.severity ?? "").toLowerCase()));
}

function infrastructureRepairError(failures) {
  const error = new Error(`Production repair is blocked because verification failed in the toolchain: ${failures.join(", ")}. Fix the verifier environment and rerun verification.`);
  error.code = "LAUNCHCLIP_PRODUCTION_INFRASTRUCTURE_FAILED";
  error.infrastructure_failed = failures;
  return error;
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
