const SOURCE_TARGETS = ["html", "motion", "root_media_requests", "evidence_ids", "visible_copy", "preserve"];

export const REPAIR_CAPSULE_VERSION = "selector-capsule.v2";

export function buildRepairSourceCapsule(prior, findings = [], validationErrors = [], options = {}) {
  const selectors = collectRepairSelectors(findings, validationErrors);
  const diagnosticTerms = collectDiagnosticTerms(findings, validationErrors);
  const limits = {
    html: positiveInteger(options.htmlChars ?? 9_000, "HTML repair capsule size"),
    motion: positiveInteger(options.motionChars ?? 4_000, "motion repair capsule size")
  };
  const sources = SOURCE_TARGETS.flatMap((target) => {
    const source = target === "html" ? String(prior?.html ?? "") : JSON.stringify(prior?.[target], null, 2);
    const limit = limits[target];
    if (!limit || source.length <= limit) return [{ target, source, scope: "complete", excerpt: 1, excerpts: 1 }];
    const excerpts = exactSourceExcerpts(source, [...selectorAnchors(selectors), ...diagnosticTerms], {
      maximumCharacters: limit,
      radius: target === "html" ? 620 : 420,
      fallbackAnchors: target === "html"
        ? ["#root", "window.__timelines", "gsap.", "</template>"]
        : ["\"assertions\"", "\"events\""]
    });
    return excerpts.map((entry, index) => ({
      target,
      source: entry,
      scope: selectors.length ? "selector" : "structural",
      excerpt: index + 1,
      excerpts: excerpts.length
    }));
  });
  return { version: REPAIR_CAPSULE_VERSION, selectors, diagnostic_terms: diagnosticTerms, sources };
}

export function buildRepairContextCapsule(plan, shot) {
  const design = plan?.design ?? {};
  const visual = shot?.visual ?? {};
  return {
    global_design: selectFields(design, ["concept", "art_direction", "palette_roles", "typography", "texture", "composition_logic", "motion_character", "density"]),
    shot: {
      ...selectFields(shot, ["id", "start_seconds", "end_seconds", "purpose", "on_screen_text", "evidence_ids", "resource_ids", "presenter", "sfx"]),
      visual: {
        ...selectFields(visual, ["description", "concept", "representation", "composition", "typography", "motion"]),
        objects: (visual.objects ?? []).map((entry) => selectFields(entry, ["id", "kind", "meaning", "layer", "asset_resource_id", "lifecycle"])),
        events: (visual.events ?? []).map((entry) => selectFields(entry, ["id", "at_seconds", "target_ids", "action", "motion_verb", "visible_change", "sfx_eligible"])),
        continuity: visual.continuity ?? null
      }
    }
  };
}

export function collectRepairSelectors(findings = [], validationErrors = []) {
  const selectors = new Set();
  const visit = (value, key = "") => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, key);
      return;
    }
    if (typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
      return;
    }
    if (typeof value !== "string") return;
    if (key === "selector") {
      if (isSimpleSelector(value)) selectors.add(value.trim());
      else for (const match of value.matchAll(/[.#][A-Za-z_][\w-]{1,79}/g)) selectors.add(match[0]);
    }
    for (const match of value.matchAll(/(?:^|[\s(,;:'"`])([#.][A-Za-z_][\w-]{1,79})(?=$|[.\s),;:'"`])/g)) {
      if (isSimpleSelector(match[1])) selectors.add(match[1]);
    }
  };
  visit(findings);
  visit(validationErrors);
  return [...selectors].slice(0, 12);
}

export function collectDiagnosticTerms(findings = [], validationErrors = []) {
  const terms = new Set();
  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value === "object") return Object.values(value).forEach(visit);
    if (typeof value !== "string") return;
    for (const match of value.matchAll(/\b(querySelectorAll|querySelector|getElementById|getElementsByClassName|timeline\.(?:to|from|fromTo|set)|gsap\.(?:to|from|fromTo|set))\b/g)) terms.add(match[1]);
  };
  visit(findings);
  visit(validationErrors);
  return [...terms].slice(0, 8);
}

function exactSourceExcerpts(source, anchors, options) {
  const maximumCharacters = options.maximumCharacters;
  const radius = options.radius;
  const ranges = [];
  const candidates = [...anchors, ...options.fallbackAnchors];
  for (const anchor of candidates) {
    let cursor = 0;
    let matches = 0;
    while ((cursor = source.indexOf(anchor, cursor)) >= 0 && matches < 4) {
      ranges.push([Math.max(0, cursor - radius), Math.min(source.length, cursor + anchor.length + radius)]);
      cursor += Math.max(1, anchor.length);
      matches += 1;
    }
  }
  if (!ranges.length) ranges.push([0, Math.min(source.length, maximumCharacters)]);
  ranges.sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + 80) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const excerpts = [];
  let used = 0;
  for (const [start, end] of merged) {
    if (used >= maximumCharacters) break;
    const remaining = maximumCharacters - used;
    const excerpt = source.slice(start, Math.min(end, start + remaining));
    if (!excerpt) continue;
    excerpts.push(excerpt);
    used += excerpt.length;
  }
  return excerpts.length ? excerpts : [source.slice(0, maximumCharacters)];
}

function selectorAnchors(selectors) {
  const anchors = new Set();
  for (const selector of selectors) {
    anchors.add(selector);
    const name = selector.slice(1);
    if (selector.startsWith("#")) {
      anchors.add(`id="${name}"`);
      anchors.add(`id='${name}'`);
      anchors.add(`\"${name}\"`);
      anchors.add(`'${name}'`);
    } else {
      anchors.add(`class="${name}`);
      anchors.add(`class='${name}`);
    }
  }
  return [...anchors];
}

function isSimpleSelector(value) {
  return /^[#.][A-Za-z_][\w-]{1,79}$/.test(String(value).trim());
}

function selectFields(value, fields) {
  return Object.fromEntries(fields.filter((field) => value?.[field] !== undefined).map((field) => [field, value[field]]));
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}
