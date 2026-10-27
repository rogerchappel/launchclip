#!/usr/bin/env node
// Vendor MathJax's TeX → SVG converter for the equation module
// (kit/core/catalog-i-math.mjs, typeset by src/math/typeset.js) as one
// Node file, src/math/mathjax-tex-svg.js, so LaunchClip needs no MathJax
// dependency at runtime and kit/core stays import-free.
//
//   npm install mathjax-full@3.2.2   (in an empty folder)
//   node scripts/vendor-mathjax.mjs <that folder> [--out src/math/mathjax-tex-svg.js]
//
// Bundles only the TeX input (base, ams, html, newcommand, boldsymbol) and
// the SVG output with a local glyph cache, using the repo's esbuild.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = `import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/html/HtmlConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/noerrors/NoErrorsConfiguration.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({packages: ['base', 'ams', 'html', 'newcommand', 'boldsymbol']});
const svg = new SVG({fontCache: 'local'});
const doc = mathjax.document('', {InputJax: tex, OutputJax: svg});

/** TeX → the SVG markup MathJax 3 draws for it (display style). Throws on a TeX error. */
export function texToSvg(source, {display = true} = {}) {
  const node = doc.convert(source, {display});
  const out = adaptor.innerHTML(node);
  const error = out.match(/data-mjx-error="([^"]*)"/);
  if (error) throw new Error(\`TeX error: \${error[1]}\`);
  return out;
}
`;

function main(argv) {
  const dir = argv[0] && path.resolve(argv[0]);
  if (!dir) throw new Error('usage: vendor-mathjax.mjs <folder with node_modules/mathjax-full> [--out file]');
  const out = argv[1] === '--out' ? path.resolve(argv[2]) : path.join(ROOT, 'src', 'math', 'mathjax-tex-svg.js');
  const version = JSON.parse(readFileSync(path.join(dir, 'node_modules', 'mathjax-full', 'package.json'), 'utf8')).version;
  const entry = path.join(dir, 'launchclip-mathjax-entry.mjs');
  writeFileSync(entry, ENTRY);
  const bundle = path.join(dir, 'launchclip-mathjax-bundle.js');
  execFileSync(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [entry, '--bundle', '--format=esm', '--platform=node', '--minify', '--legal-comments=none', `--outfile=${bundle}`], {stdio: 'inherit'});
  const header = [`// MathJax ${version} (https://www.mathjax.org), TeX input and SVG output only,`, '// bundled for Node by scripts/vendor-mathjax.mjs. Generated: do not edit.',
    '// Copyright (c) 2009-2022 The MathJax Consortium. Licensed under the Apache', '// License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0); see', '// THIRD_PARTY_NOTICES.md.'];
  writeFileSync(out, `${header.join('\n')}\n${readFileSync(bundle, 'utf8')}`);
  process.stdout.write(`MathJax ${version} → ${path.relative(ROOT, out)}\n`);
}

main(process.argv.slice(2));
