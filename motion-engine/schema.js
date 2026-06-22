// motion.timeline.v1 — the contract between any director (human, heuristic, LLM)
// and the MotionLayer renderer. Designed to be extracted into product-videogen
// unchanged: keep this file dependency-free and framework-free.

export const MOTION_TIMELINE_VERSION = "motion.timeline.v1";

export const EVENT_TYPES = new Set(["punch_zoom", "logo_pop"]);

export const SCENE_TYPES = new Set([
  "talking_head",
  "screen",
  "typography",
  "prompt_card",
  "screenshot_pile",
  "icon_flow",
  "card_steps",
  "stat_counter",
  "quote_card",
  "funnel",
  "profile_cards",
  "magnifier",
  "artifact_grid",
  "terminal_receipt",
  "chart",
  "diagram"
]);

// Art direction: scenes persist while builds run inside them, but nothing
// should sit past this without transforming.
export const MAX_SCENE_SECONDS = 6;
export const MIN_SCENE_SECONDS = 0.8;

// Legacy field, still validated so older timelines load: travel transitions
// were retired in the 4e feedback pass — the renderer cuts every scene in
// immediately and the motion lives inside the scene.
export const SCENE_TRANSITIONS = new Set(["cut", "swipe_left", "swipe_right", "zoom_into"]);

export const TALKING_HEAD_LAYOUTS = new Set(["split", "card", "full", "overlay", "window"]);
export const CARD_STEP_VARIANTS = new Set(["stack", "rail"]);
export const ICON_FLOW_VARIANTS = new Set(["vertical", "orbit"]);
export const CHART_TYPES = new Set(["bar", "stacked_bar", "line", "area", "donut", "scatter", "gauge", "funnel", "matrix", "sparkline", "stat_counter", "comparison_table"]);
export const DIAGRAM_TYPES = new Set(["directed_graph", "hub_spoke", "pipeline", "swimlane", "feedback_loop", "architecture_layers", "causal_chain", "comparison_split"]);
export const OBJECT_LIFECYCLE_STATES = new Set(["enter", "settle", "transform", "connect", "emphasize", "exit"]);

export const DEFAULT_SFX = {
  punch_zoom: "fast_whoosh.wav",
  logo_pop: "pop.wav",
  caption_chunk: "tick.wav"
};

// Scene-level sound design, bound automatically by the renderer: prompt
// cards type, step chips click, the final icon node lands with a retro
// success hit. Scene changes are silent — no boundary whoosh (4e).
export const SCENE_SFX = {
  scene_settle: "soft_thump.wav",
  prompt_typing: "writing_prompt.wav",
  step_item: "single_type.wav",
  icon_item: "pop.wav",
  icon_final: "retro_success.wav",
  funnel_item: "paper_flip.wav",
  funnel_branch: "paper_hit.wav",
  profile_card: "chip_drop.wav",
  profile_total: "success_ding.wav",
  magnifier_start: "camera_tick.wav",
  magnifier_focus: "inspection_pop.wav",
  artifact_item: "paper_hit.wav",
  artifact_final: "success_ding.wav",
  terminal_type: "single_type.wav",
  terminal_status: "success_ding.wav"
};

// Hard constraints enforced in code, not prompts.
export const MIN_EVENT_GAP_SECONDS = 0.35;
export const MAX_EVENTS_PER_10_SECONDS = 8;

