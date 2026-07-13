import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { describeJobOutput, ProductionJobStore, semanticHash } from "./job_store.js";
import { ensureTimelineRegistration, hasTimelineRegistration } from "./hyperframes_timeline.js";
import { OpenAIResponsesClient } from "./openai_responses.js";
import { FRAME_BUNDLE_SCHEMA, FRAME_BUNDLE_VERSION, PRODUCTION_PATHS, isValidShotId, validateFrameBundle } from "./production_contracts.js";

const FRAME_INSTRUCTIONS = `You are a senior motion designer authoring one modular HyperFrames shot inside a larger film.

Translate the director's shot brief into an original, polished HTML composition. Honor the global design language while making this shot's composition and motion serve its specific idea. Return only the strict frame-bundle JSON.

HyperFrames contract:
- html is one complete SUB-COMPOSITION document. Body contains exactly one <template>; every live <style>, root element, and <script> is inside that template because the host clones only template contents.
- Inside the template, use one root with id="root" and data-composition-id equal to shot_id, data-start="0", the supplied data-duration, width, and height. Style that root with #root, never a root class selector.
- Prefix every non-root element id with "shot_id-" so mounted scenes cannot collide. Motion assertion selectors use those prefixed ids.
- Visual timeline elements use class="clip" with local data-start and data-duration values.
- GSAP is already available as a global. Do not import libraries, fonts, or remote assets. Keep animation seek-safe and deterministic.
- Create the GSAP timeline paused and register it exactly with: window.__timelines = window.__timelines || {}; window.__timelines[shot_id] = timeline. Do not use alternate registry names.
- Do not declare an initial CSS transform on any selector that GSAP animates. Set initial transform state with gsap.set so one system owns the full transform.
- Animate transforms and opacity for movement. Never tween font-size, width, height, top, left, padding, or other layout/reflow properties; author the final readable size in CSS and reveal it with transform/opacity.
- Give every timeline-visible class="clip" element a stable, descriptive, shot-prefixed id for Studio editing and motion inspection.
- Put a full-bleed background on a child layer rather than the composition root; root backgrounds can disappear during frame compositing. Use only declared @font-face families or renderer-safe generic families such as Arial, Georgia, or Courier New; do not name an unavailable platform font.
- Do not include audio or video elements. Request those through root_media_requests; the assembler owns media playback.
- Treat presenter media as a root visual object. For presenter.mode anchor or companion, request exactly one presenter video and include presentation.mode matching the shot, frame="desktop-window" unless the director explicitly requests no chrome, a seek-safe enter/exit preset, and motion_blur_px. For presenter.mode voiceover, request no presenter video; the authoritative audio continues independently.
- Anchor means the presenter is the primary framed visual. Companion means a smaller framed presenter window shares the canvas with proof or motion graphics. Presenter placement is allowed to change between top, middle, and bottom across shots.
- Presenter video follows one continuous production timeline even when its placement changes. Set presenter source_start_seconds to the shot's global start_seconds plus the request's shot-local start_seconds; never restart a presenter take at zero on a later shot.
- Do not fetch, use timers, Date.now, Math.random, requestAnimationFrame, or browser storage.
- Use only supplied local resource paths. If a requested visual asset is unavailable, design a native HTML/CSS/SVG treatment instead of inventing a path.
- Treat global_design.style_dna as binding brand truth and shot.visual as binding semantic truth. Apply the exact palette, typography roles, shape language, background system, diagram language, presenter frame, motion physics, transition vocabulary, and forbidden motifs. Do not substitute a generic dark-blue UI.
- Render the declared semantic representation. Diagrams need labeled nodes and connectors; comparisons need visibly opposed states; timelines need a spatial axis and progressing marks; processes need stages and direction; data needs a proportional visual form. A headline floating over decoration does not satisfy the visual concept.
- Materialize every shot.visual.objects entry as a visible object or an approved root-media request. Give authored DOM objects data-visual-object-id equal to the planned object id while keeping the actual DOM id shot-prefixed.
- Materialize every shot.visual.events entry in motion.events. Each event must point to the real selector that visibly changes at the planned time. SFX relies on this event contract, so do not report an event that has no perceptible animation.
- Honor shot.visual.continuity and the neighbor handoff. Persistent object IDs retain their visual identity, transform events visibly evolve them, and camera velocity/direction/blur must make related shots feel like one moving canvas rather than separate slides.
- When narration_timing is present, synchronize semantic reveals to its shot-local word timestamps instead of estimating speech timing.
- Use transform and opacity for primary motion. Name selectors in motion assertions so inspection can verify the intended reveals.
- Motion assertions are executable test contracts, not aspirational descriptions. Every selector must be exactly one existing shot-prefixed id, such as #shot-01-headline when shot_id is shot-01; never assert a selector that is absent from html.
- appears_by_seconds is shot-local and means the element is actually visible at opacity >= 0.5 by that time. Use 0 for elements intentionally visible on frame zero and leave a conservative buffer after entrance easing.
- Assign order only when two elements have strictly different first-visible times. Use null for frame-zero or simultaneous entrances, and never reuse an order number.
- must_remain_live means the selected element or its descendants keep moving with no static window longer than one third of the shot. Set it false for normal reveal-then-settle elements.
- Set must_stay_in_frame true only when the element's entire visible bounding box remains on canvas after it appears; intentional off-canvas or clipped entrance geometry must use false.
- Keep essential text and proof inside the frame at all times. Preserve exact visible copy and factual meaning.
- The first and last rendered frame must be intentional, including when mounted next to neighboring shots.`;

