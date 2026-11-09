// Which modules both renderers draw, and which have a per-module parity
// fixture (test/module_coverage.test.js, docs/DUAL_RENDERER_PLAN.md
// "Coverage"). Nothing here renders: it reads the registries and the fixture
// files, so it runs in the fast `npm test`.
import {build} from 'esbuild';
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {knownModules} from '@launchclip/core/modules.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PARITY_FIXTURES = path.join(ROOT, 'test', 'fixtures', 'parity');
export const FOOTAGE_FIXTURES = path.join(ROOT, 'test', 'fixtures', 'parity-footage');
const REMOTION_REGISTRY = path.join(ROOT, 'kit', 'remotion', 'modules', 'index.ts');

/**
 * Modules with no per-module parity fixture, each with the reason. Keep it
 * short: a new module ships with a fixture (CONTRIBUTING.md, "Add a parity
 * fixture"), and the coverage test fails for an entry that has since gained
 * one.
 */
export const FIXTURE_ALLOWLIST = Object.freeze({
  // Sprite casts are being reworked with the character system; their fixtures belong to that work.
  'sprite-scene': 'owned by the character and sprite work'
});

/** The ids the HyperFrames compiler has an emitter for. */
export function hyperframesModuleIds() {
  return Object.keys(hyperframesEmitters());
}

/**
 * The ids the Remotion registry (kit/remotion/modules/index.ts) has a
 * component for. The registry is TSX, so it is bundled with esbuild (packages
 * left external) and imported; the bundle sits under the repo's .tmp/ so those
 * packages resolve, and is removed afterwards.
 */
export async function remotionModuleIds() {
  const result = await build({entryPoints: [REMOTION_REGISTRY], bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic', logLevel: 'silent', loader: {'.css': 'empty', '.png': 'empty', '.svg': 'empty', '.woff2': 'empty'}});
  mkdirSync(path.join(ROOT, '.tmp'), {recursive: true});
  const dir = mkdtempSync(path.join(ROOT, '.tmp', 'remotion-registry-'));
  try {
    const file = path.join(dir, 'registry.mjs');
    writeFileSync(file, result.outputFiles[0].text);
    const registry = await import(pathToFileURL(file).href);
    return Object.keys(registry.MODULE_COMPONENTS);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

const jsonFiles = dir => readdirSync(dir).filter(name => name.endsWith('.json')).sort();
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

/**
 * Per-module parity fixtures by module id: {<module>: [fixture paths relative
 * to the repo]}. A fixture counts for the module of the one scene it renders:
 * test/fixtures/parity/*.json ({story, sceneId}) and the module-mode fixtures
 * in test/fixtures/parity-footage/*.json ({project, sceneId}). Whole-story
 * fixtures cover a story, not a module, and are left out.
 */
export function fixturesByModule() {
  const out = {};
  const add = (module, file) => { if (typeof module === 'string') (out[module] ??= []).push(path.relative(ROOT, file)); };
  for (const name of jsonFiles(PARITY_FIXTURES)) {
    const file = path.join(PARITY_FIXTURES, name);
    const fixture = readJson(file);
    add(fixture.story?.scenes?.find(scene => scene.id === fixture.sceneId)?.module, file);
  }
  const stories = new Map();
  for (const name of jsonFiles(FOOTAGE_FIXTURES)) {
    const file = path.join(FOOTAGE_FIXTURES, name);
    const fixture = readJson(file);
    if (!fixture.sceneId || (fixture.mode ?? 'module') !== 'module') continue;
    const storyFile = path.join(ROOT, fixture.project, 'storyboard.json');
    if (!stories.has(storyFile)) stories.set(storyFile, readJson(storyFile));
    add(stories.get(storyFile).scenes?.find(scene => scene.id === fixture.sceneId)?.module, file);
  }
  return out;
}

/** {modules, missingHyperframes, missingRemotion, unknownHyperframes, unknownRemotion, uncovered, staleAllowlist, unknownAllowlist}. */
export async function moduleCoverage() {
  const modules = knownModules();
  const hyperframes = new Set(hyperframesModuleIds());
  const remotion = new Set(await remotionModuleIds());
  const fixtures = fixturesByModule();
  const known = new Set(modules);
  const allowed = Object.keys(FIXTURE_ALLOWLIST);
  return {
    modules,
    fixtures,
    missingHyperframes: modules.filter(id => !hyperframes.has(id)),
    missingRemotion: modules.filter(id => !remotion.has(id)),
    unknownHyperframes: [...hyperframes].filter(id => !known.has(id)),
    unknownRemotion: [...remotion].filter(id => !known.has(id)),
    uncovered: modules.filter(id => !fixtures[id]?.length && !(id in FIXTURE_ALLOWLIST)),
    staleAllowlist: allowed.filter(id => fixtures[id]?.length),
    unknownAllowlist: allowed.filter(id => !known.has(id))
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await moduleCoverage();
  const covered = report.modules.filter(id => report.fixtures[id]?.length);
  process.stdout.write(`${report.modules.length} modules, ${covered.length} with a per-module parity fixture, ${Object.keys(FIXTURE_ALLOWLIST).length} allowlisted\n`);
  for (const [label, ids] of [['no HyperFrames emitter', report.missingHyperframes], ['no Remotion component', report.missingRemotion], ['no fixture', report.uncovered], ['allowlisted but covered', report.staleAllowlist]]) {
    if (ids.length) process.stdout.write(`${label}: ${ids.join(', ')}\n`);
  }
  process.exitCode = report.missingHyperframes.length || report.missingRemotion.length || report.uncovered.length || report.staleAllowlist.length ? 1 : 0;
}
