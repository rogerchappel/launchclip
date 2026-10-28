// @launchclip/core (kit/core/package.json): the storyboard engine as its own
// npm package. kit/core must stay browser-safe, so every file is bundled for
// the browser, where any Node built-in (node:fs, path, ...) fails to resolve.
// Then the package is packed and installed the way a consumer gets it, and
// imported in Node, typechecked from TypeScript, and run in a sandbox with no
// Node globals (no process, require or Buffer), as a browser would run it.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readdirSync, readFileSync} from 'node:fs';
import {cp, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {createContext, runInContext} from 'node:vm';
import {build} from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '..');
const CORE = path.join(ROOT, 'kit/core');
const run = promisify(execFile);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const story = () => JSON.parse(readFileSync(path.join(ROOT, 'examples/story/promo-16x9/storyboard.json'), 'utf8'));
const narration = JSON.parse(readFileSync(path.join(ROOT, 'examples/story/promo-16x9/NARRATION.json'), 'utf8'));
const WORDS = Array.isArray(narration) ? narration : narration.words;

function coreFiles(dir = CORE, prefix = '') {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    if (entry.isDirectory()) return ['node_modules', 'types'].includes(entry.name) ? [] : coreFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`);
    return entry.name.endsWith('.mjs') ? [`${prefix}${entry.name}`] : [];
  });
}

test('kit/core imports no Node built-ins and nothing outside itself', async () => {
  const files = coreFiles();
  assert.ok(files.length > 100, `found only ${files.length} kit/core files`);
  const result = await build({
    entryPoints: files.map((file) => path.join(CORE, file)),
    bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent', outdir: 'out'
  }).catch((error) => error);
  // A browser bundle fails on node:fs, fs, path and friends ("Could not resolve").
  assert.deepEqual((result.errors ?? []).map((error) => `${error.location?.file}: ${error.text}`), []);
  for (const [file, input] of Object.entries(result.metafile.inputs)) {
    assert.ok(path.resolve(file).startsWith(CORE + path.sep), `${file} is not in kit/core`);
    for (const {path: specifier} of input.imports) assert.doesNotMatch(specifier, /^node:/, `${file} imports ${specifier}`);
  }
});

test('the packed package installs, imports and typechecks', {timeout: 240_000}, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'launchclip-core-package-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  // Packs a copy: prepack would write types/ into kit/core, whose content is
  // the kit fingerprint other tests' render caches key on. The build is the
  // one prepack runs.
  const copy = path.join(temp, 'core');
  await cp(CORE, copy, {recursive: true, filter: (source) => !/[\\/](types|node_modules)$/.test(source)});
  await run(process.execPath, [path.join(CORE, 'scripts/build-types.js'), copy]);
  const {stdout} = await run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], {cwd: copy});
  const [packed] = JSON.parse(stdout);
  const listed = packed.files.map((file) => file.path);
  for (const file of ['package.json', 'README.md', 'LICENSE', 'index.mjs', 'types/index.d.mts', 'story.mjs', 'types/story.d.mts', 'characters/styles.mjs']) {
    assert.ok(listed.includes(file), `${file} is missing from the tarball`);
  }
  assert.equal(listed.filter((file) => /(^|\/)(test|node_modules)\//.test(file) || file.endsWith('.tgz')).length, 0);

  const consumer = path.join(temp, 'consumer');
  await run('mkdir', ['-p', consumer]);
  await writeFile(path.join(consumer, 'package.json'), `${JSON.stringify({name: 'core-consumer', private: true, type: 'module'}, null, 2)}\n`);
  await run(npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, packed.filename)], {cwd: consumer});

  await t.test('in Node', async () => {
    await writeFile(path.join(consumer, 'node.mjs'), `
import * as core from '@launchclip/core';
import { chunkWords } from '@launchclip/core/captions.mjs';
import { readFileSync } from 'node:fs';
const story = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const words = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const validation = core.validateStory(story, { modules: core.knownModules(), moduleParams: core.validateModuleParams });
const patched = core.applyStoryPatch(story, [{ op: 'replace', path: '/scenes/0/params/headline', value: 'Ship release notes in minutes, never in days.' }], { words: Array.isArray(words) ? words : words.words });
console.log(JSON.stringify({
  resolvedFrom: import.meta.resolve('@launchclip/core'),
  errors: validation.errors,
  schemas: core.listModuleSchemas().length,
  schemaId: core.moduleSchema('hook-title')?.$id ?? null,
  migrated: core.migrateStory(story).to,
  patched: patched.ok,
  chunks: chunkWords([{ text: 'one', start: 0, end: 0.2 }, { text: 'two', start: 0.2, end: 0.4 }]).length
}));
`);
    const story = path.join(ROOT, 'examples/story/promo-16x9/storyboard.json');
    const words = path.join(ROOT, 'examples/story/promo-16x9/NARRATION.json');
    const {stdout: out} = await run(process.execPath, ['node.mjs', story, words], {cwd: consumer});
    const result = JSON.parse(out);
    assert.match(result.resolvedFrom, /node_modules\/@launchclip\/core\/index\.mjs$/);
    assert.deepEqual(result.errors, []);
    assert.ok(result.schemas > 100);
    assert.match(result.schemaId, /hook-title/);
    assert.equal(result.migrated.schema, 'launchclip.story.v1');
    assert.equal(result.patched, true);
    assert.ok(result.chunks >= 1);
  });

  await t.test('from TypeScript, with the generated types', async () => {
    await writeFile(path.join(consumer, 'consumer.mts'), `
import { listModuleSchemas, validateStory, STORY_SCHEMA } from '@launchclip/core';
import { captionPlan } from '@launchclip/core/captions.mjs';
const schemas: { id: string; schema: unknown }[] = listModuleSchemas();
const schema: string = STORY_SCHEMA;
// @ts-expect-error the package has no such export
import { notExported } from '@launchclip/core';
export { schemas, schema, validateStory, captionPlan, notExported };
`);
    await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({compilerOptions: {module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, noEmit: true, types: [], lib: ['ES2022', 'DOM']}, files: ['consumer.mts']}));
    await run(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], {cwd: consumer});
  });

  await t.test('in a browser-like sandbox with no Node globals', async () => {
    const bundle = await build({
      entryPoints: [path.join(consumer, 'node_modules/@launchclip/core/index.mjs')],
      bundle: true, platform: 'browser', format: 'iife', globalName: 'LaunchClipCore', write: false, logLevel: 'silent'
    });
    // Only what browsers have; vm contexts bring the ECMAScript built-ins.
    const sandbox = createContext({console, structuredClone, URL, TextEncoder, TextDecoder, queueMicrotask, setTimeout, clearTimeout});
    runInContext(bundle.outputFiles[0].text, sandbox);
    sandbox.input = {story: story(), words: WORDS};
    const result = runInContext(`(() => {
      const core = LaunchClipCore;
      const { story, words } = input;
      const validation = core.validateStory(story, { modules: core.knownModules(), moduleParams: core.validateModuleParams });
      const patched = core.applyStoryPatch(story, [{ op: 'replace', path: '/scenes/0/params/headline', value: 'Ship release notes in minutes, never in days.' }], { words });
      const resolved = core.resolveStory(story, { words });
      return JSON.stringify({
        node: [typeof process, typeof require, typeof Buffer],
        errors: validation.errors,
        schemas: core.listModuleSchemas().length,
        patched: patched.ok,
        scenes: resolved.scenes.length,
        windows: core.sceneWindows(resolved).scenes.length
      });
    })()`, sandbox);
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed.node, ['undefined', 'undefined', 'undefined']);
    assert.deepEqual(parsed.errors, []);
    assert.ok(parsed.schemas > 100);
    assert.equal(parsed.patched, true);
    assert.equal(parsed.scenes, story().scenes.length);
    assert.equal(parsed.windows, story().scenes.length);
  });
});

test('@launchclip/core is versioned in step with launchclip and pinned exactly', () => {
  const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const core = JSON.parse(readFileSync(path.join(CORE, 'package.json'), 'utf8'));
  assert.equal(core.name, '@launchclip/core');
  assert.equal(core.version, root.version);
  assert.equal(root.dependencies['@launchclip/core'], root.version);
  assert.deepEqual(root.workspaces, ['kit/core']);
  assert.equal(core.sideEffects, false);
  assert.equal(core.type, 'module');
  assert.deepEqual(Object.keys(core.dependencies ?? {}), []);
});