export async function directFrames(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const [intake, evidence, plan, narrationTiming] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(workspace, PRODUCTION_PATHS.plan)),
    readNarrationTiming(workspace)
  ]);
  const store = adapters.store ?? await ProductionJobStore.open(workspace, { create: false });
  if (store.get("creative-plan")?.status !== "succeeded") throw new Error("Creative plan job must succeed before frame delegation");
  const client = adapters.client ?? new OpenAIResponsesClient();
  const concurrency = positiveInteger(options.concurrency ?? 4, "concurrency");
  const tasks = plan.shots.map((shot, index) => () => directOneFrame({ workspace, intake, evidence, plan, shot, index, narrationTiming, store, client, options }));
  const frames = await runPool(tasks, concurrency);
  return {
    stage: "frame-direction",
    status: "ready",
    workspace,
    frames,
    generated: frames.filter((entry) => !entry.cached).length,
    cached: frames.filter((entry) => entry.cached).length,
    fallbacks: frames.filter((entry) => entry.fallback).length,
    sanitized: frames.filter((entry) => entry.sanitized).length
  };
}

export function buildFrameInput({ intake, evidence, plan, shot, index, narrationTiming = null, prior = null, errors = [] }) {
  const neighbors = [plan.shots[index - 1], plan.shots[index + 1]].filter(Boolean).map((entry) => ({
    id: entry.id,
    purpose: entry.purpose,
    transition_out: entry.transition_out,
    visual_description: entry.visual.description,
    representation: entry.visual.representation,
    continuity: entry.visual.continuity,
    objects: entry.visual.objects
  }));
  const evidenceById = new Map(evidence.items.map((entry) => [entry.id, entry]));
  const resourceById = new Map(intake.resources.map((entry) => [entry.id, entry]));
  const timedWords = (narrationTiming?.words ?? []).filter((word) => Number(word.end) > shot.start_seconds && Number(word.start) < shot.end_seconds).map((word) => ({
    word: word.word,
    global_start_seconds: Number(word.start),
    global_end_seconds: Number(word.end),
    shot_start_seconds: Math.max(0, Number(word.start) - shot.start_seconds),
    shot_end_seconds: Math.min(shot.end_seconds - shot.start_seconds, Number(word.end) - shot.start_seconds)
  }));
  return JSON.stringify({
    global_design: plan.design,
    format: plan.format,
    project: plan.project,
    shot: { ...shot, duration_seconds: shot.end_seconds - shot.start_seconds },
    neighbors,
    evidence: shot.evidence_ids.map((id) => evidenceById.get(id)).filter(Boolean).map((entry) => ({ id: entry.id, title: entry.title, content: entry.content, provenance: entry.provenance })),
    resources: shot.resource_ids.map((id) => resourceById.get(id)).filter(Boolean).map((entry) => ({ id: entry.id, role: entry.role, type: entry.type, local_path: entry.is_remote ? null : entry.location, remote: entry.is_remote, catalog: entry.catalog ?? null })),
    narration_timing: narrationTiming ? { duration_seconds: narrationTiming.duration_seconds, words: timedWords } : null,
    frame_responsibility: "Own visual HTML and motion for this shot only. Request media; do not mount it.",
    prior_attempt: prior,
    validation_errors_to_repair: errors
  });
}

