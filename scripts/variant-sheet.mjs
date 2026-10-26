#!/usr/bin/env node
// Module variants: a contact sheet and the gates (docs/SEEDED_STYLES_RFC.md
// §3.2, phase 3). Builds one motion-lane story per aspect with a scene for
// every variant of every module that has them (kit/core/modules.mjs
// moduleVariants), then
//
// - the sheet: a settled still of each variant from HyperFrames, one row per
//   module, written as <out>/sheet-<aspect>.png;
// - the gates (--gates): `launchclip layout-check`, and `hyperframes lint` and
//   `check` of the compiled story, which must report no errors and no
//   content_overlap or clipped_text finding. Exits 1 when a gate fails.
//
//   node scripts/variant-sheet.mjs [--modules concept-card,icon-row]
//     [--aspects 9:16,16:9] [--out qa/variants] [--gates] [--no-sheet]
import {spawn} from 'node:child_process';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {moduleVariants} from '../kit/core/modules.mjs';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HYPERFRAMES_CLI = path.join(path.dirname(require.resolve('hyperframes/package.json')), require('hyperframes/package.json').bin?.hyperframes ?? 'dist/cli.js');
const SCENE = 3.5, SETTLED = 2.8;

export const BRAND = Object.freeze({colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}});
const FORMATS = {'9:16': {width: 1080, height: 1920, platform: 'youtube-shorts'}, '16:9': {width: 1920, height: 1080, platform: 'youtube'}};

/** The params each module's variants are shown with: every optional part a variant draws. */
export const SAMPLES = Object.freeze({
  'concept-card': {text: 'Ship faster', icon: 'rocket', sub: 'From one recording to every format'},
  'icon-row': {title: 'Three steps to a Short', items: [{icon: 'mic', label: 'Record'}, {icon: 'scissors', label: 'Cut the best take'}, {icon: 'send', label: 'Post everywhere'}]},
  'section-card': {title: 'How it works', kicker: 'Part two', number: 2},
  'object-card': {object: 'box', caption: 'It ships as one file', label: 'Export'},
  'stat-card': {value: '87%', label: 'of renders finish in one pass', source: 'LaunchClip eval, Oct 2026', icon: 'chart-up'},
  'quote-card': {quote: 'We cut our launch video in an afternoon, and it looked like our brand.', author: 'Priya Natarajan', role: 'Head of Product, Fieldnote', highlight: 'in an afternoon'},
  'excerpt': {type: 'code', title: 'storyboard.json', source: 'examples/story/minimal', lines: ['"lane": "motion",', {text: '"style": "seed-7f3a91c2",', highlight: true}, '"scenes": [ … ]']},
  'compare': {left: {title: 'Before', items: ['Edit by hand', 'One format at a time']}, right: {title: 'After', items: ['One prompt', 'Every format at once']}},
  'timeline': {title: 'Launch week', steps: [{label: 'Record', detail: 'Monday'}, {label: 'Edit', detail: 'Tuesday'}, {label: 'Ship', detail: 'Friday'}]},
  'hook-title': {headline: 'Demos that rebuild themselves.', emphasis: [{text: 'rebuild', at: 0.6}], eyebrow: 'Launch week', kicker: 'Meet Pulseboard', kickerAt: 1.2},
  'cta': {action: 'Try Pulseboard today', emphasis: 'Pulseboard', detail: 'Free for open source', handle: 'pulseboard.dev'},
  // Editorial modules.
  'checklist': {title: 'Release checklist', rows: [{label: 'Write the changelog', status: 'active', at: 0.4, doneAt: 1.4}, {label: 'Tag the release', status: 'done', at: 0.9}, {label: 'Announce it', status: 'pending', at: 1.2}]},
  'step-rail': {title: 'From idea to clip', numbered: true, steps: [{label: 'Plan', at: 0.4}, {label: 'Record', at: 0.9}, {label: 'Edit', at: 1.4}, {label: 'Share', at: 1.9}]},
  'metric': {title: 'Build time', metric: {mode: 'illustration', unit: 'example minutes', format: 'number', decimals: 0, values: [{value: 48, at: 0.4}, {value: 12, at: 1.2}]}},
  'callout': {title: 'Ship it safely', treatment: {icon: 'warning', glow: true, at: 0.4, segments: [{text: 'Check '}, {text: 'before release', highlight: true, underlineAt: 1.2}, {text: ' and ship.'}]}}
});

