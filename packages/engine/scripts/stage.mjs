#!/usr/bin/env node
// Stages @launchclip/engine (npm run stage, run by prepack): the engine stays
// in the repository's src/ (the CLI runs the same files), and the package is
// that code laid out as in the repository, so every path the engine resolves
// from its own root (kit/remotion/entry.tsx, kit/styles, src/scripts/…) holds:
//   src/…            every src/ file reachable from src/engine/index.js, plus
//                    the ones loaded by computed paths (EXTRA_TREES)
//   kit/hyperframes, kit/remotion (TSX the Remotion renderer bundles),
//   kit/styles, kit/profiles, public/
// @launchclip/core is a dependency, never copied (kit/hyperframes' relative
// ../core/ imports are rewritten to it). The script also checks
// that package.json declares every package the staged code imports, at the
// root's pinned version. An argument stages into another folder
// (test/engine_package.test.js); --check only reports.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(PACKAGE, '../..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const OUT = path.resolve(args.find((arg) => !arg.startsWith('--')) ?? PACKAGE);

export const STAGED_DIRS = Object.freeze(['src', 'kit', 'public']);
// Loaded through computed paths (lazy voice providers, spawned scripts) or
// read as data, so the import graph alone does not reach them.
const EXTRA_TREES = Object.freeze(['src/voice', 'src/scripts', 'kit/hyperframes', 'kit/remotion', 'kit/styles', 'kit/profiles', 'public']);
// kit/remotion is staged as the TSX the renderer bundles, not as its own package.
const SKIP = /(^|\/)(node_modules|dist)(\/|$)|^kit\/remotion\/(package\.json|README\.md|LICENSE|scripts\/)/;

function walk(relative) {
  const full = path.join(ROOT, relative);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [relative];
  return readdirSync(full).flatMap((name) => walk(`${relative}/${name}`)).filter((file) => !SKIP.test(file) && !path.basename(file).startsWith('.'));
}

const extras = EXTRA_TREES.flatMap(walk);
const entries = ['src/engine/index.js', ...extras.filter((file) => /^src\/.*\.(js|mjs)$/.test(file) || /^kit\/hyperframes\/.*\.mjs$/.test(file))];
const result = await build({
  entryPoints: entries.map((file) => path.join(ROOT, file)),
  absWorkingDir: ROOT,
  bundle: true, splitting: true, write: false, metafile: true, platform: 'node', format: 'esm', packages: 'external', outdir: 'out', logLevel: 'silent'
});
const reached = Object.keys(result.metafile.inputs);
const outside = reached.filter((file) => !file.startsWith('src/') && !file.startsWith('kit/'));
if (outside.length) throw new Error(`the engine imports files outside src/ and kit/: ${outside.join(', ')}`);
const files = [...new Set([...reached.filter((file) => !file.startsWith('kit/core/')), ...extras])].sort();
// kit/hyperframes imports ../core/ (it sits beside kit/core in a checkout);
// its staged copy imports @launchclip/core instead (stagedSource). Anything
// else must already import the package.
const coreLeaks = Object.entries(result.metafile.inputs)
  .filter(([file]) => !file.startsWith('kit/core/') && !file.startsWith('kit/hyperframes/'))
  .flatMap(([file, input]) => input.imports.filter((entry) => entry.path.startsWith('kit/core/')).map((entry) => `${file} → ${entry.path}`));
if (coreLeaks.length) throw new Error(`the engine reaches kit/core by path, not through @launchclip/core: ${coreLeaks.slice(0, 5).join(', ')}`);

export function stagedSource(file, source) {
  return /^kit\/hyperframes\/.*\.mjs$/.test(file) ? source.replace(/(['"])\.\.\/core\//g, '$1@launchclip/core/') : source;
}

// Packages the staged code imports, by package name.
const builtins = new Set(builtinModules);
const packageName = (specifier) => (specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
const imported = new Set();
for (const input of Object.values(result.metafile.inputs)) {
  for (const entry of input.imports) {
    if (!entry.external || entry.path.startsWith('node:') || builtins.has(entry.path)) continue;
    imported.add(packageName(entry.path));
  }
}
// Packages reached by name outside the import graph: lazy import() in the
// voice providers, createRequire() lookups (the HyperFrames CLI, package
// versions) and import.meta.resolve().
const byName = /(?:\bimport|\brequire(?:\.resolve)?|import\.meta\.resolve|packageVersion)\(\s*["']([^"'./][^"']*)["']\s*\)/g;
for (const file of files.filter((item) => /\.(js|mjs)$/.test(item))) {
  for (const match of readFileSync(path.join(ROOT, file), 'utf8').matchAll(byName)) {
    if (!match[1].startsWith('node:') && !builtins.has(match[1])) imported.add(packageName(match[1]));
  }
}
// The Remotion kit's TSX is bundled by the renderer at render time.
for (const file of files.filter((item) => /^kit\/remotion\/.*\.tsx?$/.test(item))) {
  for (const match of readFileSync(path.join(ROOT, file), 'utf8').matchAll(/from\s+["']([^"'./][^"']*)["']/g)) imported.add(packageName(match[1]));
}
// Dependencies of an optional dependency the code also imports by name.
const THROUGH = Object.freeze({ '@huggingface/transformers': 'kokoro-js', phonemizer: 'kokoro-js' });
const pkg = JSON.parse(readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'));
const declared = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
const missing = [...imported].filter((name) => !declared[name] && !declared[THROUGH[name]]).sort();
if (missing.length) throw new Error(`packages/engine/package.json does not declare: ${missing.join(', ')}`);

if (check) {
  console.log(JSON.stringify({ files: files.length, packages: [...imported].sort() }, null, 2));
} else {
  for (const dir of STAGED_DIRS) rmSync(path.join(OUT, dir), { recursive: true, force: true });
  for (const file of files) {
    mkdirSync(path.dirname(path.join(OUT, file)), { recursive: true });
    if (/^kit\/hyperframes\/.*\.mjs$/.test(file)) writeFileSync(path.join(OUT, file), stagedSource(file, readFileSync(path.join(ROOT, file), 'utf8')));
    else cpSync(path.join(ROOT, file), path.join(OUT, file));
  }
  console.log(`staged ${files.length} files into ${path.relative(process.cwd(), OUT) || '.'}`);
}