async function directOneFrame({ workspace, intake, evidence, plan, shot, index, narrationTiming, store, client, options }) {
  const jobId = `frame:${shot.id}`;
  const baseInput = buildFrameInput({ intake, evidence, plan, shot, index, narrationTiming });
  const inputHash = semanticHash({ input: baseInput, model: intake.model, reasoning: options.reasoning ?? "high", schema: FRAME_BUNDLE_SCHEMA, worker: "frame-director.v2" });
  const existing = store.get(jobId);
  if (existing?.status === "succeeded" && existing.input_hash === inputHash) {
    const verification = await store.verifyOutputs(jobId);
    if (verification.ok) return { shot_id: shot.id, cached: true, outputs: verification.outputs, response_id: existing.remote?.response_id ?? null };
    await store.markStaleFrom([jobId]);
  } else if (existing && existing.input_hash !== inputHash) {
    await store.markStaleFrom([jobId]);
  }
  const current = store.get(jobId);
  let resumeResponseId = null;
  if (!current) await store.add({ id: jobId, kind: "frame", depends_on: ["creative-plan"], input_hash: inputHash, max_attempts: Number(options.maxAttempts ?? 3) });
  else if (current.status === "failed" && existing?.input_hash === inputHash && isSemanticValidationFailure(current.error)) {
    await store.reconfigure(jobId, { input_hash: inputHash });
    await store.markRunning(jobId, { provider: "local", response_id: existing.remote?.response_id ?? null, status: "fallback" });
    return persistFallbackFrame({ workspace, intake, evidence, plan, shot, store, jobId, reason: current.error, responseId: existing.remote?.response_id ?? null });
  }
  else if (current.status === "failed" || current.status === "stale") await store.retry(jobId, { inputHash });
  else if (current.status === "running" || current.status === "submitted") {
    if (!current.remote?.response_id) throw new Error(`Frame job is ${current.status} without a resumable response id: ${jobId}`);
    resumeResponseId = current.remote.response_id;
  } else if (current.status !== "pending") throw new Error(`Frame job is already ${current.status}: ${jobId}`);

  if (!resumeResponseId) await store.markRunning(jobId, { provider: "openai", response_id: null, status: "running" });
  let prior = null;
  let errors = [];
  try {
    for (let attempt = 1; attempt <= Number(options.semanticAttempts ?? 2); attempt += 1) {
      const request = {
        model: intake.model?.id ?? "gpt-5.6",
        reasoningEffort: options.reasoning ?? "high",
        reasoningContext: "current_turn",
        pro: false,
        instructions: FRAME_INSTRUCTIONS,
        input: buildFrameInput({ intake, evidence, plan, shot, index, narrationTiming, prior, errors }),
        schema: FRAME_BUNDLE_SCHEMA,
        schemaName: "launchclip_frame_bundle",
        background: options.background !== false,
        maxOutputTokens: Number(options.maxOutputTokens ?? 36_000),
        promptCacheKey: "launchclip:frame-director:v2",
        metadata: { job_id: jobId, shot_id: shot.id, attempt },
        onSubmitted: async (response) => store.markRunning(jobId, { provider: "openai", response_id: response.id, status: response.status })
      };
      const result = resumeResponseId ? await client.resumeStructured(resumeResponseId, request) : await client.runStructured(request);
      resumeResponseId = null;
      await store.markRunning(jobId, { provider: "openai", response_id: result.response_id, status: result.status });
      const normalized = { ...result.value, html: ensureTimelineRegistration(result.value.html, shot.id) };
      const sanitized = sanitizeFrameBundle(normalized);
      const candidate = sanitized.bundle;
      const validation = validateFrameBundle(candidate, {
        shotId: shot.id,
        shot,
        format: plan.format,
        evidenceIds: evidence.items.map((entry) => entry.id),
        resourceIds: intake.resources.map((entry) => entry.id),
        resourceRoles: Object.fromEntries(intake.resources.map((entry) => [entry.id, entry.role])),
        allowedAssetPaths: intake.resources.filter((entry) => !entry.is_remote && entry.type !== "directory").map((entry) => entry.location)
      });
      errors = [...validation.errors, ...validateHyperFramesRoot(candidate.html, shot, plan.format)];
      await writeFrameAttempt(workspace, shot.id, attempt, {
        response_id: result.response_id,
        model: result.model,
        usage: result.usage,
        repairs: sanitized.repairs,
        errors,
        candidate
      });
      if (errors.length) {
        prior = candidate;
        if (attempt < Number(options.semanticAttempts ?? 2)) continue;
        return persistFallbackFrame({
          workspace, intake, evidence, plan, shot, store, jobId,
          reason: `Frame ${shot.id} failed semantic validation: ${errors.join("; ")}`,
          responseId: result.response_id,
          usage: result.usage
        });
      }
      const paths = await writeFrameArtifacts(workspace, candidate);
      const outputs = await Promise.all(paths.map((filePath) => describeJobOutput(workspace, filePath)));
      await store.markSucceeded(jobId, outputs, result.usage);
      return { shot_id: shot.id, cached: false, sanitized: sanitized.repairs.length > 0, repairs: sanitized.repairs, bundle: paths[0], html: paths[1], motion: paths[2], response_id: result.response_id, model: result.model, usage: result.usage };
    }
    throw new Error(`Frame ${shot.id} exhausted semantic attempts`);
  } catch (error) {
    await store.markFailed(jobId, error);
    throw error;
  }
}