function args(argv) {
  const out = {modules: null, aspects: ['9:16', '16:9'], out: path.join(ROOT, 'qa', 'variants'), gates: false, sheet: true};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--modules') out.modules = argv[++i].split(',');
    else if (a === '--aspects') out.aspects = argv[++i].split(',');
    else if (a === '--out') out.out = path.resolve(argv[++i]);
    else if (a === '--gates') out.gates = true;
    else if (a === '--no-sheet') out.sheet = false;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

function run(command, argv, {cwd = ROOT} = {}) {
  return new Promise(resolve => {
    const child = spawn(command, argv, {cwd, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({code, stdout, stderr}));
  });
}
const json = text => { try { return JSON.parse(text.slice(text.indexOf('{'))); } catch { return null; } };

/** The gallery story for one aspect: a scene per (module, variant). */
export function galleryStory(aspect, entries) {
  const scenes = entries.map(({module, variant}, i) => ({id: `${module}-${variant}`.replace(/[^a-z0-9-]/g, '-'), module, start: r(i * SCENE), end: r((i + 1) * SCENE), params: {...structuredClone(SAMPLES[module]), variant}}));
  return {schema: 'launchclip.story.v1', title: `Module variants ${aspect}`, lane: 'motion', format: {...FORMATS[aspect], fps: 30, duration: r(entries.length * SCENE)}, brand: structuredClone(BRAND), scenes};
}
const r = v => Math.round(v * 1000) / 1000;

async function gates(projectDir, hfDir) {
  const findings = [];
  const layout = await run(process.execPath, [path.join(ROOT, 'bin', 'launchclip.js'), 'layout-check', projectDir, '--json']);
  const report = json(layout.stdout);
  if (!report) findings.push({gate: 'layout-check', message: (layout.stderr || layout.stdout).slice(-2000)});
  for (const item of report?.findings ?? []) if (item.severity === 'error') findings.push({gate: 'layout-check', message: `${item.rule} ${item.ids.join(', ')} at ${item.at} s: ${item.detail}`});
  const lint = await run(process.execPath, [HYPERFRAMES_CLI, 'lint', '--json', hfDir], {cwd: hfDir});
  for (const item of json(lint.stdout)?.findings ?? []) if (item.severity === 'error') findings.push({gate: 'hyperframes lint', message: `${item.code}: ${item.message}`});
  if (lint.code && !findings.some(f => f.gate === 'hyperframes lint')) findings.push({gate: 'hyperframes lint', message: (lint.stderr || lint.stdout).slice(-2000)});
  const check = await run(process.execPath, [HYPERFRAMES_CLI, 'check', '--json', hfDir], {cwd: hfDir});
  const checked = json(check.stdout);
  if (!checked) findings.push({gate: 'hyperframes check', message: (check.stderr || check.stdout).slice(-2000)});
  const all = ['lint', 'runtime', 'layout', 'motion', 'contrast'].flatMap(key => checked?.[key]?.findings ?? []);
  for (const item of all) {
    const code = item.code ?? item.type ?? item.rule;
    if (item.severity === 'error' || ['content_overlap', 'clipped_text'].includes(code)) findings.push({gate: 'hyperframes check', message: `${code}${item.selector ? ` ${item.selector}` : ''}${item.time !== undefined ? ` at ${item.time} s` : ''}: ${item.message ?? ''}`});
  }
  return findings;
}

async function sheet(hfDir, story, entries, outFile) {
  const frames = path.join(path.dirname(outFile), `frames-${path.basename(outFile, '.png')}`);
  await rm(frames, {recursive: true, force: true});
  await mkdir(frames, {recursive: true});
  const at = story.scenes.map(scene => String(r(scene.start + SETTLED))).join(',');
  const shot = await run(process.execPath, [HYPERFRAMES_CLI, 'snapshot', '--at', at, '--no-end', '--output', frames, '--describe', 'false', hfDir], {cwd: hfDir});
  if (shot.code) throw new Error(`hyperframes snapshot failed: ${(shot.stderr || shot.stdout).slice(-2000)}`);
  const files = (await readdir(frames)).filter(name => /^frame-\d+.*\.png$/i.test(name)).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
  const {width, height} = story.format;
  const cellW = width > height ? 480 : 270, cellH = Math.round(cellW * height / width);
  const rows = [...new Set(entries.map(entry => entry.module))];
  const cols = Math.max(...rows.map(module => entries.filter(entry => entry.module === module).length));
  const img = async i => `data:image/png;base64,${(await readFile(path.join(frames, files[i]))).toString('base64')}`;
  let cells = '';
  for (const [y, module] of rows.entries()) {
    cells += `<div class="name" style="top:${y * (cellH + 40) + 8}px">${module}</div>`;
    for (const [x, entry] of entries.filter(e => e.module === module).entries()) {
      const left = 180 + x * (cellW + 12), top = y * (cellH + 40) + 30;
      cells += `<img src="${await img(entries.indexOf(entry))}" style="left:${left}px;top:${top}px;width:${cellW}px;height:${cellH}px"><div class="label" style="left:${left}px;top:${top - 22}px">${entry.variant}${x === 0 ? ' (default)' : ''}</div>`;
    }
  }
  const W = 180 + cols * (cellW + 12), H = rows.length * (cellH + 40) + 20;
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#16171c;width:${W}px;height:${H}px;position:relative;font:15px/1.2 ui-monospace,Menlo,monospace;color:#d8d8de}img{position:absolute;border:1px solid #ffffff22}.label,.name{position:absolute}.name{left:12px;margin-top:${cellH / 2}px;color:#fff}</style><body>${cells}</body>`;
  const {chromium} = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {width: W, height: H}});
    await page.setContent(html);
    await page.screenshot({path: outFile, fullPage: true});
  } finally {
    await browser.close();
  }
  await rm(frames, {recursive: true, force: true});
}

