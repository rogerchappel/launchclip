#!/usr/bin/env node
// Builds dist/ for @launchclip/remotion (npm run build, run by prepack): the
// kit's TSX compiled to ESM with esbuild, and declarations from tsc.
//   dist/index.js   the package root (index.ts), no font files
//   dist/fonts.js   font-files.ts: imports every registry woff2 and registers it
// Both entries share one chunk, so they see the same font and asset registries.
// React, Remotion, @launchclip/core and the @fontsource packages stay imports,
// so the app's bundler resolves one copy of each. An argument builds into
// another folder (test/remotion_package.test.js never writes into kit/remotion).
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? path.join(KIT, 'dist'));
const EXTERNAL = ['react', 'react/*', 'react-dom', 'react-dom/*', 'remotion', 'remotion/*', '@launchclip/core', '@launchclip/core/*', '@fontsource/*', '@fontsource-variable/*'];

rmSync(OUT, { recursive: true, force: true });
await build({
  entryPoints: { index: path.join(KIT, 'index.ts'), fonts: path.join(KIT, 'font-files.ts') },
  outdir: OUT,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: EXTERNAL,
  chunkNames: 'chunks/[name]-[hash]',
  legalComments: 'none',
  logLevel: 'warning'
});

const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  declaration: true,
  emitDeclarationOnly: true,
  rootDir: KIT,
  outDir: path.join(OUT, 'types'),
  types: []
};
const program = ts.createProgram([path.join(KIT, 'index.ts'), path.join(KIT, 'font-files.ts'), path.join(KIT, 'assets.d.ts')], options);
const result = program.emit();
const errors = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics].filter((item) => item.category === ts.DiagnosticCategory.Error);
if (errors.length) {
  const host = { getCanonicalFileName: (name) => name, getCurrentDirectory: () => KIT, getNewLine: () => '\n' };
  throw new Error(ts.formatDiagnostics(errors, host));
}
// The *.woff2 module declaration, for apps that import the font files themselves.
writeFileSync(path.join(OUT, 'types', 'assets.d.ts'), "declare module '*.woff2' {\n  const src: string;\n  export default src;\n}\n");
