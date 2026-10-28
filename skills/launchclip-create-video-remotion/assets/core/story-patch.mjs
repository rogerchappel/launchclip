// Story patches: the contract for editing a story by chatting. An edit
// arrives as an RFC 6902 JSON Patch against story.json instead of a whole new
// storyboard; applyStoryPatch applies it atomically, then validates, resolves
// and layout-checks the result, and reports every problem with the JSON
// Pointer it concerns; diffSegments says which render segments the edit
// invalidates. Plain ESM; imports only sibling kit/core files.
// Contract: docs/KIT_CONTRACTS.md, "Story patches".
//
// Canonical copy: kit/core/story-patch.mjs.

import { captionZones } from './footage-layout.mjs';
import { checkLayout, elementsFromEditorialLayout, elementsFromStory } from './layout-check.mjs';
import { validateModuleParams } from './module-schemas.mjs';
import { knownModules, resolveModule } from './modules.mjs';
import { hashSegments, planSegments, sceneModels } from './render-segments.mjs';
import { migrateStory } from './story-migrations.mjs';
import { resolveStory, validateStory } from './story.mjs';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const OPS = ['add', 'remove', 'replace', 'move', 'copy', 'test'];

// ---------------------------------------------------------------------------
// RFC 6901 pointers

/** "/scenes/0/params" → ["scenes", "0", "params"]; throws on a malformed pointer. */
export function parsePointer(pointer) {
  if (pointer === '') return [];
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error(`${JSON.stringify(pointer)} is not a JSON Pointer (it must be "" or start with "/")`);
  return pointer.slice(1).split('/').map((token) => {
    if (/~[^01]|~$/.test(token)) throw new Error(`${JSON.stringify(pointer)} has a bad escape (use ~0 for "~" and ~1 for "/")`);
    return token.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

/** ["scenes", "0"] → "/scenes/0". */
export function formatPointer(tokens) {
  return tokens.map((token) => `/${String(token).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

/**
 * A validation message's leading path ("scenes[2].params.rows[0].label must…",
 * "format.width must…") → its JSON Pointer ("/scenes/2/params/rows/0/label"),
 * or "" when the message names no path. With `doc`, a leading word that is
 * not a field of it ("story must be…", "scene inside: …") names no path,
 * unless the message says the field is missing or wrong ("lane must be…").
 */
export function messagePointer(message, doc = null) {
  const text = String(message);
  const match = /^([A-Za-z_][A-Za-z0-9_-]*(?:\[\d+\]|\.[A-Za-z_][A-Za-z0-9_-]*)*)(?=[\s:]|$)/.exec(text);
  if (!match) return '';
  const tokens = [];
  for (const part of match[1].matchAll(/([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+)\]/g)) tokens.push(part[1] ?? part[2]);
  if (isObject(doc) && !Object.hasOwn(doc, tokens[0]) && (tokens[0] === 'story' || !new RegExp(`^${tokens[0]} (must|is required)\\b`).test(text))) return '';
  return formatPointer(tokens);
}

const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

// The parent container and final token of a pointer, for writing.
function locate(doc, tokens, pointer) {
  let parent = doc;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    const next = Array.isArray(parent) ? (ARRAY_INDEX.test(token) ? parent[Number(token)] : undefined) : isObject(parent) && Object.hasOwn(parent, token) ? parent[token] : undefined;
    if (next === undefined || next === null || typeof next !== 'object') throw new Error(`${formatPointer(tokens.slice(0, i + 1))} does not exist (needed by ${pointer})`);
    parent = next;
  }
  return { parent, key: tokens.at(-1) };
}

function read(doc, pointer) {
  const tokens = parsePointer(pointer);
  let value = doc;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (Array.isArray(value) && ARRAY_INDEX.test(token) && Number(token) < value.length) value = value[Number(token)];
    else if (isObject(value) && Object.hasOwn(value, token)) value = value[token];
    else throw new Error(`${formatPointer(tokens.slice(0, i + 1))} does not exist`);
  }
  return value;
}

function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((entry, i) => equal(entry, b[i]));
  if (isObject(a)) return isObject(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
  return false;
}

// One operation against `doc` (changed in place); returns the new root.
function applyOp(doc, op) {
  const tokens = parsePointer(op.path);
  const write = (root, value) => {
    if (!tokens.length) return value;
    const { parent, key } = locate(root, tokens, op.path);
    if (Array.isArray(parent)) {
      if (key === '-') { parent.push(value); return root; }
      if (!ARRAY_INDEX.test(key) || Number(key) > parent.length) throw new Error(`${op.path}: index ${key} is outside the array (length ${parent.length})`);
      parent.splice(Number(key), 0, value);
    } else parent[key] = value;
    return root;
  };
  const remove = (root, path, list) => {
    if (!list.length) throw new Error('cannot remove the whole document');
    const { parent, key } = locate(root, list, path);
    if (Array.isArray(parent)) {
      if (!ARRAY_INDEX.test(key) || Number(key) >= parent.length) throw new Error(`${path} does not exist`);
      return parent.splice(Number(key), 1)[0];
    }
    if (!Object.hasOwn(parent, key)) throw new Error(`${path} does not exist`);
    const value = parent[key];
    delete parent[key];
    return value;
  };
  switch (op.op) {
    case 'add': return write(doc, clone(op.value));
    case 'remove': remove(doc, op.path, tokens); return doc;
    case 'replace': {
      if (!tokens.length) return clone(op.value);
      read(doc, op.path);
      const { parent, key } = locate(doc, tokens, op.path);
      parent[Array.isArray(parent) ? Number(key) : key] = clone(op.value);
      return doc;
    }
    case 'move': {
      const from = parsePointer(op.from);
      if (op.path !== op.from && op.path.startsWith(`${op.from}/`)) throw new Error(`cannot move ${op.from} into its own child ${op.path}`);
      if (op.path === op.from) { read(doc, op.from); return doc; }
      const value = remove(doc, op.from, from);
      return write(doc, value);
    }
    case 'copy': return write(doc, clone(read(doc, op.from)));
    case 'test': {
      const actual = read(doc, op.path);
      if (!equal(actual, op.value)) throw new Error(`test failed: ${op.path} is ${JSON.stringify(actual)}, not ${JSON.stringify(op.value)}`);
      return doc;
    }
    default: throw new Error(`unknown op ${JSON.stringify(op.op)}`);
  }
}

function opShapeError(op) {
  if (!isObject(op)) return 'each operation must be an object {op, path, …}';
  if (!OPS.includes(op.op)) return `op must be one of ${OPS.join(', ')}`;
  if (typeof op.path !== 'string') return 'path must be a JSON Pointer string';
  if (['add', 'replace', 'test'].includes(op.op) && !Object.hasOwn(op, 'value')) return `${op.op} needs a value`;
  if (['move', 'copy'].includes(op.op) && typeof op.from !== 'string') return `${op.op} needs from (a JSON Pointer)`;
  return null;
}

/**
 * Apply an RFC 6902 JSON Patch. Atomic: on any failure the input is
 * untouched and no partial result is returned. Never changes `doc`.
 * → {ok: true, doc} | {ok: false, error: {op: index, path, message}}.
 */
export function applyJsonPatch(doc, patch) {
  if (!Array.isArray(patch)) return { ok: false, error: { op: null, path: '', message: 'a patch must be an array of operations' } };
  let result = clone(doc);
  for (const [index, op] of patch.entries()) {
    const shape = opShapeError(op);
    if (shape) return { ok: false, error: { op: index, path: isObject(op) && typeof op.path === 'string' ? op.path : '', message: shape } };
    try { result = applyOp(result, op); }
    catch (error) { return { ok: false, error: { op: index, path: op.path, message: error.message } }; }
  }
  return { ok: true, doc: result };
}

// ---------------------------------------------------------------------------
// Story patches

const problem = (stage, message, extra = {}, doc = null) => ({ stage, path: extra.path ?? messagePointer(message, doc), message, ...extra });

/**
 * Apply a JSON Patch to a story, then check the result as the renderers will
 * see it. Stages, in order; a stage runs only when every stage before it
 * passed:
 *   patch    the operations (op: the failing operation's index)
 *   migrate  the story is brought to the current contract first (migrateStory)
 *   validate validateStory with the module registry and param schemas
 *   resolve  time anchors (options.words, options.beats)
 *   params   every scene resolves through its module (resolveModule)
 *   layout   the declared-geometry layout check (options.layout: false skips it)
 * → {ok, story, resolved, applied, errors: [{stage, path, message, op?}],
 *    warnings: [{stage, path, message}], layout: {errors, warnings, findings}}.
 * `story` is the patched story whenever the patch applied (even when a later
 * stage failed, so an editor can show it); null when the patch did not apply.
 * `resolved` is the resolved story once resolve passed. Paths are JSON
 * Pointers into the patched story ("" when a message names no path).
 */
export function applyStoryPatch(story, patch, { words = [], beats = null, layout = true, modules = knownModules(), moduleParams = validateModuleParams } = {}) {
  const errors = [];
  const warnings = [];
  const layoutReport = { errors: 0, warnings: 0, findings: [] };
  const done = (fields) => ({ ok: errors.length === 0, story: null, resolved: null, applied: [], errors, warnings, layout: layoutReport, ...fields });

  let migrated;
  try { migrated = migrateStory(story); }
  catch (error) { errors.push(problem('migrate', error.message, { path: '' })); return done({}); }
  const patched = applyJsonPatch(migrated.story, patch);
  if (!patched.ok) { errors.push(problem('patch', patched.error.message, { path: patched.error.path, op: patched.error.op })); return done({ applied: migrated.applied }); }
  const next = patched.doc;
  const fields = { story: next, applied: migrated.applied };

  const validation = validateStory(next, { modules, moduleParams });
  for (const message of validation.errors) errors.push(problem('validate', message, {}, next));
  for (const message of validation.warnings) warnings.push(problem('validate', message, {}, next));
  if (errors.length) return done(fields);

  let resolved;
  try { resolved = resolveStory(next, { words, beats }); }
  catch (error) { errors.push(problem('resolve', error.message, {}, next)); return done(fields); }
  fields.resolved = resolved;

  const models = new Map();
  resolved.scenes.forEach((scene, index) => {
    if (!isObject(scene) || scene.module === 'custom' || !modules.includes(scene.module)) return;
    try { models.set(scene.id, resolveModule(scene, resolved)); }
    catch (error) {
      // resolveModule prefixes "scenes[i] (id): " with the resolved order; point at the patched story's scene.
      const at = next.scenes.findIndex((entry) => entry?.id === scene.id);
      errors.push(problem('params', error.message, { path: formatPointer(['scenes', String(at < 0 ? index : at), 'params']) }));
    }
  });
  if (errors.length || !layout) return done(fields);

  try {
    const canvas = { width: resolved.format.width, height: resolved.format.height };
    const elements = elementsFromStory(resolved, {
      moduleLayout: (scene) => {
        const model = models.get(scene.id);
        if (!model?.layout?.rect) return [];
        return elementsFromEditorialLayout(model.layout, {
          id: scene.id,
          role: model.layout.role ?? (scene.module === 'media-window' ? 'media' : 'text'),
          start: Number(scene.start),
          end: Number(scene.end),
          canvas,
          ...(model.layout.minTextPx !== undefined ? { minTextPx: model.layout.minTextPx } : {}),
          hidesCaptions: model.hidesCaptions === true || model.layout.hidesCaptions === true
        });
      },
      captionZones: resolved.base ? captionZones(resolved) : []
    });
    const report = checkLayout({ canvas, elements, duration: Number(resolved.resolved?.duration) || undefined });
    layoutReport.findings = report.findings;
    for (const finding of report.findings) {
      const at = next.scenes.findIndex((entry) => finding.ids.includes(entry?.id));
      const entry = problem('layout', `${finding.rule} @${finding.at}s [${finding.ids.join(', ')}] ${finding.detail}`, { path: at < 0 ? '' : formatPointer(['scenes', String(at)]) });
      if (finding.severity === 'error') { errors.push(entry); layoutReport.errors++; }
      else { warnings.push(entry); layoutReport.warnings++; }
    }
  } catch (error) {
    errors.push(problem('layout', error.message, { path: '' }));
  }
  return done(fields);
}

// ---------------------------------------------------------------------------
// Render segments an edit invalidates

// Segment inputs from the stories alone: captions and asset contents come from
// files, which both sides of an edit share, so only what the stories say can
// differ. The kit and fonts are the same engine on both sides.
function storyOnlyInputs(story, renderer) {
  return { renderer, kit: null, fonts: null, captions: null, assets: {}, base: null, models: sceneModels(story) };
}

/**
 * Which render segments an edit invalidates. oldStory and newStory are
 * resolved stories (applyStoryPatch's `resolved`). Both are planned and
 * hashed exactly as `finish` does (render-segments.mjs); a segment of the new
 * story whose hash the old story already had is a cache hit, every other one
 * must re-render. options.renderer: "remotion" (default) or "hyperframes".
 * options.inputs: (story) => segment inputs (or a promise of them) for hashing
 * what the stories leave out, such as caption and asset files
 * (src/story_patch.js passes the project's; default: the stories alone).
 * → {segments: [{index, id, label, kind, start, end, startFrame, endFrame,
 *    frames, scenes, status: "unchanged" | "changed" | "new", parts}],
 *    invalidated: [ids], removed: [old ids no longer used], global: boolean,
 *    frames: {total, invalidated}}.
 * status "changed": a segment with the same layers existed and `parts` names
 * what changed ("global", "layers", "captions", "overlays", "assets",
 * "camera", "frames"); "new": the edit moved a cut, so no segment had these
 * layers. global: the edit touched a setting every segment depends on.
 */
export async function diffSegments(oldStory, newStory, { renderer = 'remotion', inputs = null } = {}) {
  const hashed = async (story) => {
    const plan = planSegments(story);
    return hashSegments(story, plan, inputs ? await inputs(story) : storyOnlyInputs(story, renderer));
  };
  const [before, after] = [await hashed(oldStory), await hashed(newStory)];
  const oldHashes = new Set(before.map((segment) => segment.hash));
  const newHashes = new Set(after.map((segment) => segment.hash));
  const byLabel = new Map(before.map((segment) => [segment.label, segment]));
  const segments = after.map((segment) => {
    const { hash, parts, layers: _layers, ...shown } = segment;
    if (oldHashes.has(hash)) return { ...shown, status: 'unchanged', parts: [] };
    const previous = byLabel.get(segment.label);
    if (!previous) return { ...shown, status: 'new', parts: Object.keys(parts) };
    const changed = Object.keys({ ...parts, ...previous.parts }).filter((key) => parts[key] !== previous.parts[key]);
    if (previous.startFrame !== segment.startFrame || previous.endFrame !== segment.endFrame) changed.push('frames');
    return { ...shown, status: 'changed', parts: changed };
  });
  const invalidated = segments.filter((segment) => segment.status !== 'unchanged');
  return {
    segments,
    invalidated: invalidated.map((segment) => segment.id),
    removed: before.filter((segment) => !newHashes.has(segment.hash)).map((segment) => segment.id),
    global: Boolean(before[0] && after[0] && before[0].parts.global !== after[0].parts.global),
    frames: { total: after.reduce((sum, segment) => sum + segment.frames, 0), invalidated: invalidated.reduce((sum, segment) => sum + segment.frames, 0) }
  };
}