export function sanitizeFrameBundle(bundle) {
  const html = String(bundle?.html ?? "");
  let removed = 0;
  const sanitizedHtml = html.replace(/\son[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, () => {
    removed += 1;
    return "";
  });
  return {
    bundle: { ...bundle, html: sanitizedHtml },
    repairs: removed ? [{ kind: "remove-event-handler-attributes", count: removed }] : []
  };
}

export function buildFallbackFrame({ intake, plan, shot }) {
  const duration = Number(shot.end_seconds) - Number(shot.start_seconds);
  const presenterMode = ["anchor", "companion"].includes(shot.presenter?.mode) ? shot.presenter.mode : shot.presenter?.visible ? "companion" : "voiceover";
  const presenter = presenterMode === "voiceover" ? null : intake.resources.find((entry) => entry.role === "presenter" && entry.type === "video" && shot.resource_ids.includes(entry.id));
  const presenterLayout = presenter ? fallbackPresenterLayout(plan.format, shot, presenterMode) : null;
  const copy = (shot.on_screen_text ?? []).filter(Boolean).slice(0, 3);
  const visibleCopy = copy.length ? copy : [shot.purpose ?? "Continue"];
  const cardId = `${shot.id}-fallback-card`;
  const lineHtml = visibleCopy.map((line, index) => `<div id="${shot.id}-fallback-line-${index + 1}" class="fallback-line fallback-line-${index + 1}">${escapeHtml(line)}</div>`).join("\n        ");
  const style = fallbackStyle(plan.design?.style_dna);
  const semantic = fallbackSemanticObjects({ intake, shot });
  const eventTweens = fallbackEventTweens(shot, semantic.selectors);
  const backdrop = `radial-gradient(circle at 18% 12%, ${style.supporting} 0%, ${style.background} 46%, ${style.background} 100%)`;
  const html = `<!doctype html>
<html><head></head><body><template>
  <style>
    #root{position:relative;width:${Number(plan.format.width)}px;height:${Number(plan.format.height)}px;overflow:hidden;color:${style.foreground};font-family:Arial,sans-serif}
    #${shot.id}-fallback-backdrop{position:absolute;inset:0;background:${backdrop}}
    #${shot.id}-fallback-grid{position:absolute;inset:-10%;opacity:.34;background-image:linear-gradient(${style.grid} 2px,transparent 2px),linear-gradient(90deg,${style.grid} 2px,transparent 2px);background-size:82px 82px}
    #${shot.id}-fallback-rail{position:absolute;left:6%;top:7%;width:4px;height:86%;transform-origin:top;background:${style.accent}}
    #${shot.id}-fallback-index{position:absolute;right:7%;top:6%;font:700 20px/1 "Courier New",monospace;letter-spacing:.16em;color:${style.muted}}
    #${cardId}{position:absolute;left:9%;right:7%;top:7%;display:flex;gap:16px;align-items:flex-start;perspective:1200px}
    #${cardId} .fallback-line{padding:12px 18px;border:2px solid ${style.foreground};border-radius:999px;background:${style.background};box-shadow:5px 5px 0 ${style.accent};font-size:${plan.format.height > plan.format.width ? 34 : 28}px;font-weight:800;line-height:1;letter-spacing:-.02em;text-wrap:balance}
    #${cardId} .fallback-line-2,#${cardId} .fallback-line-3{color:${style.foreground};box-shadow:5px 5px 0 ${style.supporting}}
    #${shot.id}-semantic-stage{position:absolute;left:9%;right:7%;top:22%;bottom:10%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:center;gap:28px;perspective:1200px}
    #${shot.id}-semantic-stage .semantic-object{position:relative;min-height:170px;padding:28px;border:3px solid ${style.foreground};border-radius:${style.radius}px;background:${style.surface};box-shadow:10px 12px 0 ${style.shadow};display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
    #${shot.id}-semantic-stage .semantic-object::after{content:"";position:absolute;width:90px;height:90px;border-radius:50%;right:-28px;bottom:-32px;background:${style.accent};opacity:.72}
    #${shot.id}-semantic-stage .semantic-kind{font:700 17px/1 "Courier New",monospace;letter-spacing:.12em;text-transform:uppercase;color:${style.accent}}
    #${shot.id}-semantic-stage .semantic-meaning{max-width:86%;font-size:${plan.format.height > plan.format.width ? 44 : 36}px;font-weight:800;line-height:1.02;letter-spacing:-.03em}
    #${shot.id}-semantic-stage .semantic-object--connector{min-height:26px;grid-column:1/-1;padding:0;border:0;border-radius:0;background:${style.accent};box-shadow:none;transform-origin:left center}
    #${shot.id}-semantic-stage .semantic-object--connector::after{display:none}
    #${shot.id}-semantic-stage .semantic-asset{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:30px}
  </style>
  <div id="root" data-composition-id="${shot.id}" data-start="0" data-duration="${number(duration)}" data-width="${Number(plan.format.width)}" data-height="${Number(plan.format.height)}">
    <div id="${shot.id}-fallback-backdrop" class="clip" data-start="0" data-duration="${number(duration)}"></div>
    <div id="${shot.id}-fallback-grid" class="clip" data-start="0" data-duration="${number(duration)}" data-layout-allow-overflow="true"></div>
    <div id="${shot.id}-fallback-rail" class="clip" data-start="0" data-duration="${number(duration)}"></div>
    <div id="${shot.id}-fallback-index" class="clip" data-start="0" data-duration="${number(duration)}">${escapeHtml(shot.id.toUpperCase())}</div>
    <div id="${cardId}" class="clip" data-start="0" data-duration="${number(duration)}">
      ${lineHtml}
    </div>
    <div id="${shot.id}-semantic-stage" class="clip" data-start="0" data-duration="${number(duration)}" data-semantic-representation="${escapeHtml(shot.visual?.representation ?? "hybrid")}">
      ${semantic.html}
    </div>
  </div>
  <script>
    window.__timelines=window.__timelines||{};
    const timeline=gsap.timeline({paused:true});
    timeline.fromTo("#${shot.id}-fallback-grid",{opacity:0,x:-40,rotation:-4},{opacity:.22,x:0,rotation:-4,duration:.7,ease:"power2.out"},0);
    timeline.fromTo("#${shot.id}-fallback-rail",{opacity:0,scaleY:0},{opacity:1,scaleY:1,duration:.55,ease:"power3.out"},.05);
    timeline.fromTo("#${shot.id}-fallback-index",{opacity:0,x:24},{opacity:1,x:0,duration:.35,ease:"power2.out"},.12);
    timeline.fromTo("#${cardId} .fallback-line",{opacity:0,x:90,y:20,rotationY:-8},{opacity:1,x:0,y:0,rotationY:0,duration:.5,ease:"power3.out",stagger:.16},.16);
    ${eventTweens.script}
    timeline.to("#${shot.id}-fallback-grid",{x:36,y:-22,duration:${number(Math.max(.8, duration - .7))},ease:"none"},.7);
    window.__timelines["${shot.id}"]=timeline;
  </script>
</template></body></html>`;
  const rootMediaRequests = presenter ? [{
    resource_id: presenter.id,
    kind: "video",
    start_seconds: 0,
    end_seconds: duration,
    source_start_seconds: Number(shot.start_seconds),
    source_end_seconds: Number(shot.end_seconds),
    volume: 0,
    presentation: {
      mode: presenterMode,
      frame: "desktop-window",
      enter: presenterLayout.enter,
      exit: presenterLayout.exit,
      motion_blur_px: 16
    },
    placement: {
      x: presenterLayout.x, y: presenterLayout.y, width: presenterLayout.size, height: presenterLayout.size,
      object_fit: "cover", border_radius: 28, z_index: 20,
      treatment: `${presenterMode} desktop-window presenter object`
    }
  }] : [];
  return {
    schema_version: FRAME_BUNDLE_VERSION,
    shot_id: shot.id,
    html,
    motion: {
      assertions: [{ selector: `#${cardId}`, appears_by_seconds: .7, order: null, must_stay_in_frame: true, must_remain_live: false }, ...eventTweens.assertions],
      events: eventTweens.events
    },
    root_media_requests: rootMediaRequests,
    evidence_ids: [...(shot.evidence_ids ?? [])],
    visible_copy: visibleCopy,
    preserve: ["deterministic fallback", ...visibleCopy]
  };
}

function fallbackStyle(styleDna = {}) {
  const colors = styleDna.colors ?? {};
  const background = safeColor(colors.background, "#F4F0E8");
  const foreground = safeColor(colors.foreground, "#20231F");
  const accent = safeColor(colors.accent, "#E58B72");
  const supporting = safeColor(colors.supporting?.[0], "#A8D8C7");
  return { background, foreground, accent, supporting, surface: mixColor(background, "#FFFFFF"), grid: alphaColor(foreground, .14), muted: alphaColor(foreground, .58), shadow: alphaColor(foreground, .2), radius: /sharp|square|zero/i.test(styleDna.shape_language ?? "") ? 0 : 26 };
}

function fallbackSemanticObjects({ intake, shot }) {
  const resources = new Map(intake.resources.map((resource) => [resource.id, resource]));
  const objects = (shot.visual?.objects ?? []).filter((object) => object.kind !== "presenter").slice(0, 6);
  const selected = objects.length ? objects : [{ id: "concept", kind: "diagram-node", meaning: shot.visual?.concept ?? shot.purpose ?? "Concept", asset_resource_id: null }];
  const selectors = new Map();
  const html = selected.map((object) => {
    const id = `${shot.id}-object-${safeId(object.id)}`;
    selectors.set(object.id, `#${id}`);
    const resource = object.asset_resource_id ? resources.get(object.asset_resource_id) : null;
    const asset = resource && resource.type === "image" && !resource.is_remote ? `<img class="semantic-asset" src="${escapeHtml(resource.location)}" alt="">` : "";
    return `<div id="${id}" class="semantic-object semantic-object--${safeId(object.kind)}" data-visual-object-id="${escapeHtml(object.id)}">${asset}<span class="semantic-kind">${escapeHtml(object.kind)}</span><span class="semantic-meaning">${escapeHtml(object.meaning)}</span></div>`;
  }).join("\n      ");
  return { html, selectors };
}

function fallbackEventTweens(shot, selectors) {
  const events = [];
  const assertions = [];
  const script = [];
  const duration = Number(shot.end_seconds) - Number(shot.start_seconds);
  for (const event of shot.visual?.events ?? []) {
    const objectId = event.target_ids.find((candidate) => selectors.has(candidate));
    const selector = selectors.get(objectId) ?? `#${shot.id}-semantic-stage`;
    const at = Math.min(Math.max(0, Number(event.at_seconds)), Math.max(0, duration - .25));
    const isConnector = event.visible_change === "connect";
    const from = isConnector ? "{opacity:.15,scaleX:.08}" : event.visible_change === "move" ? "{opacity:1,x:-120,filter:\"blur(18px)\"}" : "{opacity:0,y:70,scale:.9,filter:\"blur(14px)\"}";
    const to = isConnector ? `{opacity:1,scaleX:1,duration:.45,ease:"power3.out"}` : `{opacity:1,x:0,y:0,scale:1,filter:"blur(0px)",duration:.55,ease:"power3.out"}`;
    script.push(`timeline.fromTo(${JSON.stringify(selector)},${from},${to},${number(at)});`);
    assertions.push({ selector, appears_by_seconds: Math.min(duration, at + .6), order: null, must_stay_in_frame: true, must_remain_live: false });
    events.push({ event_id: event.id, object_id: objectId ?? event.target_ids[0], selector, at_seconds: Number(event.at_seconds), property: "transform", visible_change: true });
  }
  return { script: script.join("\n    "), assertions, events };
}

function safeId(value) {
  return String(value ?? "object").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "object";
}

function safeColor(value, fallback) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback;
}