export function validateTimeline(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["timeline must be an object"], warnings, timeline: null };
  }
  if (input.version !== MOTION_TIMELINE_VERSION) {
    errors.push(`version must be "${MOTION_TIMELINE_VERSION}"`);
  }
  const duration = Number(input.duration_seconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.push("duration_seconds must be a positive number");
  }

  const words = normalizeWords(input.words, errors);
  const events = normalizeEvents(input.events, duration, errors);
  checkDensity(events, warnings);
  checkOverlaps(events, errors);

  const base = normalizeBase(input.base);
  const scenes = normalizeScenes(input.scenes, duration, errors, warnings);
  const chapters = normalizeChapters(input.chapters, duration, errors);
  const objects = normalizeObjects(input.objects, scenes, duration, errors);
  checkZoomsNearCuts(events, scenes, warnings);
  const timeline = {
    version: MOTION_TIMELINE_VERSION,
    duration_seconds: duration,
    base,
    scenes,
    objects,
    chapters,
    audio: normalizeAudio(input.audio),
    words,
    events
  };
  return { ok: errors.length === 0, errors, warnings, timeline };
}

// Optional persistent chapter rail: 2-6 titled markers across the video.
function normalizeChapters(chapters, duration, errors) {
  if (chapters === undefined || chapters === null) return [];
  if (!Array.isArray(chapters)) {
    errors.push("chapters must be an array of {title, at}");
    return [];
  }
  const normalized = chapters
    .map((chapter, index) => {
      const title = String(chapter?.title ?? "").trim();
      const at = Number(chapter?.at);
      if (!title) errors.push(`chapters[${index}] missing title`);
      if (!Number.isFinite(at) || at < 0 || (Number.isFinite(duration) && at >= duration)) {
        errors.push(`chapters[${index}] has invalid at`);
        return null;
      }
      return { title: title.slice(0, 18), at };
    })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
  if (normalized.length === 1) errors.push("chapters needs at least 2 entries (or none)");
  if (normalized.length > 6) errors.push("chapters: at most 6");
  return normalized;
}

// The visual base is a track of scenes; voice runs continuously underneath.
// When scenes are absent the renderer falls back to `base` for the full run.
function normalizeScenes(scenes, duration, errors, warnings) {
  if (scenes === undefined || scenes === null) return [];
  if (!Array.isArray(scenes)) {
    errors.push("scenes must be an array");
    return [];
  }
  const normalized = scenes
    .map((scene, index) => normalizeScene(scene, index, errors))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  normalized.forEach((scene, index) => {
    const length = scene.end - scene.start;
    if (length > MAX_SCENE_SECONDS) {
      warnings.push(`scene "${scene.id}" runs ${length.toFixed(1)}s — art direction caps scenes at ${MAX_SCENE_SECONDS}s; split it`);
    }
    if (length < MIN_SCENE_SECONDS) {
      warnings.push(`scene "${scene.id}" is under ${MIN_SCENE_SECONDS}s — too quick to read`);
    }
    const next = normalized[index + 1];
    if (next && next.start < scene.end - 0.001) {
      errors.push(`scene "${next.id}" overlaps "${scene.id}"`);
    }
    if (next && next.start > scene.end + 0.05) {
      warnings.push(`gap between scenes "${scene.id}" and "${next.id}" — the placeholder backdrop will show`);
    }
  });
  if (normalized.length) {
    if (normalized[0].start > 0.05) warnings.push("first scene starts late — placeholder will show at t=0");
    const last = normalized[normalized.length - 1];
    if (Number.isFinite(duration) && last.end < duration - 0.25) {
      warnings.push("scenes end before the video does — placeholder will show at the tail");
    }
  }
  return normalized;
}

// Optional persistent object identities across scenes/renderers. Scene items can
// still be anonymous, but anything that must transform, connect, or exit later
// should be authored here so renderers never have to teleport fresh shapes.
function normalizeObjects(objects, scenes, duration, errors) {
  if (objects === undefined || objects === null) return [];
  if (!Array.isArray(objects)) {
    errors.push("objects must be an array of persistent object timelines");
    return [];
  }
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const objectIds = new Set();
  return objects.map((object, index) => {
    const id = String(object?.id ?? "").trim();
    if (!id) {
      errors.push(`objects[${index}] missing id`);
    } else if (objectIds.has(id)) {
      errors.push(`objects[${index}] duplicate id "${id}"`);
    } else {
      objectIds.add(id);
    }

    const sceneId = object?.scene_id === undefined ? "" : String(object.scene_id);
    if (sceneId && !sceneIds.has(sceneId)) {
      errors.push(`objects[${index}] references unknown scene_id "${sceneId}"`);
    }

    const states = normalizeObjectStates(object?.states, index, duration, errors);
    const role = String(object?.role ?? "prop").trim() || "prop";
    const entry = { id, role, states };
    if (object?.ref) entry.ref = String(object.ref);
    if (sceneId) entry.scene_id = sceneId;
    if (object?.object_type) entry.object_type = String(object.object_type);
    const z = Number(object?.z);
    if (Number.isFinite(z)) entry.z = z;
    return entry;
  });
}

