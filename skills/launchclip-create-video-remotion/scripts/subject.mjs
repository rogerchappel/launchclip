// Subject stage contracts: the person cut-out's probe and range files, and the
// pure mask analysis both are built from. Plain ESM, no imports.
//
// The probe (launchclip.subject-probe.v1) samples about one frame per second
// so the planner knows the framing before it plans. A range
// (launchclip.subject.v1) describes every frame of one matted source range.
// Boxes are {x, y, w, h} in canvas fractions with (x, y) the box centre; times
// are source seconds, so a base trim maps onto them exactly as it maps onto
// the recording. See docs/SUBJECT_EFFECTS_RFC.md §4.
//
// Canonical copy: kit/core/subject.mjs.

export const SUBJECT_PROBE_SCHEMA = "launchclip.subject-probe.v1";
export const SUBJECT_SCHEMA = "launchclip.subject.v1";

export const PEOPLE = Object.freeze(["none", "one", "several"]);
export const FRAMINGS = Object.freeze(["close-up", "medium", "wide"]);

// Alpha at or above this (0–255) counts as the person.
export const MASK_THRESHOLD = 128;
// Connected components are found on a grid this many cells wide.
const GRID_COLUMNS = 96;
// A component is a person when it covers at least this much of the frame and
// at least this share of the largest component.
const PERSON_MIN_AREA = 0.02;
const PERSON_MIN_SHARE = 0.25;
// Framing counts head heights of frame below the chin, so it reads the same
// in 9:16 and 16:9: fewer than this is a close-up, more than WIDE_HEADS wide.
const CLOSE_UP_HEADS = 1.5;
const WIDE_HEADS = 4;
// Usability floors.
const MIN_COVERAGE = 0.04;
const MIN_STABILITY = 0.7;

/**
 * Analyse one alpha mask. alpha: Uint8Array (or any indexable) of
 * width × height values 0–255, row-major.
 * → {coverage, people: "none"|"one"|"several", body, head} with body and head
 *   null when there is no person.
 */
export function maskStats(alpha, width, height, { threshold = MASK_THRESHOLD } = {}) {
  if (!(width > 0 && height > 0) || alpha.length < width * height) throw new Error(`mask needs ${width}×${height} values, got ${alpha.length}`);
  let on = 0;
  for (let i = 0; i < width * height; i += 1) if (alpha[i] >= threshold) on += 1;
  const coverage = on / (width * height);
  const grid = maskGrid(alpha, width, height, threshold);
  const components = gridComponents(grid);
  const largest = components[0];
  const people = personCount(components, grid);
  if (!largest || people === "none") return { coverage: round(coverage), people: "none", body: null, head: null };
  const body = gridBox(largest, grid);
  const head = headBox(alpha, width, height, threshold, body);
  return { coverage: round(coverage), people, body, head };
}

/**
 * Framing from a head box (fractions): close-up (face and shoulders), medium
 * (chest or waist up) or wide (most of the body, the room around it).
 */
export function classifyFraming(head) {
  if (!head || !(head.h > 0)) return null;
  const below = Math.max(0, 1 - (head.y + head.h / 2)) / head.h;
  if (below < CLOSE_UP_HEADS) return "close-up";
  if (below <= WIDE_HEADS) return "medium";
  return "wide";
}

/**
 * Combine per-sample maskStats into a probe or range summary.
 * samples: [{t, coverage, people, body, head}]
 * → {people, framing, usable, reasons, head, body, headroom, coverage, stability}
 */
