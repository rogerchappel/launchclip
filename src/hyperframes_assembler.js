import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeShotFile, validateHyperFramesRoot } from "./frame_director.js";
import { describeJobOutput, ProductionJobStore, semanticHash } from "./job_store.js";
import { PRODUCTION_PATHS, validateFrameBundle } from "./production_contracts.js";

export async function assembleHyperFrames(workspacePath, options = {}) {
  const workspace = path.resolve(workspacePath);
  const [intake, evidence, plan] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(workspace, PRODUCTION_PATHS.plan))
  ]);
  const framesDir = path.join(workspace, PRODUCTION_PATHS.frames);
  const bundles = await Promise.all(plan.shots.map((shot) => readJson(safeShotFile(framesDir, shot.id, ".json"))));
  for (const [index, bundle] of bundles.entries()) {
    const validation = validateFrameBundle(bundle, {
      shotId: plan.shots[index].id,
      shot: plan.shots[index],
      format: plan.format,
      evidenceIds: evidence.items.map((entry) => entry.id),
      resourceIds: intake.resources.map((entry) => entry.id),
      resourceRoles: Object.fromEntries(intake.resources.map((entry) => [entry.id, entry.role])),
      allowedAssetPaths: intake.resources.filter((entry) => !entry.is_remote && entry.type !== "directory").map((entry) => entry.location)
    });
    const rootErrors = validateHyperFramesRoot(bundle.html, plan.shots[index], plan.format);
    if (!validation.ok || rootErrors.length) throw new Error(`Cannot assemble invalid frame ${bundle.shot_id}: ${[...validation.errors, ...rootErrors].join("; ")}`);
  }

  const store = await ProductionJobStore.open(workspace, { create: false });
  const dependencies = plan.shots.map((shot) => `frame:${shot.id}`);
  for (const dependency of dependencies) if (store.get(dependency)?.status !== "succeeded") throw new Error(`Frame job must succeed before assembly: ${dependency}`);
  const extraAudio = await describeExtraAudio(options);
  const inputHash = semanticHash({ intake, plan, bundles, extraAudio, assembler: "hyperframes-assembler.v5" });
  const jobId = "hyperframes-assembly";
  const existing = store.get(jobId);
  if (existing?.status === "succeeded" && existing.input_hash === inputHash) {
    const verification = await store.verifyOutputs(jobId);
    if (verification.ok) return { stage: "hyperframes-assembly", status: "ready", workspace, project: path.join(workspace, PRODUCTION_PATHS.hyperframes), index: path.join(workspace, PRODUCTION_PATHS.hyperframes, "index.html"), cached: true, outputs: verification.outputs };
    await store.markStaleFrom([jobId]);
  } else if (existing && existing.input_hash !== inputHash) {
    await store.markStaleFrom([jobId]);
  }
  const current = store.get(jobId);
  if (!current) await store.add({ id: jobId, kind: "hyperframes-assembly", depends_on: dependencies, input_hash: inputHash });
  else if (current.status === "failed" || current.status === "stale") await store.retry(jobId);
  else if (current.status === "running" || current.status === "submitted") {
    await store.markStaleFrom([jobId]);
    await store.retry(jobId);
  }
  else if (current.status !== "pending") throw new Error(`Assembly job is already ${current.status}`);
  await store.markRunning(jobId);

  try {
    const projectDir = path.join(workspace, PRODUCTION_PATHS.hyperframes);
    const compositionsDir = path.join(projectDir, "compositions");
    const assetsDir = path.join(projectDir, "assets");
    await Promise.all([mkdir(compositionsDir, { recursive: true }), mkdir(assetsDir, { recursive: true })]);
    const assetMap = await freezeResources(intake.resources, assetsDir);
    for (const audio of extraAudio) assetMap.set(audio.id, await freezeFile(audio.id, audio.path, assetsDir));

    for (const bundle of bundles) {
      let html = applyFrameCsp(ensureTimelineRegistration(bundle.html, bundle.shot_id));
      for (const resource of intake.resources) {
        const frozen = assetMap.get(resource.id);
        if (frozen && resource.location) html = html.split(resource.location).join(`assets/${frozen.file}`);
      }
      await writeAtomic(safeShotFile(compositionsDir, bundle.shot_id, ".html"), `${html.trim()}\n`);
      const shot = plan.shots.find((entry) => entry.id === bundle.shot_id);
      await writeAtomic(safeShotFile(compositionsDir, bundle.shot_id, ".motion.json"), `${JSON.stringify(toHyperFramesMotionSpec(bundle, shot.end_seconds - shot.start_seconds), null, 2)}\n`);
    }

    const html = renderRoot({ intake, plan, bundles, assetMap, extraAudio });
    const indexPath = path.join(projectDir, "index.html");
    const motionPath = path.join(projectDir, "index.motion.json");
    const manifestPath = path.join(projectDir, "assembly.json");
    await writeAtomic(indexPath, html);
    await writeAtomic(motionPath, `${JSON.stringify(rootMotionSpec(plan, bundles), null, 2)}\n`);
    await writeAtomic(manifestPath, `${JSON.stringify({
      schema_version: "launchclip.hyperframes-assembly.v1",
      duration_seconds: plan.format.duration_seconds,
      width: plan.format.width,
      height: plan.format.height,
      shots: plan.shots.map((shot) => ({ id: shot.id, start_seconds: shot.start_seconds, end_seconds: shot.end_seconds, composition: `compositions/${shot.id}.html` })),
      assets: [...assetMap.entries()].map(([id, entry]) => ({ id, file: `assets/${entry.file}`, sha256: entry.sha256 }))
    }, null, 2)}\n`);
    const outputs = await Promise.all([indexPath, motionPath, manifestPath, ...bundles.map((bundle) => safeShotFile(compositionsDir, bundle.shot_id, ".html"))].map((filePath) => describeJobOutput(workspace, filePath)));
    await store.markSucceeded(jobId, outputs);
    return { stage: "hyperframes-assembly", status: "ready", workspace, project: projectDir, index: indexPath, manifest: manifestPath, compositions: bundles.length, assets: assetMap.size, cached: false };
  } catch (error) {
    await store.markFailed(jobId, error);
    throw error;
  }
}

