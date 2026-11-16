// Text-fit check for body faces (docs/VIDEO_TELLS_RFC.md §5): every module
// parity fixture, compiled with HyperFrames once per body face and measured
// in Chromium at the mid hold. A text run that ends outside its clipping box
// (or the frame) overflows; the report lists only the overflow a face adds
// over the baseline face, so tickers and slides that leave the frame on
// purpose do not count. Both renderers lay text out from the same core
// models and the same font files, so one renderer's measure covers both;
// scripts/parity.mjs checks that they agree.
//
//   node scripts/font-fit.mjs [--fonts manrope,dm-sans] [--baseline space-grotesk]
//     [--match a-cat-] [--jobs 4] [--out qa/font-fit/report.json]

import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {defaultCompileHyperFrames, loadFixture, resolveSceneModel, sampleTimes, sceneStory} from './parity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'parity');

function args(argv) {
  const out = {fonts: ['manrope', 'dm-sans', 'lexend', 'outfit'], baseline: 'space-grotesk', match: '', jobs: 4, out: path.join(ROOT, 'qa', 'font-fit', 'report.json')};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fonts') out.fonts = argv[++i].split(',');
    else if (a === '--baseline') out.baseline = argv[++i];
    else if (a === '--match') out.match = argv[++i];
    else if (a === '--jobs') out.jobs = Number(argv[++i]);
    else if (a === '--out') out.out = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

/** In the page: text runs that end outside their nearest clipping ancestor, or the frame. */
function measureOverflow() {
  const root = document.querySelector('[data-composition-id]');
  const frame = root.getBoundingClientRect();
  const found = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    const el = node.parentElement;
    if (!text || !el || el.closest('script,style')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let box = frame;
    for (let a = el; a && a !== root; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.clipPath !== 'none') { box = a.getBoundingClientRect(); break; }
    }
    // A run wholly outside its box is parked off stage (carousels, tickers), not overflowing.
    if (r.left >= box.right || r.right <= box.left || r.top >= box.bottom || r.bottom <= box.top) continue;
    const by = Math.max(r.right - box.right, box.left - r.left, r.bottom - box.bottom, box.top - r.top);
    if (by > 1) found.push({text: text.slice(0, 60), by: Math.round(by)});
  }
  return found;
}

async function measure(page, fixtureFile, body) {
  const fixture = await loadFixture(fixtureFile);
  fixture.story.brand = {...fixture.story.brand, fonts: {...fixture.story.brand.fonts, body}};
  const {story, scene} = await sceneStory(fixture.story, fixture.sceneId);
  const model = await resolveSceneModel(scene, story);
  const [sample] = sampleTimes(model, {fps: story.format.fps ?? 30, times: 'mid'});
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'launchclip-font-fit-'));
  try {
    await defaultCompileHyperFrames({story, scene, model, projectDir, warnings: [], fixturePath: fixtureFile}, {compiler: 'story'});
    await page.setViewportSize({width: story.format.width, height: story.format.height});
    await page.goto(pathToFileURL(path.join(projectDir, 'index.html')).href);
    await page.waitForFunction(() => window.__timelines && Object.keys(window.__timelines).length);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.evaluate(t => { for (const tl of Object.values(window.__timelines)) tl.seek(t, false); }, sample.time);
    return await page.evaluate(measureOverflow);
  } finally {
    await rm(projectDir, {recursive: true, force: true});
  }
}

async function main(argv) {
  const opts = args(argv);
  const files = (await readdir(FIXTURES)).filter(name => name.endsWith('.json') && name.includes(opts.match)).sort();
  const {chromium} = await import('playwright');
  const browser = await chromium.launch();
  const report = {baseline: opts.baseline, fonts: opts.fonts, fixtures: 0, failed: [], added: []};
  let next = 0;
  const worker = async () => {
    const page = await browser.newPage();
    for (let i = next++; i < files.length; i = next++) {
      const file = path.join(FIXTURES, files[i]);
      try {
        const base = await measure(page, file, opts.baseline);
        // Repeated texts (weekday labels) pair up in document order.
        const keyed = list => { const seen = new Map(); return list.map(item => { const n = seen.get(item.text) ?? 0; seen.set(item.text, n + 1); return [`${item.text}#${n}`, item]; }); };
        const baseBy = new Map(keyed(base).map(([key, item]) => [key, item.by]));
        for (const body of opts.fonts) {
          for (const [key, item] of keyed(await measure(page, file, body))) {
            if (item.by > (baseBy.get(key) ?? 0) + 2) report.added.push({fixture: files[i], body, ...item, baseline: baseBy.get(key) ?? 0});
          }
        }
        report.fixtures += 1;
      } catch (error) { report.failed.push({fixture: files[i], error: error.message.split('\n')[0]}); }
      if ((i + 1) % 25 === 0) process.stderr.write(`${i + 1}/${files.length}\n`);
    }
    await page.close();
  };
  try { await Promise.all(Array.from({length: opts.jobs}, worker)); } finally { await browser.close(); }
  await mkdir(path.dirname(opts.out), {recursive: true});
  await writeFile(opts.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.fixtures} fixtures, ${report.added.length} added overflows, ${report.failed.length} failed → ${opts.out}\n`);
  if (report.added.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