export function summarizeSamples(samples) {
  const list = Array.isArray(samples) ? samples : [];
  const reasons = [];
  if (!list.length) {
    return { people: "none", framing: null, usable: false, reasons: ["no frames were analysed"], head: null, body: null, headroom: null, coverage: 0, stability: 0 };
  }
  const people = modeOf(list.map((sample) => sample.people), PEOPLE);
  const withPerson = list.filter((sample) => sample.people !== "none" && sample.body && sample.head);
  const head = medianBox(withPerson.map((sample) => sample.head));
  const body = medianBox(withPerson.map((sample) => sample.body));
  const coverage = median(list.map((sample) => sample.coverage));
  const stability = coverageStability(list.map((sample) => sample.coverage));
  const framing = classifyFraming(head);
  if (people === "none") reasons.push("no person was found");
  if (people === "several") reasons.push("more than one person is in frame");
  if (people !== "none" && coverage < MIN_COVERAGE) reasons.push(`the person covers ${percent(coverage)} of the frame (needs ${percent(MIN_COVERAGE)})`);
  if (people !== "none" && stability < MIN_STABILITY) reasons.push(`the cut-out is unstable (stability ${round(stability)}, needs ${MIN_STABILITY})`);
  const missing = list.length - withPerson.length;
  if (people === "one" && missing / list.length > 0.25) reasons.push(`the person is missing from ${missing} of ${list.length} sampled frames`);
  return {
    people,
    framing,
    usable: reasons.length === 0,
    reasons,
    head,
    body,
    headroom: head ? round(Math.max(0, head.y - head.h / 2)) : null,
    coverage: round(coverage),
    stability: round(stability)
  };
}

/** The frame entry nearest to source time t in a range file (binary search). */
export function subjectAt(info, t) {
  const frames = info?.frames ?? [];
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(frames[lo - 1].t - t) <= Math.abs(frames[lo].t - t)) lo -= 1;
  return frames[lo];
}

/** → {ok, errors: string[]} for a probe object. */
export function validateSubjectProbe(probe) {
  const errors = [];
  if (!isObject(probe)) return { ok: false, errors: ["probe must be an object"] };
  if (probe.schema !== SUBJECT_PROBE_SCHEMA) errors.push(`schema must be "${SUBJECT_PROBE_SCHEMA}"`);
  sourceErrors(probe.source, "source", errors);
  if (!nonEmpty(probe.model)) errors.push("model must be a model id");
  summaryErrors(probe, "", errors);
  if (!Array.isArray(probe.samples)) errors.push("samples must be a list");
  else probe.samples.forEach((sample, index) => sampleErrors(sample, `samples[${index}]`, errors));
  return { ok: errors.length === 0, errors };
}

/** → {ok, errors: string[]} for a range file (subject.json). */
export function validateSubjectInfo(info) {
  const errors = [];
  if (!isObject(info)) return { ok: false, errors: ["subject info must be an object"] };
  if (info.schema !== SUBJECT_SCHEMA) errors.push(`schema must be "${SUBJECT_SCHEMA}"`);
  sourceErrors(info.source, "source", errors);
  if (!nonEmpty(info.model)) errors.push("model must be a model id");
  const range = info.range;
  if (!isObject(range) || !finite(range.in) || !finite(range.out) || range.in < 0 || range.out <= range.in) errors.push("range must be {in, out} source seconds with out > in");
  if (!nonEmpty(info.matte)) errors.push("matte must be the matte video's file name");
  if (info.matte_size !== undefined && !(isObject(info.matte_size) && finite(info.matte_size.width) && info.matte_size.width > 0 && finite(info.matte_size.height) && info.matte_size.height > 0)) errors.push("matte_size must be {width, height} in pixels");
  summaryErrors(info, "", errors);
  if (!Array.isArray(info.frames) || !info.frames.length) errors.push("frames must be a non-empty list");
  else {
    let previous = -Infinity;
    info.frames.forEach((frame, index) => {
      sampleErrors(frame, `frames[${index}]`, errors);
      if (finite(frame?.t) && frame.t <= previous) errors.push(`frames[${index}].t must increase`);
      if (finite(frame?.t)) previous = frame.t;
    });
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------

function maskGrid(alpha, width, height, threshold) {
  const columns = Math.min(GRID_COLUMNS, width);
  const cell = width / columns;
  const rows = Math.max(1, Math.round(height / cell));
  const cellHeight = height / rows;
  const cells = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor(row * cellHeight);
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * cellHeight));
    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.floor(column * cell);
      const x1 = Math.max(x0 + 1, Math.floor((column + 1) * cell));
      let count = 0;
      let total = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          total += 1;
          if (alpha[y * width + x] >= threshold) count += 1;
        }
      }
      cells[row * columns + column] = count * 2 >= total ? 1 : 0;
    }
  }
  return { cells, columns, rows };
}