export function toHyperFramesMotionSpec(bundle, duration) {
  const assertions = [];
  const ordered = [];
  for (const assertion of bundle.motion?.assertions ?? []) {
    if (assertion.appears_by_seconds != null) assertions.push({ kind: "appearsBy", selector: assertion.selector, bySec: assertion.appears_by_seconds });
    if (assertion.must_stay_in_frame) assertions.push({ kind: "staysInFrame", selector: assertion.selector });
    if (assertion.must_remain_live) assertions.push({ kind: "keepsMoving", withinSelector: assertion.selector, maxStaticSec: Math.min(2, Math.max(.25, Number(duration) / 3)) });
    if (assertion.order != null) ordered.push(assertion);
  }
  ordered.sort((a, b) => a.order - b.order);
  for (let index = 1; index < ordered.length; index += 1) assertions.push({ kind: "before", a: ordered[index - 1].selector, b: ordered[index].selector });
  return { version: 1, duration: Number(duration), assertions };
}

export function rootMotionSpec(plan, bundles) {
  const assertions = [];
  for (const [index, shot] of plan.shots.entries()) {
    const selector = `#mount-${shot.id}`;
    assertions.push({ kind: "appearsBy", selector, bySec: shot.start_seconds + .05 });
    assertions.push({ kind: "staysInFrame", selector });
    if (index > 0) assertions.push({ kind: "before", a: `#mount-${plan.shots[index - 1].id}`, b: selector });
  }
  return { version: 1, duration: plan.format.duration_seconds, assertions };
}

export function renderRoot({ plan, bundles, assetMap, extraAudio = [] }) {
  const shotById = new Map(plan.shots.map((shot) => [shot.id, shot]));
  const media = [];
  for (const bundle of bundles) {
    const shot = shotById.get(bundle.shot_id);
    for (const [index, request] of bundle.root_media_requests.entries()) {
      const asset = assetMap.get(request.resource_id);
      if (!asset) throw new Error(`Frame ${bundle.shot_id} requested unavailable local media: ${request.resource_id}`);
      media.push(renderMedia({ id: `${bundle.shot_id}-media-${index + 1}`, request, asset, globalStart: shot.start_seconds + request.start_seconds }));
    }
  }
  for (const audio of extraAudio) {
    const asset = assetMap.get(audio.id);
    const duration = audio.duration_seconds == null ? "" : ` data-duration="${number(audio.duration_seconds)}"`;
    media.push(`<audio id="${escapeAttr(audio.id)}" class="clip" src="assets/${escapeAttr(asset.file)}" data-start="${number(audio.at_seconds ?? 0)}"${duration} data-media-start="${number(audio.source_start_seconds ?? 0)}" data-volume="${number(audio.volume)}" data-track-index="${audio.track}"></audio>`);
  }
  const compositions = plan.shots.map((shot, index) => `<div id="mount-${escapeAttr(shot.id)}" class="clip shot-mount" data-composition-id="${escapeAttr(shot.id)}" data-composition-src="compositions/${escapeAttr(shot.id)}.html" data-start="${number(shot.start_seconds)}" data-duration="${number(Math.max(.001, shot.end_seconds - shot.start_seconds - .001))}" data-track-index="${100 + index}" data-width="${plan.format.width}" data-height="${plan.format.height}"></div>`);
  return `<!doctype html>
<html lang="${escapeAttr(plan.format.language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${plan.format.width}, height=${plan.format.height}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${plan.format.width}px; height: ${plan.format.height}px; overflow: hidden; background: #000; }
    #launchclip-root { position: relative; width: 100%; height: 100%; overflow: hidden; }
    .shot-mount { position: absolute; inset: 0; width: 100%; height: 100%; }
    .root-media { position: absolute; display: block; overflow: hidden; }
  </style>
</head>
<body>
  <div id="launchclip-root" data-composition-id="main" data-start="0" data-duration="${number(plan.format.duration_seconds)}" data-width="${plan.format.width}" data-height="${plan.format.height}">
    ${media.join("\n    ")}
    ${compositions.join("\n    ")}
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </div>
</body>
</html>
`;
}