function normalizeObjectStates(states, objectIndex, duration, errors) {
  if (!Array.isArray(states) || !states.length) {
    errors.push(`objects[${objectIndex}] requires states`);
    return [];
  }
  let lastAt = -Infinity;
  const normalized = states.slice(0, 20).map((state, stateIndex) => {
    const lifecycleState = String(state?.state ?? "");
    const at = Number(state?.at);
    if (!OBJECT_LIFECYCLE_STATES.has(lifecycleState)) {
      errors.push(`objects[${objectIndex}] states[${stateIndex}] has unknown lifecycle state "${lifecycleState}"`);
    }
    if (!Number.isFinite(at) || at < 0 || (Number.isFinite(duration) && at >= duration)) {
      errors.push(`objects[${objectIndex}] states[${stateIndex}] has invalid at`);
    }
    if (Number.isFinite(at) && at < lastAt - 0.001) {
      errors.push(`objects[${objectIndex}] states[${stateIndex}] moves backward in time`);
    }
    if (Number.isFinite(at)) lastAt = at;

    const entry = {
      state: lifecycleState,
      at: Number.isFinite(at) ? at : 0,
      duration: clampNumber(state?.duration, 0.05, 3, lifecycleState === "settle" ? 0.45 : 0.35)
    };
    const target = normalizeObjectTarget(state?.to);
    if (target) entry.to = target;
    if (state?.sfx !== undefined) entry.sfx = state.sfx === null ? null : String(state.sfx);
    return entry;
  });

  const firstState = normalized[0]?.state;
  if (firstState && firstState !== "enter" && firstState !== "settle") {
    errors.push(`objects[${objectIndex}] must start with enter or settle`);
  }
  const exitIndex = normalized.findIndex((state) => state.state === "exit");
  if (exitIndex !== -1 && exitIndex !== normalized.length - 1) {
    errors.push(`objects[${objectIndex}] exit state must be final`);
  }
  return normalized;
}

function normalizeObjectTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return null;
  const normalized = {};
  for (const [key, value] of Object.entries(target)) {
    if (value === null || value === undefined) continue;
    if (["string", "number", "boolean"].includes(typeof value)) normalized[key] = value;
  }
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeScene(scene, index, errors) {
  const type = String(scene?.type ?? "");
  if (!SCENE_TYPES.has(type)) {
    errors.push(`scenes[${index}] has unknown type "${type}"`);
    return null;
  }
  const start = Number(scene?.start);
  const end = Number(scene?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    errors.push(`scenes[${index}] (${type}) has invalid timing`);
    return null;
  }
  const transitionRaw = String(scene?.transition ?? "cut");
  if (!SCENE_TRANSITIONS.has(transitionRaw)) {
    errors.push(`scenes[${index}] has unknown transition "${transitionRaw}"`);
  }
  // The first scene has nothing to travel from.
  const transition = index === 0 ? "cut" : transitionRaw;
  const base = { id: String(scene?.id ?? `${type}-${index}`), type, start, end, transition };
  if (type === "talking_head" || type === "screen") {
    if (!scene?.src) errors.push(`scenes[${index}] (${type}) requires src — footage scenes must be real recordings`);
    const layout = String(scene?.layout ?? "split");
    if (type === "talking_head" && !TALKING_HEAD_LAYOUTS.has(layout)) {
      errors.push(`scenes[${index}] (talking_head) has unknown layout "${layout}"`);
    }
    const footage = {
      ...base,
      src: String(scene?.src ?? ""),
      // Footage offset within the source file; talking_head defaults to the
      // global clock so one continuous take stays in sync with its own audio.
      offset: scene?.offset === undefined ? (type === "talking_head" ? start : 0) : Number(scene.offset)
    };
    if (type === "talking_head") {
      footage.layout = layout;
      if (layout === "window") {
        footage.window = normalizePresenterWindow(scene?.window);
      }
      // Optional word builds staged on the paper above a split-layout face.
      footage.items = Array.isArray(scene?.items)
        ? scene.items.map((item, itemIndex) => ({
            text: String(item?.text ?? ""),
            at: clampNumber(item?.at, start, end, start + itemIndex * 0.8),
            ...(item?.emphasis ? { emphasis: true } : {}),
            ...(item?.color ? { color: String(item.color) } : {})
          }))
        : [];
    }
    return footage;
  }
  if (type === "stat_counter") {
    if (!scene?.value) errors.push(`scenes[${index}] (stat_counter) requires value (e.g. "87%", "10x", "$2,000")`);
    return {
      ...base,
      value: String(scene?.value ?? ""),
      label: String(scene?.label ?? ""),
      color: scene?.color ? String(scene.color) : "mint",
      at: clampNumber(scene?.at, start, end, start + 0.3)
    };
  }
  if (type === "quote_card") {
    if (!scene?.text) errors.push(`scenes[${index}] (quote_card) requires text`);
    return {
      ...base,
      text: String(scene?.text ?? ""),
      attribution: String(scene?.attribution ?? ""),
      at: clampNumber(scene?.at, start, end, start + 0.2)
    };
  }
  if (type === "prompt_card") {
    if (!scene?.text) errors.push(`scenes[${index}] (prompt_card) requires text — the real prompt, never invented`);
    // Optional brand icon chips shown in the composer's icon row (real
    // assets only, max 3 — the bar is small).
    const icons = Array.isArray(scene?.icons) ? scene.icons.map((icon) => String(icon)).filter(Boolean).slice(0, 3) : [];
    return { ...base, text: String(scene?.text ?? ""), icons };
  }
  if (type === "typography" || type === "icon_flow" || type === "card_steps" || type === "screenshot_pile") {
    const raw = Array.isArray(scene?.items) ? scene.items : [];
    if (!raw.length) errors.push(`scenes[${index}] (${type}) requires items`);
    const items = raw.map((item, itemIndex) => {
      const entry = {
        text: String(item?.text ?? item?.label ?? ""),
        at: clampNumber(item?.at, start, end, start + itemIndex * 0.8)
      };
      if (item?.emphasis) entry.emphasis = true;
      if (item?.color) entry.color = String(item.color);
      if (item?.src) entry.src = String(item.src);
      return entry;
    });
    if (type === "screenshot_pile") {
      items.forEach((item, itemIndex) => {
        if (!item.src) errors.push(`scenes[${index}] (screenshot_pile) items[${itemIndex}] requires src — real screenshots only`);
      });
      const mode = String(scene?.mode ?? "pile");
      if (mode !== "pile" && mode !== "scroll") errors.push(`scenes[${index}] (screenshot_pile) has unknown mode "${mode}"`);
      return { ...base, title: String(scene?.title ?? ""), mode, items };
    }
    if (type === "card_steps") {
      const variant = String(scene?.variant ?? "stack");
      if (!CARD_STEP_VARIANTS.has(variant)) errors.push(`scenes[${index}] (card_steps) has unknown variant "${variant}"`);
      return { ...base, title: String(scene?.title ?? ""), variant, items };
    }
    if (type === "icon_flow") {
      const variant = String(scene?.variant ?? "vertical");
      if (!ICON_FLOW_VARIANTS.has(variant)) errors.push(`scenes[${index}] (icon_flow) has unknown variant "${variant}"`);
      return { ...base, title: String(scene?.title ?? ""), variant, items };
    }
    return { ...base, title: String(scene?.title ?? ""), items };
  }
  if (type === "funnel") {
    const raw = Array.isArray(scene?.items) ? scene.items : [];
    if (!raw.length) errors.push(`scenes[${index}] (funnel) requires items`);
    const items = raw.map((item, itemIndex) => {
      const entry = {
        text: String(item?.text ?? item?.label ?? ""),
        at: clampNumber(item?.at, start, end, start + itemIndex * 0.7)
      };
      if (item?.icon) entry.icon = String(item.icon);
      if (item?.color) entry.color = String(item.color);
      if (item?.badge !== undefined) entry.badge = String(item.badge);
      return entry;
    });
    const funnel = { ...base, title: String(scene?.title ?? ""), items };
    if (scene?.branch && typeof scene.branch === "object") {
      const fromIndex = Number(scene.branch.fromIndex);
      if (Number.isInteger(fromIndex) && fromIndex >= 0 && fromIndex < items.length) {
        funnel.branch = {
          fromIndex,
          text: String(scene.branch.text ?? ""),
          color: scene.branch.color ? String(scene.branch.color) : "coral",
          at: clampNumber(scene.branch.at, start, end, items[fromIndex].at)
        };
      } else {
        errors.push(`scenes[${index}] (funnel) branch.fromIndex is out of range`);
      }
    }
    return funnel;
  }
  if (type === "profile_cards") {
    const raw = Array.isArray(scene?.items) ? scene.items : [];
    if (!raw.length) errors.push(`scenes[${index}] (profile_cards) requires items`);
    const mode = String(scene?.mode ?? "cascade");
    if (mode !== "cascade" && mode !== "grid") errors.push(`scenes[${index}] (profile_cards) has unknown mode "${mode}"`);
    const items = raw.map((item, itemIndex) => {
      const entry = {
        name: String(item?.name ?? item?.text ?? ""),
        at: clampNumber(item?.at, start, end, start + itemIndex * 0.5)
      };
      if (item?.role) entry.role = String(item.role);
      if (item?.avatar) entry.avatar = String(item.avatar);
      if (item?.pill) entry.pill = String(item.pill);
      if (item?.value) entry.value = String(item.value);
      return entry;
    });
    const profile = { ...base, mode, items };
    if (scene?.total && typeof scene.total === "object" && scene.total.value !== undefined) {
      profile.total = {
        label: String(scene.total.label ?? ""),
        value: String(scene.total.value),
        at: clampNumber(scene.total.at, start, end, end - 1.2)
      };
    }
    return profile;
  }
  if (type === "magnifier") {
    if (!scene?.src) errors.push(`scenes[${index}] (magnifier) requires src — a real screenshot`);
    const point = (p, dx, dy) => ({
      x: clampNumber(p?.x, 0, 1, dx),
      y: clampNumber(p?.y, 0, 1, dy)
    });
    return {
      ...base,
      src: String(scene?.src ?? ""),
      text: String(scene?.text ?? ""),
      from: point(scene?.from, 0.3, 0.3),
      to: point(scene?.to, 0.65, 0.65)
    };
  }
  if (type === "artifact_grid") {
    const raw = Array.isArray(scene?.items) ? scene.items : [];
    if (!raw.length) errors.push(`scenes[${index}] (artifact_grid) requires items`);
    const items = raw.map((item, itemIndex) => ({
      label: String(item?.label ?? item?.text ?? item?.path ?? ""),
      path: String(item?.path ?? ""),
      at: clampNumber(item?.at, start, end, start + itemIndex * 0.55),
      ...(item?.src ? { src: String(item.src) } : {}),
      ...(item?.status ? { status: String(item.status) } : {})
    }));
    return { ...base, title: String(scene?.title ?? ""), items };
  }
  if (type === "chart") {
    const chartType = String(scene?.chart_type ?? "bar");
    if (!CHART_TYPES.has(chartType)) errors.push(`scenes[${index}] (chart) has unknown chart_type "${chartType}"`);
    const raw = Array.isArray(scene?.data) ? scene.data : [];
    if (!raw.length) errors.push(`scenes[${index}] (chart) requires data`);
    if (!scene?.source && !scene?.claim_status) errors.push(`scenes[${index}] (chart) requires source or claim_status`);
    const needsAxes = !["donut", "gauge", "stat_counter"].includes(chartType);
    if (needsAxes && (!scene?.x_label || !scene?.y_label)) {
      errors.push(`scenes[${index}] (chart) requires x_label and y_label for ${chartType}`);
    }
    const data = raw.slice(0, 24).map((point, pointIndex) => {
      const entry = {
        label: String(point?.label ?? point?.x ?? `point ${pointIndex + 1}`),
        value: numberOrNull(point?.value ?? point?.y),
        at: clampNumber(point?.at, start, end, start + pointIndex * 0.45)
      };
      if (point?.series) entry.series = String(point.series);
      if (point?.x !== undefined) entry.x = String(point.x);
      if (point?.color) entry.color = String(point.color);
      if (entry.value === null) errors.push(`scenes[${index}] (chart) data[${pointIndex}] requires numeric value`);
      return entry;
    });
    return {
      ...base,
      chart_type: chartType,
      title: String(scene?.title ?? ""),
      x_label: String(scene?.x_label ?? ""),
      y_label: String(scene?.y_label ?? ""),
      source: String(scene?.source ?? ""),
      claim_status: String(scene?.claim_status ?? "evidence-backed"),
      style: String(scene?.style ?? "paper"),
      data
    };
  }
  if (type === "diagram") {
    const diagramType = String(scene?.diagram_type ?? "directed_graph");
    if (!DIAGRAM_TYPES.has(diagramType)) errors.push(`scenes[${index}] (diagram) has unknown diagram_type "${diagramType}"`);
    const rawNodes = Array.isArray(scene?.nodes) ? scene.nodes : [];
    const rawConnectors = Array.isArray(scene?.connectors) ? scene.connectors : [];
    if (!rawNodes.length) errors.push(`scenes[${index}] (diagram) requires nodes`);
    const nodes = rawNodes.slice(0, 12).map((node, nodeIndex) => {
      const id = String(node?.id ?? `node-${nodeIndex + 1}`);
      if (!String(node?.label ?? "").trim()) errors.push(`scenes[${index}] (diagram) node "${id}" requires label`);
      return {
        id,
        label: String(node?.label ?? ""),
        at: clampNumber(node?.at, start, end, start + nodeIndex * 0.45),
        x: clampNumber(node?.x, 0.04, 0.96, layoutPoint(nodeIndex, rawNodes.length).x),
        y: clampNumber(node?.y, 0.08, 0.92, layoutPoint(nodeIndex, rawNodes.length).y),
        ...(node?.icon ? { icon: String(node.icon) } : {}),
        ...(node?.color ? { color: String(node.color) } : {})
      };
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const connectors = rawConnectors.slice(0, 16).map((connector, connectorIndex) => {
      const from = String(connector?.from ?? "");
      const to = String(connector?.to ?? "");
      if (!nodeIds.has(from)) errors.push(`scenes[${index}] (diagram) connector ${connectorIndex + 1} has unknown from "${from}"`);
      if (!nodeIds.has(to)) errors.push(`scenes[${index}] (diagram) connector ${connectorIndex + 1} has unknown to "${to}"`);
      const style = String(connector?.style ?? "solid");
      return {
        from,
        to,
        label: String(connector?.label ?? ""),
        style: ["solid", "dotted", "curved", "loopback", "warning", "success"].includes(style) ? style : "solid",
        at: clampNumber(connector?.at, start, end, start + nodes.length * 0.35 + connectorIndex * 0.35)
      };
    });
    if (nodes.length > 1 && !connectors.length) errors.push(`scenes[${index}] (diagram) needs connectors for multi-node diagrams`);
    return {
      ...base,
      diagram_type: diagramType,
      title: String(scene?.title ?? ""),
      nodes,
      connectors
    };
  }
  if (type === "terminal_receipt") {
    if (!scene?.command) errors.push(`scenes[${index}] (terminal_receipt) requires command`);
    return {
      ...base,
      command: String(scene?.command ?? ""),
      output: String(scene?.output ?? ""),
      status: String(scene?.status ?? "passed"),
      at: clampNumber(scene?.at, start, end, start + 0.4)
    };
  }
  return base;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function layoutPoint(index, total) {
  if (total <= 1) return { x: 0.5, y: 0.5 };
  const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
  return {
    x: 0.5 + Math.cos(angle) * 0.28,
    y: 0.5 + Math.sin(angle) * 0.24
  };
}

function normalizePresenterWindow(input) {
  const value = input && typeof input === "object" ? input : {};
  const position = ["lower", "upper", "left", "right", "center"].includes(value.position) ? value.position : "lower";
  return {
    position,
    width: clampNumber(value.width, 0.35, 0.9, 0.82),
    x: value.x === undefined ? null : clampNumber(value.x, 0, 1, 0.5),
    y: value.y === undefined ? null : clampNumber(value.y, 0, 1, 0.72)
  };
}

// The cut is already the accent — zooms hugging a boundary double-hit.
function checkZoomsNearCuts(events, scenes, warnings) {
  if (!scenes.length) return;
  for (const event of events) {
    if (event.type !== "punch_zoom") continue;
    for (const scene of scenes) {
      if (Math.abs(event.start - scene.start) < 0.5 && event.start !== scene.start) {
        warnings.push(`punch_zoom "${event.id}" lands within 0.5s of the cut into "${scene.id}" — move it or drop it`);
      }
    }
  }
}

function normalizeBase(base) {
  if (!base || typeof base !== "object") return { type: "placeholder", src: "" };
  const type = base.type === "video" ? "video" : "placeholder";
  return { type, src: String(base.src ?? "") };
}

function normalizeAudio(audio) {
  if (!audio || typeof audio !== "object") return { voiceover: "", music: "", music_volume: 0.08 };
  return {
    voiceover: String(audio.voiceover ?? ""),
    music: String(audio.music ?? ""),
    music_volume: clampNumber(audio.music_volume, 0, 1, 0.08)
  };
}

function normalizeWords(words, errors) {
  if (!Array.isArray(words)) {
    errors.push("words must be an array of {word,start,end}");
    return [];
  }
  const normalized = [];
  let lastEnd = 0;
  words.forEach((entry, index) => {
    const word = String(entry?.word ?? "").trim();
    const start = Number(entry?.start);
    const end = Number(entry?.end);
    if (!word) errors.push(`words[${index}] missing word text`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      errors.push(`words[${index}] has invalid timing`);
      return;
    }
    if (start < lastEnd - 0.001) errors.push(`words[${index}] overlaps previous word`);
    lastEnd = end;
    normalized.push({ word, start, end, emphasis: Boolean(entry?.emphasis) });
  });
  return normalized;
}

function normalizeEvents(events, duration, errors) {
  if (!Array.isArray(events)) {
    errors.push("events must be an array");
    return [];
  }
  const normalized = events
    .map((event, index) => normalizeEvent(event, index, duration, errors))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  return normalized;
}

function normalizeEvent(event, index, duration, errors) {
  const type = String(event?.type ?? "");
  if (!EVENT_TYPES.has(type)) {
    errors.push(`events[${index}] has unknown type "${type}"`);
    return null;
  }
  const start = Number(event?.start);
  const end = Number(event?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    errors.push(`events[${index}] (${type}) has invalid timing`);
    return null;
  }
  if (Number.isFinite(duration) && end > duration + 0.25) {
    errors.push(`events[${index}] (${type}) ends after the video does`);
  }
  const base = {
    id: String(event?.id ?? `${type}-${index}`),
    type,
    start,
    end,
    sfx: event?.sfx === null ? null : String(event?.sfx ?? DEFAULT_SFX[type] ?? "")
  };
  if (type === "punch_zoom") {
    return {
      ...base,
      scale: clampNumber(event?.scale, 1.02, 1.35, 1.08),
      origin_x: clampNumber(event?.origin_x, 0, 1, 0.5),
      origin_y: clampNumber(event?.origin_y, 0, 1, 0.42)
    };
  }
  if (type === "logo_pop") {
    if (!event?.src) errors.push(`events[${index}] (logo_pop) requires src`);
    return {
      ...base,
      src: String(event?.src ?? ""),
      x: clampNumber(event?.x, 0, 1, 0.72),
      y: clampNumber(event?.y, 0, 1, 0.3),
      size: clampNumber(event?.size, 0.08, 0.5, 0.22),
      label: String(event?.label ?? "")
    };
  }
  return base;
}

function checkDensity(events, warnings) {
  for (const event of events) {
    const windowEnd = event.start + 10;
    const count = events.filter((other) => other.start >= event.start && other.start < windowEnd).length;
    if (count > MAX_EVENTS_PER_10_SECONDS) {
      warnings.push(`more than ${MAX_EVENTS_PER_10_SECONDS} events within 10s of t=${event.start.toFixed(1)} — pacing will feel frantic`);
      break;
    }
  }
}

function checkOverlaps(events, errors) {
  const zooms = events.filter((event) => event.type === "punch_zoom");
  for (let index = 1; index < zooms.length; index += 1) {
    if (zooms[index].start < zooms[index - 1].end - 0.001) {
      errors.push(`punch_zoom "${zooms[index].id}" overlaps "${zooms[index - 1].id}" — zooms cannot stack`);
    }
  }
}

// Snap event boundaries to the nearest spoken-word start so motion lands on speech.
export function snapEventsToWords(events, words) {
  if (!words.length) return events;
  return events.map((event) => {
    const start = nearestWordStart(words, event.start);
    const length = event.end - event.start;
    return { ...event, start, end: start + length };
  });
}

function nearestWordStart(words, time) {
  let best = words[0].start;
  let bestDistance = Math.abs(words[0].start - time);
  for (const entry of words) {
    const distance = Math.abs(entry.start - time);
    if (distance < bestDistance) {
      best = entry.start;
      bestDistance = distance;
    }
  }
  return best;
}

// Group words into caption chunks of 1-3 words, breaking on punctuation and pauses.
export function chunkWords(words, { maxWords = 3, pauseBreak = 0.45 } = {}) {
  const chunks = [];
  let current = [];
  for (const entry of words) {
    const previous = current[current.length - 1];
    const longPause = previous && entry.start - previous.end > pauseBreak;
    if (current.length >= maxWords || longPause) {
      chunks.push(buildChunk(current));
      current = [];
    }
    current.push(entry);
    if (/[.!?,—]$/.test(entry.word)) {
      chunks.push(buildChunk(current));
      current = [];
    }
  }
  if (current.length) chunks.push(buildChunk(current));
  return chunks;
}

function buildChunk(words) {
  return {
    start: words[0].start,
    end: words[words.length - 1].end,
    words: words.map((entry) => ({
      word: entry.word.replace(/[.!?,]$/, ""),
      start: entry.start,
      end: entry.end,
      emphasis: entry.emphasis
    }))
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
