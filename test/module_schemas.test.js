// Module param schemas (kit/core/module-schemas.mjs): one draft 2020-12 JSON
// Schema per registered module, with editor hints, checked by validateStory.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import path from 'node:path';
import {EDITOR_CONTROLS, EDITOR_GROUPS, JSON_SCHEMA_DIALECT, listModuleSchemas, moduleSchema, moduleSchemaId, paramSchemaFromText, validateAgainstSchema, validateModuleParams} from '../kit/core/module-schemas.mjs';
import {knownModules} from '../kit/core/modules.mjs';
import {SAMPLES} from '../scripts/variant-sheet.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

// Every keyword the schemas may use: JSON Schema 2020-12 vocabulary plus x-launchclip-* hints.
const KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'default', 'anyOf', 'oneOf', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems']);
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

function checkKeywords(schema, where, problems) {
  for (const key of Object.keys(schema)) {
    if (key.startsWith('x-launchclip-')) continue;
    if (!KEYWORDS.has(key)) problems.push(`${where}: unknown keyword ${key}`);
  }
  if (schema.type !== undefined && !TYPES.has(schema.type)) problems.push(`${where}: type ${schema.type}`);
  if (schema.enum !== undefined && !(Array.isArray(schema.enum) && schema.enum.length && new Set(schema.enum).size === schema.enum.length)) problems.push(`${where}: enum must be a non-empty array of unique values`);
  if (schema.pattern !== undefined) try { new RegExp(schema.pattern, 'u'); } catch { problems.push(`${where}: pattern ${schema.pattern}`); }
  if (schema.minimum !== undefined && schema.maximum !== undefined && schema.minimum > schema.maximum) problems.push(`${where}: minimum above maximum`);
  if (schema.minItems !== undefined && schema.maxItems !== undefined && schema.minItems > schema.maxItems) problems.push(`${where}: minItems above maxItems`);
  if (schema.default !== undefined) {
    const own = {...schema};
    delete own.default;
    const errors = validateAgainstSchema(own, schema.default);
    if (errors.length) problems.push(`${where}: default ${JSON.stringify(schema.default)} ${errors[0].message}`);
  }
  for (const [name, sub] of Object.entries(schema.properties ?? {})) checkKeywords(sub, `${where}/${name}`, problems);
  if (schema.items && typeof schema.items === 'object') checkKeywords(schema.items, `${where}/items`, problems);
  for (const [i, sub] of (schema.anyOf ?? schema.oneOf ?? []).entries()) checkKeywords(sub, `${where}/anyOf/${i}`, problems);
}

test('every registered module has a draft 2020-12 params schema', () => {
  const ids = knownModules();
  const listed = listModuleSchemas();
  assert.deepEqual(listed.map((entry) => entry.id), ids);
  assert.ok(ids.length >= 130);
  for (const id of ids) {
    const schema = moduleSchema(id);
    assert.ok(schema, id);
    assert.equal(schema.$schema, JSON_SCHEMA_DIALECT, id);
    assert.equal(schema.$id, moduleSchemaId(id), id);
    assert.equal(schema.type, 'object', id);
    assert.equal(schema.title, id);
    assert.ok(schema.description && schema.description !== id, `${id} has a description`);
    assert.ok(Object.keys(schema.properties).length, `${id} has properties`);
    assert.ok(['editorial', 'catalogue'].includes(schema['x-launchclip-module'].kind), id);
    for (const name of schema.required ?? []) assert.ok(schema.properties[name], `${id}: required ${name} is a property`);
  }
  assert.equal(moduleSchema('no-such-module'), null);
});

test('schemas use only the 2020-12 keywords the validator implements, and every default is valid', () => {
  const problems = [];
  for (const {id, schema} of listModuleSchemas()) checkKeywords(schema, id, problems);
  assert.deepEqual(problems, []);
});

test('every param carries a title, a description and editor hints', () => {
  for (const {id, schema} of listModuleSchemas()) {
    const orders = [];
    for (const [name, property] of Object.entries(schema.properties)) {
      const where = `${id}.${name}`;
      assert.ok(property.title, where);
      assert.ok(property.description, where);
      assert.ok(EDITOR_CONTROLS.includes(property['x-launchclip-editor']), `${where}: ${property['x-launchclip-editor']}`);
      assert.ok(EDITOR_GROUPS.includes(property['x-launchclip-group']), where);
      orders.push(property['x-launchclip-order']);
    }
    assert.deepEqual(orders, orders.map((_, i) => i), `${id}: x-launchclip-order follows declaration order`);
  }
  // Shared params get one canonical shape.
  const rect = moduleSchema('hook-title').properties.rect;
  assert.equal(rect['x-launchclip-editor'], 'rect');
  assert.equal(rect['x-launchclip-advanced'], true);
  assert.deepEqual(rect.required, ['x', 'y', 'width', 'height']);
  assert.deepEqual(moduleSchema('checklist').properties.variant.enum, ['panel', 'flat', 'outline', 'banner']);
  assert.equal(moduleSchema('percent-fill').properties.tone['x-launchclip-editor'], 'color');
  assert.equal(moduleSchema('percent-fill').properties.span['x-launchclip-editor'], 'seconds');
  assert.equal(moduleSchema('logo-row').properties.logos['x-launchclip-editor'], 'list');
});