export function applyFrameCsp(html) {
  if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) return html;
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n  ${policy}`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (root) => `${root}\n<head>${policy}</head>`);
  return `${policy}\n${html}`;
}

export function ensureTimelineRegistration(html, compositionId) {
  if (new RegExp(`window\\.__timelines\\s*\\[\\s*["']${escapeRegExp(compositionId)}["']\\s*\\]`).test(html)) return html;
  const variables = [...String(html).matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/g)].map((match) => match[1]);
  const timeline = variables.at(-1);
  if (!timeline) return html;
  const statements = `window.__timelines = window.__timelines || {};\n${timeline}.pause(0);\nwindow.__timelines[${JSON.stringify(compositionId)}] = ${timeline};`;
  const closures = [...String(html).matchAll(/\}\s*\(\s*\)\s*\)\s*;|\}\s*\)\s*\(\s*\)\s*;/g)];
  if (closures.length) {
    const closure = closures.at(-1);
    return `${html.slice(0, closure.index)}${statements}\n${html.slice(closure.index)}`;
  }
  const registration = `<script>\n${statements}\n</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${registration}\n</body>`) : `${html}\n${registration}`;
}

function renderMedia({ id, request, asset, globalStart }) {
  const placement = request.placement;
  const style = [
    `left:${number(placement.x)}px`, `top:${number(placement.y)}px`,
    `width:${number(placement.width)}px`, `height:${number(placement.height)}px`,
    `object-fit:${placement.object_fit}`, `border-radius:${number(placement.border_radius)}px`,
    `z-index:${placement.z_index}`
  ].join(";");
  const duration = request.end_seconds - request.start_seconds;
  const mediaStart = request.source_start_seconds ?? 0;
  const common = `id="${escapeAttr(id)}" class="clip root-media" src="assets/${escapeAttr(asset.file)}" data-start="${number(globalStart)}" data-duration="${number(duration)}" data-media-start="${number(mediaStart)}" data-volume="${number(request.volume)}" data-track-index="${placement.z_index}" style="${style}" data-treatment="${escapeAttr(placement.treatment)}"`;
  return request.kind === "video" ? `<video ${common} muted playsinline></video>` : `<audio ${common}></audio>`;
}

async function freezeResources(resources, assetsDir) {
  const map = new Map();
  for (const resource of resources) {
    if (resource.is_remote || resource.type === "directory") continue;
    try {
      if (!(await stat(resource.location)).isFile()) continue;
      map.set(resource.id, await freezeFile(resource.id, resource.location, assetsDir));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return map;
}

async function freezeFile(id, source, assetsDir) {
  const extension = path.extname(source).toLowerCase();
  const file = `${slug(id)}${extension}`;
  const destination = path.join(assetsDir, file);
  await copyFile(source, destination);
  const output = await describeJobOutput(path.dirname(assetsDir), destination);
  return { file, sha256: output.sha256, source };
}

async function describeExtraAudio(options) {
  const output = [];
  for (const [id, value, volume, track] of [
    ["voiceover", options.voiceover, 1, 80],
    ["music", options.music, Number(options.musicVolume ?? 0.16), 70]
  ]) {
    if (!value) continue;
    const filePath = path.resolve(value);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error(`${id} must be a file: ${filePath}`);
    output.push({ id, path: filePath, volume, track, at_seconds: 0, duration_seconds: null, source_start_seconds: 0, sha256: await sha256File(filePath) });
  }
  if (options.sfxManifest) {
    const manifest = JSON.parse(await readFile(path.resolve(options.sfxManifest), "utf8"));
    for (const [index, cue] of (manifest.cues ?? []).entries()) {
      const filePath = path.resolve(cue.path);
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error(`SFX must be a file: ${filePath}`);
      output.push({
        id: `sfx-${String(index + 1).padStart(3, "0")}`,
        path: filePath,
        volume: Number(cue.volume),
        track: 60 + index,
        at_seconds: Number(cue.at_seconds),
        duration_seconds: cue.duration_seconds == null ? null : Number(cue.duration_seconds),
        source_start_seconds: Number(cue.source_start_seconds ?? 0),
        sha256: await sha256File(filePath)
      });
    }
  }
  return output;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function number(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected finite number, received ${value}`);
  return String(Math.round(parsed * 1000) / 1000);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
