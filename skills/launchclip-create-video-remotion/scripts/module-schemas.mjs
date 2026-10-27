// Module param schemas: one JSON Schema (draft 2020-12) per registered
// module, for editors that generate settings panels and for validateStory.
// Plain ESM; imports only sibling kit/core files. Contract:
// docs/KIT_CONTRACTS.md, "Module param schemas".
//
// Where a schema comes from, first match wins:
//   1. definition.schema: a module may declare its full params schema.
//   2. Otherwise it is compiled from the module's params summary (catalogue
//      MODULES[id].params, editorial EDITORIAL_SPECS[id].params plus the
//      editorial common params). Each param is either a summary object
//      ({type, max, min, enum, default, required, optional, description}) or
//      a summary string ("string ≤ 48 (optional)", "[{label, at}] 2–6",
//      "primary | accent | paper | #rrggbb"). Shared params (rect, at, *At,
//      variant, format, colours) get one canonical schema each.
//
// The compiler only emits a constraint it reads with certainty: a summary it
// cannot parse becomes an unconstrained property that still carries its
// description and editor hints, so a schema never rejects params the module
// itself accepts. Editor hints are `x-launchclip-*` keywords, which JSON
// Schema validators ignore.
//
// Canonical copy: kit/core/module-schemas.mjs.

import { EDITORIAL_VARIANTS } from './editorial-core.mjs';
import { catalogModules, isEditorialKind, knownModules, moduleVariants } from './modules.mjs';
import { EDITORIAL_SPECS, TUNING_PARAMS } from './planning-prompt.mjs';
import { CAST_MODULES } from './story.mjs';

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
/** `$id` of a module's schema. */
export const moduleSchemaId = (id) => `urn:launchclip:module:${id}`;

/** Values of `x-launchclip-editor`: the control an editor draws for a param. */
export const EDITOR_CONTROLS = Object.freeze(['text', 'number', 'seconds', 'toggle', 'select', 'color', 'media', 'icon', 'date', 'rect', 'list', 'group', 'json']);
/** Values of `x-launchclip-group`, in panel order. */
export const EDITOR_GROUPS = Object.freeze(['content', 'data', 'timing', 'layout', 'style']);

const HEX_PATTERN = '^#[0-9a-fA-F]{6}$';
const ANCHOR_PATTERN = '^(?:-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)|word:[^#\\s]+?(?:#\\d+)?(?:[+-]\\d+(?:\\.\\d+)?)?|(?:beat|downbeat):\\d+(?:[+-]\\d+(?:\\.\\d+)?)?)$';

// Editorial kinds share these params (planning-prompt EDITORIAL_COMMON and EDITORIAL_TUNING).
const EDITORIAL_COMMON = Object.freeze({
  title: { type: 'string', minLength: 1, maxLength: 54, description: 'the panel title' },
  density: { type: 'string', enum: ['fill'], description: 'fill: grow the panel to fill its rect (needs a rect)' },
  accent: { type: 'string', pattern: HEX_PATTERN, description: 'accent colour #rrggbb (default: brand.colors.primary)' },
  theme: { type: 'object', description: '{surface, foreground, muted, border, accentText} #rrggbb colours (default: from the brand)' },
  presentation: { type: 'string', enum: ['solid', 'glass'], description: 'the panel surface' },
  motion: { type: 'object', description: 'entrance and exit motion overrides' }
});

const RECT = Object.freeze({
  type: 'object',
  description: '{x, y, width, height} in canvas px inside the safe zone',
  properties: {
    x: { type: 'number', title: 'X' },
    y: { type: 'number', title: 'Y' },
    width: { type: 'number', exclusiveMinimum: 0, title: 'Width' },
    height: { type: 'number', exclusiveMinimum: 0, title: 'Height' }
  },
  required: ['x', 'y', 'width', 'height']
});

const NUMBER_FORMAT = Object.freeze({
  type: 'object',
  description: 'how numbers are written',
  properties: {
    style: { type: 'string', enum: ['number', 'currency', 'percent', 'unit'], default: 'number' },
    currency: { type: 'string', description: 'ISO code, e.g. "USD"' },
    unit: { type: 'string', description: 'e.g. "km", "ms", "users"' },
    decimals: { type: 'integer', minimum: 0, maximum: 3 },
    compact: { type: 'boolean', description: '12.4K, 3.1M' },
    separator: { type: 'boolean', default: true, description: 'thousands commas' },
    prefix: { type: 'string' },
    suffix: { type: 'string' }
  }
});