test('summaries compile to the constraints they state', () => {
  const schema = (text, name = 'p') => paramSchemaFromText(name, text).schema;
  assert.deepEqual({...schema('string ≤ 48 (optional)'), description: undefined}, {type: 'string', maxLength: 48, description: undefined});
  assert.equal(paramSchemaFromText('text', 'string ≤ 70, required').required, true);
  assert.equal(paramSchemaFromText('source', 'string ≤ 80 (required for data)').required, false);
  const steps = schema('[{label, at}] 2–6, strictly increasing at');
  assert.equal(steps.type, 'array');
  assert.equal(steps.minItems, 2);
  assert.equal(steps.maxItems, 6);
  assert.equal(steps.items.type, 'object');
  const tone = schema('primary | accent (default) | paper | #rrggbb');
  assert.deepEqual(tone.anyOf[0].enum, ['primary', 'accent', 'paper']);
  assert.equal(tone.default, 'accent');
  assert.deepEqual(schema('"assemble" (default), "dissolve" (starts whole) or "both"').enum, ['assemble', 'dissolve', 'both']);
  assert.equal(schema('seconds 0.4–4 (default 1.6)').default, 1.6);
  assert.equal(schema('integer 1–6 (default by count and aspect)').maximum, 6);
  // Placeholders and prose stay open: a schema never rejects what the module accepts.
  assert.equal(schema('"owner/name"').type, 'string');
  assert.equal(schema('[id | {id, at?}] ≤ 12').items.anyOf[0].type, 'string');
  assert.equal(schema('the module\'s answer, as it reads').type, undefined);
});

test('validateModuleParams reports precise JSON Pointer paths', () => {
  assert.deepEqual(validateModuleParams('percent-fill', {value: 40}), []);
  assert.deepEqual(validateModuleParams('percent-fill', {value: '40', span: 9, tone: 'blue', rect: {x: 0, y: 0, width: 0, height: 10}}), [
    {path: '/value', message: 'must be a number, not a string'},
    {path: '/span', message: 'must be at most 4'},
    {path: '/tone', message: 'must be one of "primary", "accent", "paper" or a #rrggbb colour'},
    {path: '/rect/width', message: 'must be greater than 0'}
  ]);
  assert.deepEqual(validateModuleParams('percent-fill', {}), [{path: '/value', message: 'is required'}]);
  assert.deepEqual(validateModuleParams('checklist', {title: 'Steps', variant: 'boxed'}), [{path: '/variant', message: 'must be one of "panel", "flat", "outline", "banner"'}]);
  // Unknown params pass: modules read cross-cutting params the summaries leave out.
  assert.deepEqual(validateModuleParams('percent-fill', {value: 1, theme: {}}), []);
});

// The corpus: golden stories, every other example story, the parity fixtures and the variant-sheet samples.
function storyFiles() {
  const files = [];
  const story = path.join(ROOT, 'examples', 'story');
  for (const entry of readdirSync(story, {withFileTypes: true})) {
    if (entry.isDirectory() && existsSync(path.join(story, entry.name, 'storyboard.json'))) files.push(path.join(story, entry.name, 'storyboard.json'));
    else if (entry.name.endsWith('.story.json')) files.push(path.join(story, entry.name));
  }
  const parity = path.join(ROOT, 'test', 'fixtures', 'parity');
  for (const name of readdirSync(parity)) if (name.endsWith('.json')) files.push(path.join(parity, name));
  return files;
}

test('golden stories, example stories and parity fixtures validate against the module schemas', () => {
  const problems = [];
  let scenes = 0;
  for (const file of storyFiles()) {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const story = json.story ?? json;
    if (story.schema !== 'launchclip.story.v1') continue;
    for (const [i, scene] of (story.scenes ?? []).entries()) {
      if (!scene?.module || scene.module === 'custom') continue;
      scenes++;
      for (const problem of validateModuleParams(scene.module, scene.params)) problems.push(`${path.relative(ROOT, file)} scenes[${i}] ${scene.module}${problem.path} ${problem.message}`);
    }
  }
  assert.ok(scenes > 500, `${scenes} scenes checked`);
  assert.deepEqual(problems, []);
});

test('the variant-sheet samples validate against their module schemas', () => {
  const problems = [];
  for (const [module, params] of Object.entries(SAMPLES)) for (const problem of validateModuleParams(module, params)) problems.push(`${module}${problem.path} ${problem.message}`);
  assert.deepEqual(problems, []);
});

test('module-schemas.mjs stays pure ESM: sibling kit/core imports only', () => {
  const source = readFileSync(path.join(ROOT, 'kit', 'core', 'module-schemas.mjs'), 'utf8');
  for (const [, specifier] of source.matchAll(/^import .* from '([^']+)';$/gm)) assert.match(specifier, /^\.\/[a-z0-9-]+\.mjs$/, specifier);
});
