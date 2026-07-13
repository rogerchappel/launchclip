import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFrameSelection, safeShotFile, validateHyperFramesRoot } from "./frame_director.js";
import { ensureTimelineRegistration } from "./hyperframes_timeline.js";
import { describeJobOutput, ProductionJobStore, semanticHash } from "./job_store.js";
import { PRODUCTION_PATHS, validateFrameBundle } from "./production_contracts.js";

export { ensureTimelineRegistration } from "./hyperframes_timeline.js";

export async function assembleHyperFrames(workspacePath, options = {}) {
  const workspace = path.resolve(workspacePath);
  const [intake, evidence, plan] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(workspace, PRODUCTION_PATHS.plan))
  ]);
  const selections = await Promise.all(plan.shots.map((shot) => readFrameSelection(workspace, shot.id)));
  const bundles = selections.map((selection) => selection.bundle);
  const fallbacks = selections.filter((selection) => selection.fallback).map((selection) => selection.fallback);
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
  const inputHash = semanticHash({ intake, plan, bundles, fallbacks, extraAudio, assembler: "hyperframes-assembler.v11" });
  const jobId = "hyperframes-assembly";
  const existing = store.get(jobId);
  if (existing?.status === "succeeded" && existing.input_hash === inputHash) {
    const verification = await store.verifyOutputs(jobId);
    if (verification.ok) return { stage: "hyperframes-assembly", status: "ready", workspace, project: path.join(workspace, PRODUCTION_PATHS.hyperframes), index: path.join(workspace, PRODUCTION_PATHS.hyperframes, "index.html"), cached: true, outputs: verification.outputs, fallback_count: fallbacks.length, full_fallback: fallbacks.length === bundles.length && bundles.length > 0 };
    await store.markStaleFrom([jobId]);
  } else if (existing && existing.input_hash !== inputHash) {
    await store.markStaleFrom([jobId]);
  }
  let current = store.get(jobId);
  if (!current) {
    await store.add({ id: jobId, kind: "hyperframes-assembly", depends_on: dependencies, input_hash: inputHash });
  } else {
    if (current.status === "running" || current.status === "submitted") {
      await store.markStaleFrom([jobId]);
      current = store.get(jobId);
    }
    const dependenciesChanged = current.depends_on.length !== dependencies.length || current.depends_on.some((dependency, index) => dependency !== dependencies[index]);
    if (dependenciesChanged) await store.reconfigure(jobId, { depends_on: dependencies, input_hash: inputHash });
    else if (current.status === "failed" || current.status === "stale") await store.retry(jobId, { inputHash });
    else if (current.status === "pending" && current.input_hash !== inputHash) await store.reconfigure(jobId, { depends_on: dependencies, input_hash: inputHash });
    else if (current.status !== "pending") throw new Error(`Assembly job is already ${current.status}`);
  }
  await store.markRunning(jobId);

  try {
    const projectDir = path.join(workspace, PRODUCTION_PATHS.hyperframes);
    const compositionsDir = path.join(projectDir, "compositions");
    const assetsDir = path.join(projectDir, "assets");
    await Promise.all([
      rm(compositionsDir, { recursive: true, force: true }),
      rm(assetsDir, { recursive: true, force: true })
    ]);
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

    const transitions = buildShotTransitions(plan);
    const html = renderRoot({ intake, plan, bundles, assetMap, extraAudio, fallbacks, transitions });
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
      fallbacks,
      fallback_count: fallbacks.length,
      full_fallback: fallbacks.length === bundles.length && bundles.length > 0,
      transitions,
      shots: plan.shots.map((shot) => ({ id: shot.id, start_seconds: shot.start_seconds, end_seconds: shot.end_seconds, composition: `compositions/${shot.id}.html` })),
      assets: [...assetMap.entries()].map(([id, entry]) => ({ id, file: `assets/${entry.file}`, sha256: entry.sha256 }))
    }, null, 2)}\n`);
    const outputs = await Promise.all([
      indexPath, motionPath, manifestPath,
      ...bundles.flatMap((bundle) => [safeShotFile(compositionsDir, bundle.shot_id, ".html"), safeShotFile(compositionsDir, bundle.shot_id, ".motion.json")]),
      ...[...assetMap.values()].map((entry) => path.join(assetsDir, entry.file))
    ].map((filePath) => describeJobOutput(workspace, filePath)));
    await store.markSucceeded(jobId, outputs);
    return { stage: "hyperframes-assembly", status: "ready", workspace, project: projectDir, index: indexPath, manifest: manifestPath, compositions: bundles.length, assets: assetMap.size, fallback_count: fallbacks.length, full_fallback: fallbacks.length === bundles.length && bundles.length > 0, cached: false };
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
  return { version: 1, duration: Number(duration), assertions, events: structuredClone(bundle.motion?.events ?? []) };
}

export function rootMotionSpec(plan, bundles) {
  const assertions = [];
  for (const [index, shot] of plan.shots.entries()) {
    const selector = `#mount-${shot.id}`;
    const shotDuration = shot.end_seconds - shot.start_seconds;
    const mountGrace = Math.min(.5, Math.max(.3, shotDuration * .02), shotDuration * .5);
    assertions.push({ kind: "appearsBy", selector, bySec: Number((shot.start_seconds + mountGrace).toFixed(3)) });
    assertions.push({ kind: "staysInFrame", selector });
    if (index > 0) assertions.push({ kind: "before", a: `#mount-${plan.shots[index - 1].id}`, b: selector });
  }
  return { version: 1, duration: plan.format.duration_seconds, assertions };
}