// ---------------------------------------------------------------------------
// Summary text → schema

// Split on `sep` outside (), [], {} and "".
function splitTop(text, sep) {
  const parts = [];
  let depth = 0, quote = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quote = !quote;
    if (quote) continue;
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(sep, i)) { parts.push(text.slice(start, i)); start = i + sep.length; i += sep.length - 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

// Index of the bracket closing the one at `open`, or -1.
function closing(text, open) {
  let depth = 0, quote = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quote = !quote;
    if (quote) continue;
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch) && --depth === 0) return i;
  }
  return -1;
}

const NUM = '-?\\d+(?:\\.\\d+)?';
const RANGE = new RegExp(`^(${NUM})\\s*(?:–|\\.\\.)\\s*(${NUM})\\b`);
const LITERAL = /^[a-z][a-z0-9-]*$/;

/** "(default X)" or "default X" in a summary → a JSON value, or undefined. */
function readDefault(text, schema) {
  const match = /\(default:? ([^;),]+)[;),]|; default:? ([^;),]+)/.exec(text) ?? /\(default:? ([^)]+)\)/.exec(text);
  if (!match) return undefined;
  const raw = (match[1] ?? match[2]).trim().replace(/,$/, '');
  if (/^-?\d+(?:\.\d+)?$/.test(raw.replace(/,/g, '')) && (schema.type === 'number' || schema.type === 'integer')) return Number(raw.replace(/,/g, ''));
  if ((raw === 'true' || raw === 'false') && schema.type === 'boolean') return raw === 'true';
  const quoted = /^"([^"]*)"$/.exec(raw);
  if (quoted && schema.type === 'string') return quoted[1];
  if (LITERAL.test(raw) && enumOf(schema)?.includes(raw)) return raw;
  return undefined;
}

// The string enum a schema allows ({enum} or anyOf with one), or null.
function enumOf(schema) {
  if (Array.isArray(schema.enum)) return schema.enum;
  const branch = (schema.anyOf ?? []).find((entry) => Array.isArray(entry.enum));
  return branch ? branch.enum : null;
}