async function main(argv) {
  const opts = args(argv);
  const all = moduleVariants();
  const modules = (opts.modules ?? Object.keys(all)).filter(module => {
    if (!all[module]) throw new Error(`${module} has no variants (modules with variants: ${Object.keys(all).join(', ')})`);
    return true;
  });
  const entries = modules.flatMap(module => all[module].map(variant => ({module, variant})));
  const {compileStoryToHyperFrames} = await import(pathToFileURL(path.join(ROOT, 'kit', 'hyperframes', 'story-compiler.mjs')).href);
  const {readProjectStory} = await import(pathToFileURL(path.join(ROOT, 'src', 'story_loader.js')).href);
  let failed = false;
  const results = {};
  for (const aspect of opts.aspects) {
    const tag = aspect.replace(':', 'x');
    const projectDir = path.join(opts.out, tag, 'project'), hfDir = path.join(opts.out, tag, 'hyperframes');
    await rm(path.join(opts.out, tag), {recursive: true, force: true});
    await mkdir(projectDir, {recursive: true});
    const story = galleryStory(aspect, entries);
    await writeFile(path.join(projectDir, 'storyboard.json'), `${JSON.stringify(story, null, 2)}\n`);
    const loaded = await readProjectStory(projectDir);
    await compileStoryToHyperFrames(loaded.resolved, {projectDir: hfDir, sourceDir: projectDir});
    if (opts.gates) {
      const findings = await gates(projectDir, hfDir);
      results[aspect] = findings;
      failed ||= findings.length > 0;
      process.stdout.write(`${aspect}: ${findings.length ? `${findings.length} gate finding(s)` : 'gates pass'}\n${findings.map(f => `  ${f.gate}: ${f.message}`).join('\n')}${findings.length ? '\n' : ''}`);
    }
    if (opts.sheet) {
      const file = path.join(opts.out, `sheet-${tag}.png`);
      await sheet(hfDir, story, entries, file);
      process.stdout.write(`${aspect}: sheet → ${path.relative(ROOT, file)}\n`);
    }
  }
  if (opts.gates) await writeFile(path.join(opts.out, 'gates.json'), `${JSON.stringify(results, null, 2)}\n`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error.stack ?? error); process.exitCode = 1; });
}
