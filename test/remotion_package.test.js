// @launchclip/remotion (kit/remotion/package.json): the Remotion kit as its own
// npm package, for apps that render stories in their own Remotion bundle or
// @remotion/player. The kit reaches the engine only through @launchclip/core,
// its package is versioned in step with launchclip, and the packed package
// installs and imports in Node and TypeScript. The media test bundles the
// installed package into a fresh Remotion app and renders a still with no
// LaunchClip CLI state (no .launchclip/, no project layout).
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readdirSync, readFileSync} from 'node:fs';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {mediaSkip} from './helpers/media.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const KIT = path.join(ROOT, 'kit/remotion');
const run = promisify(execFile);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

function kitFiles(dir = KIT, prefix = '') {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    if (entry.isDirectory()) return ['node_modules', 'dist', 'scripts'].includes(entry.name) ? [] : kitFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`);
    return /\.tsx?$/.test(entry.name) ? [`${prefix}${entry.name}`] : [];
  });
}
const importsOf = (file) => [...readFileSync(path.join(KIT, file), 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? match[2]);

test('kit/remotion imports only React, Remotion, @launchclip/core, @fontsource and itself', () => {
  const offenders = [];
  for (const file of kitFiles()) {
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.') ? /(^|\/)core\//.test(specifier) : !/^(react|react\/jsx-runtime|remotion|@launchclip\/core\/[\w./-]+\.mjs|@fontsource(-variable)?\/[\w./-]+\.woff2)$/.test(specifier)) offenders.push(`${file}: ${specifier}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no kit module needs WebGL, and the gate would say so if one did', () => {
  const webgl = kitFiles().filter((file) => importsOf(file).some((specifier) => /^(three|@remotion\/three|@react-three\/)/.test(specifier)));
  const source = readFileSync(path.join(KIT, 'webgl.ts'), 'utf8');
  assert.deepEqual(webgl, [], 'a kit file imports three.js: list its modules in WEBGL_MODULES (kit/remotion/webgl.ts)');
  assert.match(source, /WEBGL_MODULES: readonly string\[\] = Object\.freeze\(\[\]\)/);
});

test('the package root loads no font files; the kit Root and "./fonts" do', () => {
  assert.ok(!importsOf('index.ts').includes('./font-files'));
  assert.ok(!importsOf('compositions.tsx').includes('./font-files'));
  assert.ok(importsOf('Root.tsx').includes('./font-files'));
  assert.equal(json(path.join(KIT, 'package.json')).exports['./fonts'].default, './dist/fonts.js');
});

test('@launchclip/remotion is versioned in step with launchclip, with React and Remotion as peers', () => {
  const root = json(path.join(ROOT, 'package.json'));
  const kit = json(path.join(KIT, 'package.json'));
  assert.equal(kit.name, '@launchclip/remotion');
  assert.equal(kit.version, root.version);
  assert.equal(kit.dependencies['@launchclip/core'], root.version);
  assert.ok(root.workspaces.includes('kit/remotion'));
  assert.deepEqual(Object.keys(kit.peerDependencies).sort(), ['react', 'remotion']);
  assert.equal(kit.peerDependencies.remotion, `^${root.dependencies.remotion}`);
  // The font packages font-files.ts imports, at the root's pinned versions.
  const fonts = Object.entries(root.dependencies).filter(([name]) => name.startsWith('@fontsource'));
  assert.ok(fonts.length >= 25);
  assert.deepEqual(Object.fromEntries(Object.entries(kit.dependencies).filter(([name]) => name.startsWith('@fontsource'))), Object.fromEntries(fonts));
  assert.ok(!('react' in kit.dependencies) && !('remotion' in kit.dependencies));
});

async function packed(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'launchclip-remotion-package-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  // Packs copies, so prepack never writes dist/ (or kit/core/types/) into the
  // kit, whose content is the fingerprint render caches key on.
  const copies = {core: path.join(temp, 'core'), remotion: path.join(temp, 'remotion')};
  await cp(path.join(ROOT, 'kit/core'), copies.core, {recursive: true, filter: (source) => !/[\\/](types|node_modules)$/.test(source)});
  await cp(KIT, copies.remotion, {recursive: true, filter: (source) => !/[\\/](dist|node_modules)$/.test(source)});
  await run(process.execPath, [path.join(ROOT, 'kit/core/scripts/build-types.js'), copies.core]);
  await run(process.execPath, [path.join(KIT, 'scripts/build.mjs'), path.join(copies.remotion, 'dist')], {cwd: ROOT});
  const pack = async (dir) => JSON.parse((await run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], {cwd: dir})).stdout)[0];
  return {temp, core: await pack(copies.core), remotion: await pack(copies.remotion)};
}