// One alternative of a type expression → schema, or null when unknown.
function parseAlt(raw, ctx) {
  let text = raw.trim();
  let isDefault = false;
  // A trailing note: "accent (default)", "\"vertical\" (portrait default)".
  const note = /\s*\(([^()]*)\)$/.exec(text);
  if (note && !text.startsWith('(')) { isDefault = /\bdefault\b/.test(note[1]); text = text.slice(0, note.index).trim(); }
  const out = (schema) => (isDefault ? { schema, defaultLiteral: true } : { schema });
  let m;
  if ((m = /^string(?:\s*≤\s*(\d+))?$/.exec(text))) return out({ type: 'string', ...(m[1] ? { maxLength: Number(m[1]) } : {}) });
  if ((m = new RegExp(`^(integer|number|seconds|degrees)(?:\\s+(${NUM})\\s*(?:–|\\.\\.)\\s*(${NUM}))?$`).exec(text))) {
    const schema = m[1] === 'integer' ? { type: 'integer' } : m[1] === 'seconds' && ctx.anchors ? { anyOf: [{ type: 'number' }, { type: 'string', pattern: ANCHOR_PATTERN }] } : { type: 'number' };
    if (m[2] !== undefined && !schema.anyOf) Object.assign(schema, { minimum: Number(m[2]), maximum: Number(m[3]) });
    if (m[1] === 'seconds') schema['x-launchclip-unit'] = 's';
    if (m[1] === 'degrees') schema['x-launchclip-unit'] = 'deg';
    return out(schema);
  }
  if (text === 'boolean' || text === 'bool') return out({ type: 'boolean' });
  if (text === 'true' || text === 'false') return out({ const: text === 'true' });
  if (text === '#rrggbb' || text === 'hex') return out({ type: 'string', pattern: HEX_PATTERN });
  if (text === '"YYYY-MM-DD"') return out({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', 'x-launchclip-editor': 'date' });
  // A quoted placeholder ("assets/…", "@handle") is an example of a string, not a literal.
  if ((m = /^"([^"]*)"$/.exec(text))) return out(/assets\/|…|<|[()]/.test(m[1]) ? { type: 'string', ...(/assets\//.test(m[1]) ? { 'x-launchclip-editor': 'media' } : {}) } : { const: m[1] });
  if (LITERAL.test(text) && !['string', 'number', 'integer', 'object', 'array', 'seconds'].includes(text)) return out({ const: text, literal: true });
  if (text.startsWith('[') && closing(text, 0) > 0) {
    const end = closing(text, 0);
    const inner = text.slice(1, end).trim();
    const rest = text.slice(end + 1).trim();
    const items = inner.startsWith('{') ? parseObject(inner, ctx) : parseExpression(inner, ctx);
    const schema = { type: 'array', ...(items && Object.keys(items).length ? { items } : {}) };
    if ((m = RANGE.exec(rest))) Object.assign(schema, { minItems: Number(m[1]), maxItems: Number(m[2]) });
    else if ((m = /^(?:up to|≤)\s*(\d+)\b/.exec(rest))) schema.maxItems = Number(m[1]);
    else if (rest) return null;
    return out(schema);
  }
  // "{…}" or "{…} what it is": an object either way.
  if (text.startsWith('{') && closing(text, 0) > 0) return out(parseObject(text.slice(0, closing(text, 0) + 1), ctx));
  return null;
}

// A type expression ("a | b | c") → schema, or null when any part is unknown.
function parseExpression(text, ctx) {
  const alts = splitTop(text, '|').map((part) => part.trim()).filter(Boolean);
  if (!alts.length) return null;
  const parsed = alts.map((alt) => parseAlt(alt, ctx));
  if (parsed.some((entry) => entry === null)) return null;
  // A word beside a list or object ("[id | {id, at?}]", "[\"login\" | {login}]") names a string, it is not a literal.
  const structured = parsed.some(({ schema }) => schema.type === 'object' || schema.type === 'array');
  if (structured) for (const entry of parsed) if (typeof entry.schema.const === 'string') entry.schema = { type: 'string' };
  // A lone quoted value is an example ("owner/name"), not the only allowed value.
  if (parsed.length === 1 && typeof parsed[0].schema.const === 'string' && !parsed[0].schema.literal) return { type: 'string' };
  const literals = [], others = [];
  let defaultLiteral;
  for (const { schema, defaultLiteral: isDefault } of parsed) {
    if (typeof schema.const === 'string') { literals.push(schema.const); if (isDefault) defaultLiteral = schema.const; }
    else others.push(schema);
  }
  // A lone bare word is prose ("fill colour"), not an enum.
  if (literals.length === 1 && !others.length && parsed[0].schema.literal) return null;
  const branches = [...(literals.length ? [{ type: 'string', enum: literals }] : []), ...others];
  const schema = branches.length === 1 ? branches[0] : { anyOf: branches };
  if (defaultLiteral !== undefined) schema.default = defaultLiteral;
  return schema;
}

// "{a, b?: type, c ≤ 24}" → object schema. Fields are typed only where the
// summary types them; nested fields are never marked required.
function parseObject(text, ctx) {
  const inner = text.trim().replace(/^\{/, '').replace(/\}$/, '');
  const properties = {};
  for (const field of splitTop(inner, ',')) {
    const m = /^\s*(?:…)?([A-Za-z_][A-Za-z0-9_]*)\??(.*)$/s.exec(field);
    if (!m) continue;
    const name = m[1];
    const rest = m[2].trim();
    if (rest.startsWith(':')) {
      const type = rest.slice(1).trim();
      const head = splitTop(type, ' (')[0].trim();
      properties[name] = parseExpression(head, ctx) ?? {};
      if (head !== type) properties[name].description = type;
    } else {
      // "label ≤ 24", "tone? (good | bad | #rrggbb)": a short string, or the type in parentheses when it parses.
      const len = /^≤\s*(\d+)(?=$|\s)/.exec(rest);
      const typed = /^\((.*)\)$/s.exec(rest);
      properties[name] = len ? { type: 'string', maxLength: Number(len[1]) } : (typed && parseExpression(typed[1], ctx)) || {};
    }
  }
  return { type: 'object', ...(Object.keys(properties).length ? { properties } : {}) };
}

// The type expression at the head of a summary string → schema, or null.
// Prose and notes follow the expression after a top-level ";" or " — ";
// alternatives may be joined by "|", " or " or ", " ("\"a\" (default), \"b\" or
// \"c\""); failing that the head is cut at the first ", " or " (".
function parseHead(text, ctx) {
  let head = splitTop(text, ';')[0];
  head = splitTop(head, ' — ')[0].trim();
  const joined = splitTop(head, ' or ').join(' | ');
  const pieces = splitTop(joined, ', ').map((piece) => piece.trim());
  const candidates = [joined];
  if (pieces.length > 1 && pieces.every((piece) => /^"[^"]*"(\s*\([^()]*\))?(\s*\|.*)?$/.test(piece))) candidates.unshift(pieces.join(' | '));
  candidates.push(splitTop(joined, ', ')[0], splitTop(splitTop(joined, ', ')[0], ' (')[0]);
  for (const candidate of candidates) {
    const schema = parseExpression(candidate.trim(), ctx);
    if (schema) return schema;
  }
  return null;
}

// "name: type", "box colour: type": the part after a leading label.
function afterLabel(text) {
  const m = /^[a-z][a-z ,'-]{0,40}?:\s+(.+)$/i.exec(text);
  return m && !/^(string|number|integer|seconds|boolean)\b/.test(text) ? m[1] : null;
}

// A colour param: brand roles and/or #rrggbb, anywhere in the summary.
function colorSchema(text) {
  const run = /((?:[a-z]+(?: \(default\))?\s*\|\s*)*#rrggbb(?:\s*\|\s*[a-z]+(?: \(default\))?)*)/.exec(text);
  if (!run) return null;
  const roles = [];
  let fallback;
  for (const part of run[1].split('|').map((entry) => entry.trim())) {
    if (part === '#rrggbb') continue;
    const name = part.replace(/\s*\(default\)$/, '');
    roles.push(name);
    if (part !== name) fallback = name;
  }
  const schema = roles.length ? { anyOf: [{ type: 'string', enum: roles }, { type: 'string', pattern: HEX_PATTERN }] } : { type: 'string', pattern: HEX_PATTERN };
  if (fallback) schema.default = fallback;
  return schema;
}

/** A summary string → {schema, required}. */
export function paramSchemaFromText(name, text, ctx = {}) {
  const trimmed = String(text).trim();
  const required = /(^|[,;(]\s*)required\b(?!\s+(for|when|with|if|in|on))/.test(trimmed);
  let schema = null;
  // Shared params, by name and wording.
  if (name === 'rect' || /^\{x, y, width, height\}/.test(trimmed)) schema = structuredClone(RECT);
  else if (/\{style\?: "number" \| "currency"/.test(trimmed) && (name === 'format' || /^\{style\?/.test(trimmed))) schema = structuredClone(NUMBER_FORMAT);
  else if (name === 'variant' && /VARIANTS/.test(trimmed)) schema = { type: 'string' };
  else if (/seconds from (the )?scene start/.test(trimmed) && !/^\[|^\{/.test(trimmed)) schema = parseAlt('seconds', ctx).schema;
  if (!schema) {
    schema = parseHead(trimmed, ctx);
    if (!schema) {
      const labelled = afterLabel(trimmed);
      if (labelled) schema = parseHead(labelled, ctx);
    }
    // "≤ 32 (optional)", "kicker ≤ 24", "window title ≤ 32 (…)": a short string named in prose.
    const short = /^(?:[a-z][a-z' ]*\s)?≤\s*(\d+)(?:\s+chars)?(?=$|[ ,;(])/.exec(trimmed);
    if (!schema && short) schema = { type: 'string', maxLength: Number(short[1]) };
    // "scale 0.5–1.5", "full turns before landing 1–5 (default 2)": a number named in prose.
    const ranged = new RegExp(`^[a-z][a-z ]*\\s(${NUM})\\s*–\\s*(${NUM})(?=$|\\s\\(|;|,)`).exec(trimmed);
    if (!schema && ranged) schema = { type: 'number', minimum: Number(ranged[1]), maximum: Number(ranged[2]) };
    // "seconds between pops (default 0.14)", "seconds the line takes (0.8–3)", "integer, the output tokens…".
    if (!schema) {
      const lead = /^(seconds|degrees|integer|number|boolean)\b(?!\s*\|)/.exec(trimmed);
      if (lead) {
        schema = parseAlt(lead[1], ctx).schema;
        const range = new RegExp(`\\((${NUM})\\s*–\\s*(${NUM})[,)]`).exec(trimmed);
        if (range && !schema.anyOf && schema.type !== 'boolean') Object.assign(schema, { minimum: Number(range[1]), maximum: Number(range[2]) });
      }
    }
    // "fill (primary | accent | paper | #rrggbb; default primary)": a colour in prose.
    if (!schema && !/^[[{]/.test(trimmed)) schema = colorSchema(trimmed);
  }
  schema = schema ?? {};
  // Upper-case-free numeric ranges like "0..max" stay prose.
  const def = readDefault(trimmed, schema);
  if (def !== undefined && schema.default === undefined) schema.default = def;
  schema.description = trimmed;
  return { schema, required };
}

/** A summary object ({type, max, min, enum, default, required, optional, description}) → {schema, required}. */
export function paramSchemaFromSummary(name, summary, ctx = {}) {
  if (typeof summary === 'string') return paramSchemaFromText(name, summary, ctx);
  const { type, max, min, required, optional: _optional, description, default: fallback, enum: values } = summary ?? {};
  let schema;
  if (name === 'rect' && type === 'object') schema = structuredClone(RECT);
  else if (type === 'string' || type === 'number' || type === 'integer' || type === 'boolean' || type === 'object') schema = { type };
  else if (type === 'seconds') schema = parseAlt('seconds', ctx).schema;
  else if (typeof type === 'string') schema = parseExpression(type, ctx) ?? {};
  else schema = {};
  if (Array.isArray(values)) { schema.type = 'string'; schema.enum = [...values]; }
  if (max !== undefined) {
    if (schema.type === 'string') schema.maxLength = max;
    else if (schema.type === 'array') schema.maxItems = max;
    else if (schema.type === 'number' || schema.type === 'integer' || schema['x-launchclip-unit'] === 's') schema.maximum = max;
    // "string | [{text, at?}]" with max 3: the limit counts the list's items.
    else if (schema.anyOf) {
      const list = schema.anyOf.find((branch) => branch.type === 'array');
      if (list) list.maxItems = max;
      else for (const branch of schema.anyOf) if (branch.type === 'string') branch.maxLength = max;
    }
  }
  if (min !== undefined && (schema.type === 'number' || schema.type === 'integer' || schema['x-launchclip-unit'] === 's')) schema.minimum = min;
  if (fallback !== undefined) {
    const ok = (Array.isArray(schema.enum) ? schema.enum.includes(fallback) : true) && (schema.type === undefined || typeof fallback === (schema.type === 'integer' ? 'number' : schema.type) || schema['x-launchclip-unit'] === 's');
    if (ok) schema.default = fallback;
    else schema.description = [description, `default: ${fallback}`].filter(Boolean).join('; ');
  }
  if (schema.description === undefined) schema.description = description ?? [typeof type === 'string' ? type : null, required === true ? 'required' : null].filter(Boolean).join(', ');
  return { schema, required: required === true };
}

// ---------------------------------------------------------------------------
// Editor hints

const TIMING = /^(at|.*At|stagger|span|duration|.*Duration|release|draw|stream|hold|speed|delay)$/;
const LAYOUT = /^(rect|align|layout|columns|rows?Gap|scale|tilt|orbit|side|position|placement|anchor|size|width|height|direction|drift|camera|move|zoom|density)$/;
const STYLE = /^(tone|color|colour|variant|surface|theme|accent|look|presentation|palette|treatment|motion|style|glow|font)$/;
const MEDIA = /^(src|image|media|video|logo|avatar|badge|photo|screenshot)$/;

function editorControl(name, schema) {
  if (schema['x-launchclip-editor']) return schema['x-launchclip-editor'];
  if (name === 'rect') return 'rect';
  if (name === 'icon') return 'icon';
  const branches = schema.anyOf ?? [schema];
  if (branches.some((branch) => branch.pattern === HEX_PATTERN)) return 'color';
  if (schema.type === 'array') return 'list';
  if (MEDIA.test(name) || (schema.type !== 'object' && /^"?assets\//.test(schema.description ?? ''))) return 'media';
  if (schema['x-launchclip-unit'] === 's') return 'seconds';
  if (schema.type === 'object') return 'group';
  if (schema.type === 'boolean') return 'toggle';
  if (Array.isArray(schema.enum)) return 'select';
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'string') return 'text';
  return 'json';
}

function editorGroup(name, schema) {
  if (name === 'source' || name === 'mode' || name === 'format') return 'data';
  if (TIMING.test(name) || schema['x-launchclip-unit'] === 's') return 'timing';
  if (LAYOUT.test(name)) return 'layout';
  if (STYLE.test(name) || (schema.anyOf ?? []).some((branch) => branch.pattern === HEX_PATTERN)) return 'style';
  return 'content';
}

const titleOf = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());

function decorate(name, schema, order) {
  const out = { title: titleOf(name), ...schema };
  out['x-launchclip-editor'] = editorControl(name, schema);
  out['x-launchclip-group'] = editorGroup(name, schema);
  if (TUNING_PARAMS.includes(name) || name === 'variant' || name === 'density') out['x-launchclip-advanced'] = true;
  out['x-launchclip-order'] = order;
  return out;
}

// ---------------------------------------------------------------------------
// Module schemas

function variantSchema(variants) {
  return { type: 'string', enum: [...variants], default: variants[0], description: 'the module\'s designed look (default: the style\'s variants[module], else the first); usually leave it to the style' };
}

function buildSchema(id) {
  const editorial = isEditorialKind(id);
  const definition = editorial ? null : catalogModules()[id];
  if (!editorial && !definition) return null;
  const variants = moduleVariants()[id] ?? (editorial ? EDITORIAL_VARIANTS[id] : null) ?? null;
  const spec = editorial ? EDITORIAL_SPECS[id] ?? { describe: id, params: {} } : definition;
  const header = {
    $schema: JSON_SCHEMA_DIALECT,
    $id: moduleSchemaId(id),
    title: id,
    description: spec.describe ?? id,
    'x-launchclip-module': { id, kind: editorial ? 'editorial' : 'catalogue', ...(variants ? { variants: [...variants] } : {}), ...(Array.isArray(spec.events) ? { events: [...spec.events] } : {}) },
    'x-launchclip-groups': [...EDITOR_GROUPS]
  };
  // A module that declares its own schema keeps it; the header fills gaps.
  if (definition?.schema) return { ...header, ...structuredClone(definition.schema) };
  const ctx = { anchors: CAST_MODULES.includes(id) };
  const properties = {};
  const required = [];
  let order = 0;
  const add = (name, schema, isRequired) => {
    properties[name] = decorate(name, schema, order++);
    if (isRequired) required.push(name);
  };
  if (editorial) add('title', EDITORIAL_COMMON.title, true);
  for (const [name, summary] of Object.entries(spec.params ?? {})) {
    const { schema, required: isRequired } = paramSchemaFromSummary(name, summary, ctx);
    if (name === 'variant' && variants) {
      const own = variantSchema(variants);
      add(name, { ...own, ...(schema.default !== undefined && own.enum.includes(schema.default) ? { default: schema.default } : {}), description: schema.description ?? own.description }, false);
      continue;
    }
    add(name, schema, isRequired);
  }
  if (variants && !properties.variant) add('variant', variantSchema(variants), false);
  if (editorial) for (const [name, schema] of Object.entries(EDITORIAL_COMMON)) if (!properties[name]) add(name, schema, false);
  if (!properties.rect) add('rect', structuredClone(RECT), false);
  return {
    ...header,
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    // Modules read a few cross-cutting params (theme, accent, track…) that the
    // summaries leave out, so unknown keys are allowed, not errors.
    additionalProperties: true
  };
}

let CACHE = null;
function schemas() {
  if (!CACHE) {
    CACHE = new Map();
    for (const id of knownModules()) CACHE.set(id, deepFreeze(buildSchema(id)));
  }
  return CACHE;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const entry of Object.values(value)) deepFreeze(entry); Object.freeze(value); }
  return value;
}

/** The params JSON Schema of a module id (frozen), or null for an unknown id. */
export function moduleSchema(id) {
  return schemas().get(id) ?? null;
}

/** Every registered module's params schema: [{id, schema}] in registry order. */
export function listModuleSchemas() {
  return [...schemas()].map(([id, schema]) => ({ id, schema }));
}

// ---------------------------------------------------------------------------
// Validation (the keywords the schemas above use)

const typeOk = (type, value) => {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'null': return value === null;
    default: return true;
  }
};

const describeType = (value) => (value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value === 'object' ? 'an object' : `a ${typeof value}`);
const show = (value) => JSON.stringify(value);

/**
 * Validate a value against a JSON Schema (the subset module schemas use:
 * type, enum, const, minimum, maximum, exclusiveMinimum, exclusiveMaximum,
 * minLength, maxLength, pattern, items, minItems, maxItems, properties,
 * required, additionalProperties, anyOf, oneOf). Returns
 * [{path, message}], path a JSON Pointer under `base`.
 */
export function validateAgainstSchema(schema, value, base = '') {
  const errors = [];
  walk(schema, value, base, errors);
  return errors;
}

function walk(schema, value, path, errors) {
  if (!schema || typeof schema !== 'object' || schema === true) return;
  const fail = (message) => errors.push({ path, message });
  if (schema.anyOf || schema.oneOf) {
    const branches = schema.anyOf ?? schema.oneOf;
    const results = branches.map((branch) => validateAgainstSchema(branch, value, path));
    const passing = results.filter((result) => !result.length).length;
    if (schema.oneOf ? passing !== 1 : passing === 0) {
      // One branch of the right type: report its errors, they are the precise ones.
      const typed = branches.map((branch, i) => ({ branch, result: results[i] })).filter(({ branch }) => branch.type && typeOk(branch.type, value));
      if (typed.length === 1) errors.push(...typed[0].result);
      else fail(`must be ${branches.map(branchLabel).join(' or ')}`);
      return;
    }
  }
  if (schema.const !== undefined && value !== schema.const) return fail(`must be ${show(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return fail(`must be one of ${schema.enum.map(show).join(', ')}`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeOk(type, value))) return fail(`must be ${types.map((type) => (type === 'integer' ? 'an integer' : type === 'array' || type === 'object' ? `an ${type}` : `a ${type}`)).join(' or ')}, not ${describeType(value)}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be at most ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail(`must be greater than ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) fail(`must be less than ${schema.exclusiveMaximum}`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) fail(schema.minLength === 1 ? 'must not be empty' : `must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && length > schema.maxLength) fail(`must be at most ${schema.maxLength} characters (it has ${length})`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) fail(schema.pattern === HEX_PATTERN ? 'must be a six-digit hex colour like #1a2b3c' : `must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`must have at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`must have at most ${schema.maxItems} item${schema.maxItems === 1 ? '' : 's'}`);
    if (schema.items && typeof schema.items === 'object') value.forEach((item, i) => walk(schema.items, item, `${path}/${i}`, errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const name of schema.required ?? []) if (value[name] === undefined) errors.push({ path: `${path}/${escapePointer(name)}`, message: 'is required' });
    for (const [name, entry] of Object.entries(value)) {
      const sub = schema.properties?.[name];
      if (sub) walk(sub, entry, `${path}/${escapePointer(name)}`, errors);
      else if (schema.additionalProperties === false) errors.push({ path: `${path}/${escapePointer(name)}`, message: 'is not a known field' });
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') walk(schema.additionalProperties, entry, `${path}/${escapePointer(name)}`, errors);
    }
  }
}

function branchLabel(branch) {
  if (branch.const !== undefined) return show(branch.const);
  if (Array.isArray(branch.enum)) return `one of ${branch.enum.map(show).join(', ')}`;
  if (branch.pattern === HEX_PATTERN) return 'a #rrggbb colour';
  if (branch.type) return branch.type === 'integer' ? 'an integer' : branch.type === 'array' || branch.type === 'object' ? `an ${branch.type}` : `a ${branch.type}`;
  return 'a matching value';
}

/** RFC 6901 escaping of one reference token. */
export function escapePointer(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Validate one scene's params against its module's schema:
 * [{path, message}] with path a JSON Pointer from the params object ("" is
 * the object itself, "/title" a field). [] for an unknown module.
 */
export function validateModuleParams(id, params) {
  const schema = moduleSchema(id);
  if (!schema) return [];
  return validateAgainstSchema(schema, params ?? {}, '');
}