function alphaColor(value, alpha) {
  const color = safeColor(value, "#20231F").slice(1);
  const expanded = color.length === 3 ? [...color].map((entry) => `${entry}${entry}`).join("") : color.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(expanded.slice(index, index + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

function mixColor(background, fallback) {
  return /^#[0-9a-f]{6}$/i.test(background) ? `${background}F2` : fallback;
}

function fallbackPresenterLayout(format, shot, mode) {
  const width = Number(format.width);
  const height = Number(format.height);
  const seed = [...String(shot.id)].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const slot = seed % 3;
  const size = Math.round(Math.min(width * (mode === "anchor" ? .82 : .58), height * (mode === "anchor" ? .46 : .34)));
  const margin = Math.max(48, Math.round(width * .065));
  const x = slot === 1 && mode === "companion" ? margin : slot === 2 && mode === "companion" ? width - size - margin : Math.round((width - size) / 2);
  const y = slot === 0 ? Math.round(height * .1) : slot === 1 ? Math.round((height - size) / 2) : height - size - Math.round(height * .09);
  const enter = slot === 0 ? "slide-up" : slot === 1 ? "slide-left" : "slide-right";
  const exit = slot === 0 ? "slide-down" : slot === 1 ? "slide-left" : "slide-right";
  const cardEdge = y + size > height * .66 ? "top:8%;" : "bottom:8%;";
  return { x, y, size, enter, exit, cardEdge };
}

export async function fallbackFramesForVerification(workspacePath, verification) {
  const workspace = path.resolve(workspacePath);
  const [intake, evidence, plan] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(workspace, PRODUCTION_PATHS.plan))
  ]);
  const shotIds = new Set((verification?.failed ?? [])
    .filter((entry) => String(entry).startsWith("inspect:"))
    .map((entry) => String(entry).slice("inspect:".length)));
  const qaDir = verification?.qa ?? path.join(workspace, "production", "qa");
  for (const reportName of ["lint.json", "validate.json"]) {
    try {
      const report = await readJson(path.join(qaDir, reportName));
      const findings = report?.stdout?.findings ?? report?.stdout?.errors ?? report?.stdout?.issues ?? [];
      for (const finding of findings) {
        if (finding.severity !== "error" && finding.level !== "error") continue;
        const source = JSON.stringify(finding);
        for (const shot of plan.shots) if (source.includes(shot.id)) shotIds.add(shot.id);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const eligible = plan.shots.filter((shot) => shotIds.has(shot.id));
  if (!eligible.length) return { status: "not-applicable", repaired: [] };
  const store = await ProductionJobStore.open(workspace, { create: false });
  const repaired = [];
  for (const shot of eligible) {
    const jobId = `frame:${shot.id}`;
    const current = store.get(jobId);
    if (!current) continue;
    if (current.status === "succeeded") await store.markStaleFrom([jobId]);
    const stale = store.get(jobId);
    if (stale.status === "failed" || stale.status === "stale") await store.reconfigure(jobId, { input_hash: stale.input_hash });
    else if (stale.status !== "pending") continue;
    await store.markRunning(jobId, { provider: "local", response_id: current.remote?.response_id ?? null, status: "verification-fallback" });
    repaired.push(await persistFallbackFrame({
      workspace, intake, evidence, plan, shot, store, jobId,
      reason: `Native verification failed: ${(verification.failed ?? []).join(", ")}`,
      responseId: current.remote?.response_id ?? null
    }));
  }
  return { status: repaired.length ? "repaired" : "not-applicable", repaired };
}

async function persistFallbackFrame({ workspace, intake, evidence, plan, shot, store, jobId, reason, responseId = null, usage = {} }) {
  const fallback = buildFallbackFrame({ intake, plan, shot });
  const validation = validateFrameBundle(fallback, {
    shotId: shot.id,
    shot,
    format: plan.format,
    evidenceIds: evidence.items.map((entry) => entry.id),
    resourceIds: intake.resources.map((entry) => entry.id),
    resourceRoles: Object.fromEntries(intake.resources.map((entry) => [entry.id, entry.role])),
    allowedAssetPaths: intake.resources.filter((entry) => !entry.is_remote && entry.type !== "directory").map((entry) => entry.location)
  });
  const errors = [...validation.errors, ...validateHyperFramesRoot(fallback.html, shot, plan.format)];
  if (errors.length) throw new Error(`Fallback frame ${shot.id} failed semantic validation: ${errors.join("; ")}`);
  const paths = await writeFrameArtifacts(workspace, fallback);
  const outputs = await Promise.all(paths.map((filePath) => describeJobOutput(workspace, filePath)));
  await store.markSucceeded(jobId, outputs, usage);
  return {
    shot_id: shot.id,
    cached: false,
    fallback: true,
    fallback_reason: reason,
    bundle: paths[0], html: paths[1], motion: paths[2],
    response_id: responseId,
    model: "local-deterministic-fallback",
    usage
  };
}

function isSemanticValidationFailure(error) {
  return /failed semantic validation/i.test(String(error ?? ""));
}

async function writeFrameAttempt(workspace, shotId, attempt, record) {
  const directory = path.join(workspace, PRODUCTION_PATHS.frames, ".attempts");
  const filePath = safeShotFile(directory, `${shotId}-attempt-${attempt}`, ".json");
  await writeAtomic(filePath, `${JSON.stringify(record, null, 2)}\n`);
  return filePath;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function number(value) {
  return Number(Number(value).toFixed(3));
}

export function validateHyperFramesRoot(html, shot, format) {
  const errors = [];
  const source = String(html ?? "");
  const templates = [...source.matchAll(/<template\b[^>]*>([\s\S]*?)<\/template>/gi)];
  if (templates.length !== 1) return ["frame HTML requires exactly one template transport container"];
  const template = templates[0][1];
  const outsideTemplate = `${source.slice(0, templates[0].index)}${source.slice(templates[0].index + templates[0][0].length)}`;
  if (/<(?:style|script)\b/i.test(outsideTemplate)) errors.push("all live style and script blocks must be inside the template");
  const root = template.match(/<[^>]+data-composition-id=["']([^"']+)["'][^>]*>/i)?.[0] ?? "";
  if (!root) return ["frame HTML requires a data-composition-id root"];
  const attr = (name) => root.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
  if (attr("id") !== "root") errors.push('sub-composition root id must be "root"');
  if (attr("class")) errors.push("sub-composition root must not use a class; style it with #root");
  if (attr("data-composition-id") !== shot.id) errors.push(`root data-composition-id must be ${shot.id}`);
  if (Number(attr("data-start")) !== 0) errors.push("root data-start must be 0");
  const duration = shot.end_seconds - shot.start_seconds;
  if (Math.abs(Number(attr("data-duration")) - duration) > 0.01) errors.push(`root data-duration must be ${duration}`);
  if (Number(attr("data-width")) !== format.width) errors.push(`root data-width must be ${format.width}`);
  if (Number(attr("data-height")) !== format.height) errors.push(`root data-height must be ${format.height}`);
  if (!/#root\s*\{/i.test(template)) errors.push("sub-composition root must be styled by #root inside the template");
  if (!hasTimelineRegistration(template, shot.id)) errors.push(`template must register window.__timelines[${shot.id}]`);
  const ids = [...template.matchAll(/\sid=["']([^"']+)["']/gi)].map((match) => match[1]);
  const invalidIds = ids.filter((id) => id !== "root" && !id.startsWith(`${shot.id}-`));
  if (invalidIds.length) errors.push(`non-root ids must be prefixed with ${shot.id}-: ${[...new Set(invalidIds)].join(", ")}`);
  return errors;
}

async function writeFrameArtifacts(workspace, bundle) {
  const directory = path.join(workspace, PRODUCTION_PATHS.frames);
  const bundlePath = safeShotFile(directory, bundle.shot_id, ".json");
  const htmlPath = safeShotFile(directory, bundle.shot_id, ".html");
  const motionPath = safeShotFile(directory, bundle.shot_id, ".motion.json");
  await writeAtomic(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  await writeAtomic(htmlPath, `${bundle.html.trim()}\n`);
  await writeAtomic(motionPath, `${JSON.stringify(bundle.motion, null, 2)}\n`);
  return [bundlePath, htmlPath, motionPath];
}

export function safeShotFile(directory, shotId, suffix) {
  if (!isValidShotId(shotId)) throw new Error(`Unsafe shot ID: ${shotId}`);
  if (!/^\.[a-z0-9.-]+$/i.test(suffix)) throw new Error(`Unsafe shot artifact suffix: ${suffix}`);
  const root = path.resolve(directory);
  const output = path.resolve(root, `${shotId}${suffix}`);
  if (path.dirname(output) !== root) throw new Error(`Shot artifact escapes its directory: ${shotId}`);
  return output;
}

async function runPool(tasks, concurrency) {
  const output = new Array(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      output[index] = await tasks[index]();
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  const failed = settled.find((entry) => entry.status === "rejected");
  if (failed) throw failed.reason;
  return output;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readNarrationTiming(workspace) {
  try {
    const manifest = await readJson(path.join(workspace, "production", "media", "manifest.json"));
    const voiceover = manifest.voiceover;
    if (!voiceover?.words_path) return voiceover?.duration_seconds ? { duration_seconds: voiceover.duration_seconds, words: [] } : null;
    return { duration_seconds: voiceover.duration_seconds, words: await readJson(path.resolve(voiceover.words_path)) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}