async function consumer(temp, name, tarballs, extra) {
  const dir = path.join(temp, name);
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({name, private: true, type: 'module'}, null, 2)}\n`);
  const root = json(path.join(ROOT, 'package.json'));
  const pinned = (pkg) => `${pkg}@${root.dependencies[pkg] ?? root.devDependencies[pkg] ?? (pkg.startsWith("@remotion/") ? root.dependencies.remotion : "latest")}`;
  await run(npm, ['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs.map((file) => path.join(temp, file.filename)), ...extra.map(pinned)], {cwd: dir, maxBuffer: 1 << 24});
  return dir;
}

test('the packed package installs, imports and typechecks', {timeout: 300_000}, async (t) => {
  const {temp, core, remotion} = await packed(t);
  const listed = remotion.files.map((file) => file.path);
  for (const file of ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/fonts.js', 'dist/types/index.d.ts', 'dist/types/font-files.d.ts']) {
    assert.ok(listed.includes(file), `${file} is missing from the tarball`);
  }
  assert.equal(listed.filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts')).length, 0, 'the tarball ships compiled JS, not TSX');
  assert.ok(!readFileSync(path.join(temp, 'remotion/dist/index.js'), 'utf8').includes('.woff2'), 'the package root imports no font files');

  const dir = await consumer(temp, 'consumer', [core, remotion], ['react', 'remotion', 'typescript', '@types/react']);

  await t.test('in Node', async () => {
    await writeFile(path.join(dir, 'node.mjs'), `
import * as kit from '@launchclip/remotion';
import { resolveStory } from '@launchclip/core';
import { readFileSync } from 'node:fs';
const story = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const words = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const resolved = { ...resolveStory(story, { words: words.words ?? words }), __captions: [] };
const player = await kit.storyPlayerProps(resolved);
kit.setAssetResolver((src) => src.startsWith('assets/') ? 'https://media.example/' + src : null);
console.log(JSON.stringify({
  resolvedFrom: import.meta.resolve('@launchclip/remotion'),
  player: { ...player, component: typeof player.component, inputProps: undefined },
  modules: Object.keys(kit.MODULE_COMPONENTS).length,
  registries: Object.keys(kit).filter((name) => /^(EDITORIAL|CATALOG|CHARACTER|WORLD)_COMPONENTS/.test(name)).length,
  fonts: kit.FONT_FACES.length,
  webgl: kit.storyWebGLModules(story),
  asset: kit.assetUrl('assets/clip.mp4'),
  remote: kit.assetUrl('https://cdn.example/a.png'),
  compositions: typeof kit.LaunchclipCompositions
}));
`);
    const {stdout} = await run(process.execPath, ['node.mjs', path.join(ROOT, 'examples/story/minimal/storyboard.json'), path.join(ROOT, 'examples/story/minimal/NARRATION.json')], {cwd: dir});
    const result = JSON.parse(stdout);
    assert.match(result.resolvedFrom, /node_modules\/@launchclip\/remotion\/dist\/index\.js$/);
    assert.deepEqual(result.player, {component: 'function', durationInFrames: 180, fps: 30, compositionWidth: 1080, compositionHeight: 1920});
    assert.ok(result.modules > 100, `${result.modules} modules`);
    assert.equal(result.registries, 12);
    assert.ok(result.fonts >= 27);
    assert.deepEqual(result.webgl, []);
    assert.equal(result.asset, 'https://media.example/assets/clip.mp4');
    assert.equal(result.remote, 'https://cdn.example/a.png');
    assert.equal(result.compositions, 'function');
  });

  await t.test('from TypeScript, with the generated types', async () => {
    await writeFile(path.join(dir, 'consumer.tsx'), `
