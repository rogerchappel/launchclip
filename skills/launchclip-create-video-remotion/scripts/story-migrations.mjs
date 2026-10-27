// Story migrations: bring a saved story.json up to the contract this engine
// reads, one registered step at a time. Plain ESM; imports only sibling
// kit/core files. Contract and the change policy: docs/KIT_CONTRACTS.md,
// "Story versions and migrations".
//
// A story's version is its `schema` (the major contract,
// "launchclip.story.v1") plus its `engine.revision` (an integer, 0 when
// absent): the count of non-additive changes made inside that major. Additive
// changes (a new optional field, module, param or enum value) never bump it,
// so a story written by an older engine is already current. Only a change
// that alters what existing JSON means (a rename, a new default, a removed
// field with a replacement) adds a migration and bumps STORY_REVISION; a
// change no migration can make mechanically is a new major schema.
//
// Canonical copy: kit/core/story-migrations.mjs.

import { STORY_REVISION, STORY_SCHEMA } from './story.mjs';

export { STORY_REVISION };

/**
 * The registry, in order. Each step: {id, from: {schema, revision}, to:
 * {schema, revision}, describe, migrate(story) → story}. `migrate` gets a
 * private deep copy and may change it in place; it must be pure and must not
 * read anything but the story. Empty until a real change needs a step.
 */
export const STORY_MIGRATIONS = Object.freeze([]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const MAJOR = /^launchclip\.story\.v(\d+)$/;

/** {schema, revision} of a story; revision 0 when the story carries no engine stamp. */
export function storyVersion(story) {
  const revision = isObject(story) && isObject(story.engine) && Number.isInteger(story.engine.revision) ? story.engine.revision : 0;
  return { schema: isObject(story) ? story.schema : undefined, revision };
}

const sameVersion = (a, b) => a.schema === b.schema && a.revision === b.revision;
const label = (version) => `${version.schema}@${version.revision}`;

/**
 * Check a migration registry: every step has an id, a migrate function and a
 * forward edge (a higher revision in the same major, or revision 0 of the
 * next major), and steps chain (each starts where the previous one ended).
 * Returns a list of problems; [] when the registry is sound.
 */
export function migrationProblems(migrations = STORY_MIGRATIONS, { current = { schema: STORY_SCHEMA, revision: STORY_REVISION } } = {}) {
  const problems = [];
  const ids = new Set();
  migrations.forEach((step, i) => {
    const where = `migrations[${i}]${step?.id ? ` (${step.id})` : ''}`;
    if (!step || typeof step.id !== 'string' || !step.id) problems.push(`${where} needs an id`);
    else if (ids.has(step.id)) problems.push(`${where}: id is used twice`);
    else ids.add(step.id);
    if (typeof step?.migrate !== 'function') problems.push(`${where} needs a migrate(story) function`);
    const from = step?.from, to = step?.to;
    if (!isObject(from) || !isObject(to) || !MAJOR.test(String(from.schema)) || !MAJOR.test(String(to.schema)) || !Number.isInteger(from.revision) || !Number.isInteger(to.revision)) { problems.push(`${where} needs from and to as {schema, revision}`); return; }
    const [fromMajor, toMajor] = [Number(MAJOR.exec(from.schema)[1]), Number(MAJOR.exec(to.schema)[1])];
    const forward = fromMajor === toMajor ? to.revision === from.revision + 1 : toMajor === fromMajor + 1 && to.revision === 0;
    if (!forward) problems.push(`${where} must step forward by one: the next revision of the same schema, or revision 0 of the next major`);
    const previous = migrations[i - 1];
    if (previous?.to && previous.to.schema === from.schema && previous.to.revision !== from.revision && fromMajor === toMajor) problems.push(`${where} starts at ${label(from)} but the previous step ends at ${label(previous.to)}`);
  });
  const last = migrations.at(-1);
  if (last?.to && !sameVersion(last.to, current)) problems.push(`the last migration ends at ${label(last.to)}, not the current ${label(current)}`);
  return problems;
}

/**
 * Bring a story up to the current contract.
 * → {story, applied: [ids], from: {schema, revision}, to: {schema, revision}}.
 * The input is never changed: the result is a deep copy (the same story
 * object back only when nothing applied). A story that is already current
 * comes back with applied []. Throws when the story is newer than this
 * engine (a higher revision or major) or when no chain of steps reaches the
 * current version from the story's.
 * options.migrations / options.current: a different registry and target (tests).
 */
export function migrateStory(story, { migrations = STORY_MIGRATIONS, current = { schema: STORY_SCHEMA, revision: STORY_REVISION } } = {}) {
  if (!isObject(story)) throw new Error('story must be a JSON object');
  const from = storyVersion(story);
  if (sameVersion(from, current)) return { story, applied: [], from, to: from };
  const major = MAJOR.exec(String(from.schema));
  const currentMajor = Number(MAJOR.exec(current.schema)[1]);
  // Not a launchclip story at all: leave it to validateStory to say so.
  if (!major) return { story, applied: [], from, to: from };
  if (Number(major[1]) > currentMajor || (from.schema === current.schema && from.revision > current.revision)) {
    throw new Error(`story is ${label(from)}, newer than this engine reads (${label(current)}); upgrade launchclip to open it`);
  }
  let copy = JSON.parse(JSON.stringify(story));
  let at = from;
  const applied = [];
  while (!sameVersion(at, current)) {
    const step = migrations.find((entry) => sameVersion(entry.from, at));
    if (!step) throw new Error(`no migration from ${label(at)} toward ${label(current)}`);
    try {
      const next = step.migrate(copy);
      copy = isObject(next) ? next : copy;
    } catch (error) {
      throw new Error(`migration ${step.id} (${label(step.from)} → ${label(step.to)}) failed: ${error.message}`);
    }
    copy.schema = step.to.schema;
    copy.engine = { ...(isObject(copy.engine) ? copy.engine : {}), revision: step.to.revision };
    if (copy.engine.revision === 0 && Object.keys(copy.engine).length === 1) delete copy.engine;
    applied.push(step.id);
    at = step.to;
  }
  return { story: copy, applied, from, to: at };
}

/**
 * Stamp the engine that wrote a story: a copy with engine {version,
 * revision: STORY_REVISION} (version: the launchclip package version, which
 * callers pass in because kit/core cannot read package.json). Write a stamp
 * only on stories the engine wrote or migrated.
 */
export function stampStory(story, { version, revision = STORY_REVISION } = {}) {
  if (!isObject(story)) throw new Error('story must be a JSON object');
  return { ...story, engine: { ...(typeof version === 'string' && version ? { version } : {}), revision } };
}