// Components of set cells, 4-connected, largest first: [{area, minX, maxX, minY, maxY}].
function gridComponents({ cells, columns, rows }) {
  const seen = new Uint8Array(cells.length);
  const components = [];
  const stack = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (!cells[start] || seen[start]) continue;
    const component = { area: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const index = stack.pop();
      const x = index % columns;
      const y = (index - x) / columns;
      component.area += 1;
      if (x < component.minX) component.minX = x;
      if (x > component.maxX) component.maxX = x;
      if (y < component.minY) component.minY = y;
      if (y > component.maxY) component.maxY = y;
      for (const next of [x > 0 ? index - 1 : -1, x < columns - 1 ? index + 1 : -1, y > 0 ? index - columns : -1, y < rows - 1 ? index + columns : -1]) {
        if (next >= 0 && cells[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    components.push(component);
  }
  return components.sort((a, b) => b.area - a.area);
}

function personCount(components, { columns, rows }) {
  const total = columns * rows;
  const largest = components[0]?.area ?? 0;
  const people = components.filter((component) => component.area / total >= PERSON_MIN_AREA && component.area >= largest * PERSON_MIN_SHARE).length;
  return people === 0 ? "none" : people === 1 ? "one" : "several";
}

function gridBox(component, { columns, rows }) {
  const left = component.minX / columns;
  const right = (component.maxX + 1) / columns;
  const top = component.minY / rows;
  const bottom = (component.maxY + 1) / rows;
  return box(left, top, right, bottom);
}

// The head: the silhouette's rows from the top, measured inside the body
// box's columns. The head's width is taken from the upper quarter of the
// window (the 80th percentile span, so hair wisps do not count); the head
// ends at the first row that is half as wide again (the shoulders), and is
// never taller than HEAD_ASPECT head widths.
const HEAD_ASPECT = 1.6;
function headBox(alpha, width, height, threshold, body) {
  const x0 = Math.max(0, Math.floor((body.x - body.w / 2) * width));
  const x1 = Math.min(width, Math.ceil((body.x + body.w / 2) * width));
  const top = Math.max(0, Math.floor((body.y - body.h / 2) * height));
  const bottom = Math.min(height, Math.ceil((body.y + body.h / 2) * height));
  const minRows = Math.max(2, Math.round(height * 0.03));
  const windowRows = Math.max(minRows, Math.round((bottom - top) * 0.6));
  const rows = [];
  for (let y = top; y < bottom && y < top + windowRows; y += 1) {
    let left = -1;
    let right = -1;
    for (let x = x0; x < x1; x += 1) {
      if (alpha[y * width + x] >= threshold) {
        if (left < 0) left = x;
        right = x;
      }
    }
    rows.push(left < 0 ? null : { y, left, right, span: right - left + 1 });
  }
  const upper = rows.slice(0, Math.max(minRows, Math.round(rows.length / 4))).filter(Boolean).map((row) => row.span).sort((a, b) => a - b);
  if (!upper.length) return null;
  const headWidth = upper[Math.min(upper.length - 1, Math.floor(upper.length * 0.8))];
  const maxHeight = Math.max(minRows, Math.round(headWidth * HEAD_ASPECT));
  let headLeft = Infinity;
  let headRight = -Infinity;
  let end = top;
  for (const row of rows) {
    if (!row) continue;
    if (row.y - top >= maxHeight) break;
    if (row.y - top >= minRows && row.span > headWidth * 1.5) break;
    if (row.left < headLeft) headLeft = row.left;
    if (row.right > headRight) headRight = row.right;
    end = row.y + 1;
  }
  if (!Number.isFinite(headLeft)) return null;
  return box(headLeft / width, top / height, (headRight + 1) / width, end / height);
}

function box(left, top, right, bottom) {
  return { x: round((left + right) / 2), y: round((top + bottom) / 2), w: round(right - left), h: round(bottom - top) };
}

function medianBox(boxes) {
  if (!boxes.length) return null;
  return { x: round(median(boxes.map((b) => b.x))), y: round(median(boxes.map((b) => b.y))), w: round(median(boxes.map((b) => b.w))), h: round(median(boxes.map((b) => b.h))) };
}

// 1 − the coefficient of variation of coverage, clamped to 0–1.
function coverageStability(values) {
  const list = values.filter(finite);
  if (list.length < 2) return 1;
  const mean = list.reduce((sum, value) => sum + value, 0) / list.length;
  if (mean <= 0) return 0;
  const variance = list.reduce((sum, value) => sum + (value - mean) ** 2, 0) / list.length;
  return Math.min(1, Math.max(0, 1 - Math.sqrt(variance) / mean));
}

function median(values) {
  const list = values.filter(finite).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = list.length >> 1;
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

// Most frequent value; ties go to the earlier entry of `order`.
function modeOf(values, order) {
  let best = order[0];
  let bestCount = -1;
  for (const value of order) {
    const count = values.filter((entry) => entry === value).length;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function summaryErrors(object, prefix, errors) {
  if (!PEOPLE.includes(object.people)) errors.push(`${prefix}people must be one of ${PEOPLE.join(", ")}`);
  if (object.framing !== null && !FRAMINGS.includes(object.framing)) errors.push(`${prefix}framing must be null or one of ${FRAMINGS.join(", ")}`);
  if (typeof object.usable !== "boolean") errors.push(`${prefix}usable must be true or false`);
  if (!Array.isArray(object.reasons) || !object.reasons.every(nonEmpty)) errors.push(`${prefix}reasons must be a list of strings`);
  else if (object.usable === true && object.reasons.length) errors.push(`${prefix}reasons must be empty when usable`);
  else if (object.usable === false && !object.reasons.length) errors.push(`${prefix}reasons must say why the subject is not usable`);
  for (const key of ["head", "body"]) if (object[key] !== null) boxErrors(object[key], `${prefix}${key}`, errors);
  for (const key of ["coverage", "stability"]) if (!fraction(object[key])) errors.push(`${prefix}${key} must be between 0 and 1`);
  if (object.headroom !== null && !fraction(object.headroom)) errors.push(`${prefix}headroom must be null or between 0 and 1`);
}

function sampleErrors(sample, at, errors) {
  if (!isObject(sample)) {
    errors.push(`${at} must be an object`);
    return;
  }
  if (!finite(sample.t) || sample.t < 0) errors.push(`${at}.t must be source seconds`);
  if (!fraction(sample.coverage)) errors.push(`${at}.coverage must be between 0 and 1`);
  if (!PEOPLE.includes(sample.people)) errors.push(`${at}.people must be one of ${PEOPLE.join(", ")}`);
  for (const key of ["head", "body"]) if (sample[key] !== null) boxErrors(sample[key], `${at}.${key}`, errors);
}

function sourceErrors(source, at, errors) {
  if (!isObject(source)) {
    errors.push(`${at} must be {sha256, width, height, fps, duration}`);
    return;
  }
  if (!/^[0-9a-f]{64}$/.test(String(source.sha256 ?? ""))) errors.push(`${at}.sha256 must be a sha256 hex digest`);
  for (const key of ["width", "height", "fps", "duration"]) if (!finite(source[key]) || source[key] <= 0) errors.push(`${at}.${key} must be a positive number`);
}

function boxErrors(value, at, errors) {
  if (!isObject(value) || !["x", "y", "w", "h"].every((key) => fraction(value[key]))) errors.push(`${at} must be null or {x, y, w, h} fractions`);
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const fraction = (value) => finite(value) && value >= 0 && value <= 1;
const round = (value) => Math.round(value * 1e4) / 1e4;
const percent = (value) => `${Math.round(value * 100)}%`;