import React from 'react';
import { LaunchclipCompositions, StoryComposition, storyPlayerProps, setAssetResolver, MODULE_COMPONENTS, CATALOG_COMPONENTS_A, FONT_FACES, moduleNeedsWebGL } from '@launchclip/remotion';
import type { StoryProps, StoryPlayerProps, CustomModuleProps } from '@launchclip/remotion';
import { FONT_FILES } from '@launchclip/remotion/fonts';
// @ts-expect-error the package has no such export
import { notExported } from '@launchclip/remotion';
const Custom: React.FC<CustomModuleProps> = ({ params }) => <div>{String(params.label)}</div>;
export const root = <LaunchclipCompositions customModules={{ Custom }} />;
export const story: React.FC<StoryProps> = StoryComposition;
export const player: Promise<StoryPlayerProps> = storyPlayerProps({ format: { width: 1080, height: 1920, fps: 30, duration: 1 } });
setAssetResolver((src: string) => src.startsWith('assets/') ? '/media/' + src : null);
const files: Record<string, string> = FONT_FILES;
const ids: string[] = [...Object.keys(MODULE_COMPONENTS), ...Object.keys(CATALOG_COMPONENTS_A)];
const families: string[] = FONT_FACES.map((face) => face.package);
const gated: boolean = moduleNeedsWebGL('world');
console.log(files, ids, families, gated, notExported);
`);
    await writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify({compilerOptions: {target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, types: []}, files: ['consumer.tsx']}));
    await run(process.execPath, [path.join(dir, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], {cwd: dir}).catch((error) => assert.fail(error.stdout || error.message));
  });
});

test('an app bundles the installed package with its own entry and renders a story still', {skip: mediaSkip(), timeout: 600_000}, async (t) => {
  try {
    const {ensureBrowser} = await import('@remotion/renderer');
    await ensureBrowser();
  } catch (error) {
    t.skip(`Chrome Headless Shell is unavailable: ${error.message}`);
    return;
  }
  const {temp, core, remotion} = await packed(t);
  const dir = await consumer(temp, 'app', [core, remotion], ['react', 'react-dom', 'remotion', '@remotion/bundler', '@remotion/renderer']);
  // The app's own Remotion entry and public dir: nothing LaunchClip-shaped.
  await mkdir(path.join(dir, 'src'), {recursive: true});
  await writeFile(path.join(dir, 'src/index.jsx'), `
import React from 'react';
import { registerRoot } from 'remotion';
import { LaunchclipCompositions } from '@launchclip/remotion';
import '@launchclip/remotion/fonts';
registerRoot(() => <LaunchclipCompositions />);
`);
  await cp(path.join(ROOT, 'examples/story/minimal'), path.join(dir, 'public'), {recursive: true});
  await writeFile(path.join(dir, 'render.mjs'), `
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { resolveStory } from '@launchclip/core';
import { readFileSync } from 'node:fs';
const story = JSON.parse(readFileSync('public/storyboard.json', 'utf8'));
const words = JSON.parse(readFileSync('public/NARRATION.json', 'utf8'));
const inputProps = resolveStory(story, { words: words.words ?? words });
const serveUrl = await bundle({ entryPoint: 'src/index.jsx', publicDir: 'public' });
const composition = await selectComposition({ serveUrl, id: 'LaunchclipStory', inputProps });
await renderStill({ serveUrl, composition, inputProps, frame: 96, output: 'still.png' });
console.log(JSON.stringify({ width: composition.width, height: composition.height, frames: composition.durationInFrames, captions: (composition.props.__captions ?? []).length }));
`);
  const {stdout} = await run(process.execPath, ['render.mjs'], {cwd: dir, maxBuffer: 1 << 26});
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.deepEqual({...result, captions: result.captions > 0}, {width: 1080, height: 1920, frames: 180, captions: true});
  const png = await readFile(path.join(dir, 'still.png'));
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.ok(png.length > 20_000, 'the frame has content');
});

test('the skill copy of the kit imports its own core copy, one ../ per folder', () => {
  const copy = path.join(ROOT, 'skills/launchclip-create-video-remotion/assets/remotion-kit');
  const read = (file) => readFileSync(path.join(copy, file), 'utf8');
  assert.match(read('StoryComposition.tsx'), /from "\.\.\/core\/modules\.mjs"/);
  assert.match(read('catalog/CatalogB.tsx'), /from '\.\.\/\.\.\/core\/catalog-b\.mjs'/);
  for (const file of kitFiles(copy)) assert.doesNotMatch(read(file), /@launchclip\/core\//, file);
  assert.ok(!kitFiles(copy).includes('package.json'));
});