export function renderRoot({ plan, bundles, assetMap, extraAudio = [], fallbacks = [], transitions = buildShotTransitions(plan) }) {
  const chrome = presenterChromeStyle(plan.design?.style_dna);
  const shotById = new Map(plan.shots.map((shot) => [shot.id, shot]));
  const media = [];
  const mediaMotion = [];
  let mediaIndex = 0;
  for (const bundle of bundles) {
    const shot = shotById.get(bundle.shot_id);
    for (const [index, request] of bundle.root_media_requests.entries()) {
      const asset = assetMap.get(request.resource_id);
      if (!asset) throw new Error(`Frame ${bundle.shot_id} requested unavailable local media: ${request.resource_id}`);
      const rendered = renderMedia({ id: `${bundle.shot_id}-media-${index + 1}`, request, asset, globalStart: shot.start_seconds + request.start_seconds, track: 10 + mediaIndex });
      media.push(...rendered.elements);
      mediaMotion.push(rendered.motion);
      mediaIndex += 1;
    }
  }
  for (const audio of extraAudio) {
    const asset = assetMap.get(audio.id);
    const duration = audio.duration_seconds == null ? "" : ` data-duration="${number(audio.duration_seconds)}"`;
    media.push(`<audio id="${escapeAttr(audio.id)}" class="clip" src="assets/${escapeAttr(asset.file)}" data-start="${number(audio.at_seconds ?? 0)}"${duration} data-media-start="${number(audio.source_start_seconds ?? 0)}" data-volume="${number(audio.volume)}" data-track-index="${audio.track}"></audio>`);
  }
  const transitionByOutgoing = new Map(transitions.map((entry) => [entry.from_shot_id, entry]));
  const compositions = plan.shots.map((shot, index) => {
    const transition = transitionByOutgoing.get(shot.id);
    const extension = transition?.kind === "flow" ? transition.duration_seconds : -.001;
    const duration = Math.min(plan.format.duration_seconds - shot.start_seconds, shot.end_seconds - shot.start_seconds + extension);
    return `<div id="mount-${escapeAttr(shot.id)}" class="clip shot-mount" data-composition-id="${escapeAttr(shot.id)}" data-composition-src="compositions/${escapeAttr(shot.id)}.html" data-start="${number(shot.start_seconds)}" data-duration="${number(Math.max(.001, duration))}" data-track-index="${100 + index}" data-width="${plan.format.width}" data-height="${plan.format.height}" style="z-index:${100 + index}"></div>`;
  });
  const transitionMotion = renderShotTransitionMotion(plan, transitions);
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
    .shot-mount { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; transform-origin: center center; will-change: transform, opacity, filter; }
    .root-media { position: absolute; display: block; overflow: hidden; transform-origin: center center; will-change: transform, opacity, filter; }
    .root-media-frame { position: absolute; pointer-events: none; overflow: hidden; border: ${chrome.borderWidth}px solid ${chrome.foreground}; background: transparent; box-shadow: ${chrome.shadow}; transform-origin: center center; will-change: transform, opacity, filter; }
    .root-media-window-bar { position: absolute; top: 0; left: 0; right: 0; height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: ${chrome.borderWidth}px solid ${chrome.foreground}; background: ${chrome.surface}; }
    .root-media-window-dot { width: 12px; height: 12px; border-radius: ${chrome.dotRadius}; box-shadow: inset 0 0 0 1px ${chrome.foreground}; }
    .root-media-window-dot--close { background: #ff6258; }
    .root-media-window-dot--minimize { background: #ffc04a; }
    .root-media-window-dot--maximize { background: #40c957; }
    .fallback-draft-label { position: absolute; top: 24px; right: 24px; z-index: 10000; padding: 10px 14px; border: 2px solid #111; border-radius: 999px; background: #ffdf57; color: #111; font: 800 18px/1 Arial,sans-serif; letter-spacing: .06em; box-shadow: 4px 4px 0 #111; }
  </style>
</head>
<body>
  <div id="launchclip-root" data-composition-id="main" data-start="0" data-duration="${number(plan.format.duration_seconds)}" data-width="${plan.format.width}" data-height="${plan.format.height}">
    ${media.join("\n    ")}
    ${compositions.join("\n    ")}
    ${fallbacks.length ? `<div id="fallback-draft-label" class="clip fallback-draft-label" data-start="0" data-duration="${number(plan.format.duration_seconds)}" data-track-index="9999" data-layout-ignore="true">FALLBACK DRAFT • ${fallbacks.length}/${bundles.length} SHOTS</div>` : ""}
    <script>
      window.__timelines = window.__timelines || {};
      const timeline = gsap.timeline({ paused: true });
      ${transitionMotion}
      ${mediaMotion.join("\n      ")}
      window.__timelines["main"] = timeline;
    </script>
  </div>
</body>
</html>
`;
}

export function buildShotTransitions(plan) {
  const shots = plan?.shots ?? [];
  const transitions = [];
  for (let index = 0; index < shots.length - 1; index += 1) {
    const outgoing = shots[index];
    const incoming = shots[index + 1];
    const explicit = String(outgoing.transition_out ?? "");
    const kind = /\b(?:hard\s+)?cut\b/i.test(explicit) ? "cut" : "flow";
    const outgoingDuration = Number(outgoing.end_seconds) - Number(outgoing.start_seconds);
    const incomingDuration = Number(incoming.end_seconds) - Number(incoming.start_seconds);
    const duration = kind === "cut" ? 0 : Math.min(.45, Math.max(.26, Math.min(outgoingDuration, incomingDuration) * .07));
    const cameraDirection = String(incoming.visual?.continuity?.camera_direction ?? outgoing.visual?.continuity?.camera_direction ?? "right");
    transitions.push({
      from_shot_id: outgoing.id,
      to_shot_id: incoming.id,
      at_seconds: Number(incoming.start_seconds),
      duration_seconds: Number(duration.toFixed(3)),
      kind,
      axis: /\b(?:up|down|vertical|descend|ascend)\b/i.test(cameraDirection) ? "y" : "x",
      direction: /\b(?:left|up|reverse|back)\b/i.test(cameraDirection) ? -1 : 1,
      motion_blur_px: Math.min(24, Math.max(8, Number(incoming.visual?.continuity?.motion_blur_px ?? outgoing.visual?.continuity?.motion_blur_px ?? 12))),
      intent: explicit || "continuous canvas handoff"
    });
  }
  return transitions;
}

function renderShotTransitionMotion(plan, transitions) {
  if (!plan.shots?.length) return "";
  const statements = [`timeline.set("#mount-${escapeJs(plan.shots[0].id)}",{opacity:1,x:0,y:0,scale:1,filter:"blur(0px)"},0);`];
  for (const transition of transitions) {
    const incoming = `#mount-${escapeJs(transition.to_shot_id)}`;
    if (transition.kind === "cut") {
      statements.push(`timeline.set("${incoming}",{opacity:1,x:0,y:0,scale:1,filter:"blur(0px)"},${number(transition.at_seconds)});`);
      continue;
    }
    const outgoing = `#mount-${escapeJs(transition.from_shot_id)}`;
    const distance = 86 * transition.direction;
    const outgoingState = { opacity: 0, x: transition.axis === "x" ? -distance : 0, y: transition.axis === "y" ? -distance : 0, scale: 1.018, filter: `blur(${number(transition.motion_blur_px)}px)` };
    const incomingState = { opacity: 0, x: transition.axis === "x" ? distance : 0, y: transition.axis === "y" ? distance : 0, scale: .982, filter: `blur(${number(transition.motion_blur_px)}px)` };
    const settled = { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)", duration: transition.duration_seconds, ease: "power3.inOut" };
    statements.push(`timeline.to("${outgoing}",{...${JSON.stringify(outgoingState)},duration:${number(transition.duration_seconds)},ease:"power3.inOut"},${number(transition.at_seconds)});`);
    statements.push(`timeline.fromTo("${incoming}",${JSON.stringify(incomingState)},${JSON.stringify(settled)},${number(transition.at_seconds)});`);
  }
  return statements.join("\n      ");
}

export function applyFrameCsp(html) {
  const source = String(html).replace(/<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:["']content-security-policy["']|content-security-policy\b))[^>]*>/gi, "");
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  if (/<head\b[^>]*>/i.test(source)) return source.replace(/<head\b[^>]*>/i, (head) => `${head}\n  ${policy}`);
  if (/<html\b[^>]*>/i.test(source)) return source.replace(/<html\b[^>]*>/i, (root) => `${root}\n<head>${policy}</head>`);
  return `${policy}\n${source}`;
}

function renderMedia({ id, request, asset, globalStart, track }) {
  const placement = request.placement;
  const style = [
    `left:${number(placement.x)}px`, `top:${number(placement.y)}px`,
    `width:${number(placement.width)}px`, `height:${number(placement.height)}px`,
    `object-fit:${placement.object_fit}`, `border-radius:${number(placement.border_radius)}px`,
    `z-index:${placement.z_index}`
  ].join(";");
  const duration = request.end_seconds - request.start_seconds;
  const mediaStart = request.source_start_seconds ?? 0;
  const presentation = request.presentation ?? { mode: "companion", frame: "none", enter: "cut", exit: "cut", motion_blur_px: 0 };
  const common = `id="${escapeAttr(id)}" class="clip root-media root-media--${escapeAttr(presentation.mode)}" src="assets/${escapeAttr(asset.file)}" data-start="${number(globalStart)}" data-duration="${number(duration)}" data-media-start="${number(mediaStart)}" data-volume="${number(request.volume)}" data-track-index="${Number(track)}" style="${style}" data-treatment="${escapeAttr(placement.treatment)}" data-presentation-mode="${escapeAttr(presentation.mode)}"`;
  const videoAudio = request.volume > 0 ? `data-has-audio="true"` : "muted";
  const mediaElement = request.kind === "video" ? `<video ${common} ${videoAudio} playsinline></video>` : `<audio ${common}></audio>`;
  const frameId = `${id}-frame`;
  const frameElement = request.kind === "video" && presentation.frame === "desktop-window"
    ? `<div id="${escapeAttr(frameId)}" class="clip root-media-frame" data-start="${number(globalStart)}" data-duration="${number(duration)}" data-track-index="${Number(500 + track)}" data-layout-allow-occlusion="true" style="left:${number(placement.x)}px;top:${number(placement.y)}px;width:${number(placement.width)}px;height:${number(placement.height)}px;border-radius:${number(placement.border_radius)}px;z-index:${number(placement.z_index + 1)}"><div class="root-media-window-bar" aria-hidden="true"><span class="root-media-window-dot root-media-window-dot--close"></span><span class="root-media-window-dot root-media-window-dot--minimize"></span><span class="root-media-window-dot root-media-window-dot--maximize"></span></div></div>`
    : null;
  return {
    elements: frameElement ? [mediaElement, frameElement] : [mediaElement],
    motion: renderMediaMotion({ id, frameId: frameElement ? frameId : null, presentation, globalStart, duration })
  };
}

function renderMediaMotion({ id, frameId, presentation, globalStart, duration }) {
  const selector = frameId ? `#${id},#${frameId}` : `#${id}`;
  const blur = Number(presentation.motion_blur_px ?? 0);
  const enterDuration = Math.min(.5, Math.max(.2, duration * .12));
  const exitDuration = Math.min(.45, Math.max(.18, duration * .1));
  const enterState = motionState(presentation.enter, blur, true);
  const exitState = motionState(presentation.exit, blur, false);
  const statements = [];
  if (presentation.enter === "cut") statements.push(`timeline.set("${selector}",{opacity:1,x:0,y:0,scale:1,filter:"blur(0px)"},${number(globalStart)});`);
  else statements.push(`timeline.fromTo("${selector}",${JSON.stringify(enterState)},{opacity:1,x:0,y:0,scale:1,filter:"blur(0px)",duration:${number(enterDuration)},ease:"power3.out"},${number(globalStart)});`);
  if (presentation.exit !== "cut" && duration > enterDuration + exitDuration + .1) {
    statements.push(`timeline.to("${selector}",{...${JSON.stringify(exitState)},duration:${number(exitDuration)},ease:"power3.in"},${number(globalStart + duration - exitDuration)});`);
  }
  return statements.join("\n      ");
}

function motionState(kind, blur, entering) {
  const state = { opacity: 0, x: 0, y: 0, scale: 1, filter: `blur(${number(blur)}px)` };
  if (kind === "slide-up") state.y = entering ? 140 : -140;
  if (kind === "slide-down") state.y = 140;
  if (kind === "slide-left") state.x = -160;
  if (kind === "slide-right") state.x = 160;
  if (kind === "scale-in") state.scale = .82;
  if (kind === "scale-out") state.scale = .84;
  return state;
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
        track: 1000 + index,
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

function presenterChromeStyle(styleDna = {}) {
  const colors = styleDna.colors ?? {};
  const background = safeStyleColor(colors.background, "#F4F0E8");
  const foreground = safeStyleColor(colors.foreground, "#20231F");
  const accent = safeStyleColor(colors.accent, "#E58B72");
  const sharp = /sharp|square|zero/i.test(String(styleDna.shape_language ?? ""));
  const flat = /no shadow|flat|paper/i.test(String(styleDna.presenter_frame ?? ""));
  return {
    foreground,
    surface: `${background}F2`,
    borderWidth: sharp ? 4 : 3,
    dotRadius: sharp ? "2px" : "999px",
    shadow: flat ? `8px 8px 0 ${accent}` : `0 24px 70px ${hexAlpha(foreground, "38")}, 0 0 0 1px ${hexAlpha(accent, "80")}`
  };
}

function safeStyleColor(value, fallback) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function hexAlpha(color, alpha) {
  return `${safeStyleColor(color, "#20231F")}${alpha}`;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeJs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
