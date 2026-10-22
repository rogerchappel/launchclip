// Editorial density: content-derived default rects (both aspects), the type
// scale for derived rects and explicit 9:16 rects
// (kit/core/editorial-core.mjs, DENSITY). RFC §5 Shorts rules: key content in
// y 280–1450 / x 80–940, centre of mass near y 860, lower third never empty,
// key text at least 44 px.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DENSITY, resolveEditorialModule} from '../kit/core/editorial-core.mjs';
import {buildEditorialModule} from '../kit/hyperframes/editorial-ui-modules.mjs';
import {SAFE_ZONE_PROFILES, checkLayout, elementsFromEditorialLayout} from '../kit/core/layout-check.mjs';

const base = {id: 'mod', start: 0, duration: 4};
const SPECS = {
  callout: {title: 'Ship the smallest useful change', body: 'Small pull requests get reviewed the same day.'},
  'callout-treated': {kind: 'callout', title: 'Review before shipping', treatment: {icon: 'branch', at: .6, segments: [{text: 'Every change gets '}, {text: 'a second pair of eyes', highlight: true}]}},
  checklist: {title: 'Three changes', rows: [{label: 'Cache dependencies', status: 'done', at: .5}, {label: 'Split the test suite', status: 'done', at: 1.1}, {label: 'Ship smaller images', status: 'active', at: 1.7}]},
  'step-rail': {title: 'How it ships', numbered: true, steps: [{label: 'Plan', at: .6}, {label: 'Build', at: 1.6}, {label: 'Share', at: 2.6}]},
  'audience-grid': {title: 'Who it is for', audience: {tiles: [{label: 'Founders', at: .6}, {label: 'Designers', at: 1}, {label: 'Engineers', at: 1.4}, {label: 'Writers', at: 1.8}]}},
  'trend-chart': {title: 'Weekly views', chart: {mode: 'illustration', unit: 'views', points: [{label: 'Mon', value: 120, at: .6}, {label: 'Wed', value: 340, at: 1.2}, {label: 'Fri', value: 610, at: 1.8}]}},
  'growth-chart': {title: 'Reach develops', growth: {mode: 'illustration'}},
  metric: {title: 'Build time', metric: {mode: 'illustration', unit: 'example minutes', format: 'number', values: [{value: 48, at: .4}, {value: 12, at: 1.6}]}},
  progress: {title: 'Migration', progress: {mode: 'illustration', label: 'Services moved', values: [{value: 20, at: .6}, {value: 85, at: 2}]}},
  'date-card': {title: 'Public launch', date: {month: 3, day: 14, year: 2027, caption: 'Open beta for everyone', at: .8}},
  'status-rack': {title: 'Pipeline status', rack: {mode: 'illustration', rows: [{label: 'Build', states: [{at: .8, lights: [true, false, false]}]}, {label: 'Deploy', states: [{at: 1.8, lights: [false, false, true]}]}]}},
  'code-snippet': {title: 'One line to start', code: {language: 'Shell', lines: [{at: .6, tokens: [{text: 'npm ', type: 'keyword'}, {text: 'install launchclip', type: 'plain'}]}]}},
  'excerpt-window': {title: 'README.md', excerpt: {mode: 'illustration', lines: [{segments: [{text: 'Build a useful thing.'}]}, {segments: [{text: 'Then '}, {text: 'make it clear.', highlight: true}]}], focus: {line: 1, scale: 1.2, at: 1.6}}},
  'focus-flow': {title: 'One chosen task', focus: {options: ['Research', 'New tools', 'The next build'], selected: 2, arriveAt: .4, chooseAt: 1.2, progressAt: 2.4, progressDuration: .8}}
};
const spec = (name, extra = {}) => ({...base, kind: name, ...SPECS[name], ...extra});
const centre = rect => rect.y + rect.height / 2;

test('9:16 default rects sit in the safe zone, above the caption band, at phone scale', () => {
  for (const name of Object.keys(SPECS)) {
    const model = resolveEditorialModule(spec(name, {aspect: '9:16'}));
    const {rect, density} = model;
    assert.equal(density.source, 'derived', name);
    assert.ok(rect.x >= 80 && rect.x + rect.width <= 940, `${name} x inside 80–940`);
    assert.ok(rect.y >= 280 && rect.y + rect.height <= DENSITY.portrait.captionTop, `${name} y inside 280–1190: ${JSON.stringify(rect)}`);
    // Centre of mass within the layout-check tolerance (860 ± 288).
    assert.ok(Math.abs(centre(rect) - 860) <= 288, `${name} centre ${centre(rect)}`);
    // Key text: title and base copy at least 44 px (body copy rounds from 43.2 at 1.8).
    assert.ok(model.chrome.titleFont * density.scale >= 44, `${name} title ${model.chrome.titleFont * density.scale}px`);
    assert.ok(model.chrome.font * density.scale >= 43, `${name} body ${model.chrome.font * density.scale}px`);
    assert.ok(density.scale >= 1.8, `${name} scale ${density.scale}`);
    // The card is as tall as its content, not a fixed 740 px box.
    assert.ok(density.natural <= density.layout.height + .5, name);
    assert.ok(density.layout.height - Math.max(160 / density.scale, density.natural) < 1, `${name} hugs its content`);
  }
});

test('compact 9:16 cards keep their centre below the lower-third line', () => {
  const lowerThird = 280 + 1170 / 2;
  for (const name of ['callout', 'callout-treated', 'checklist', 'step-rail', 'metric', 'progress', 'date-card', 'status-rack', 'code-snippet', 'excerpt-window']) {
    const {rect} = resolveEditorialModule(spec(name, {aspect: '9:16'}));
    assert.ok(centre(rect) > lowerThird, `${name} centre ${centre(rect)} > ${lowerThird}`);
  }
});

test('a short 9:16 callout is no taller than its copy', () => {
  const model = resolveEditorialModule({...base, kind: 'callout', aspect: '9:16', title: 'A useful idea', body: 'Keep the next step clear.'});
  assert.equal(model.density.scale, 2);
  assert.ok(model.rect.height < 300, `height ${model.rect.height}`);
  assert.ok(model.density.natural <= model.density.layout.height + .5);
});

test('9:16 hero numbers are genuinely big and stay inside the card', () => {
  const model = resolveEditorialModule(spec('metric', {aspect: '9:16'}));
  const rendered = model.content.numberFont * model.density.scale;
  assert.ok(rendered >= 200, `metric number ${rendered}px`);
  const widest = Math.max(...model.content.values.map(value => value.text.length));
  assert.ok(widest * model.content.numberFont * .68 <= model.density.layout.width - 48);
  // A progress card's hero is its bar; the number stays large but smaller.
  const progress = resolveEditorialModule(spec('progress', {aspect: '9:16'}));
  assert.ok(progress.content.numberFont * progress.density.scale >= 120);
  assert.ok(progress.content.numberFont < model.content.numberFont);
  const long = resolveEditorialModule(spec('metric', {aspect: '9:16', metric: {...SPECS.metric.metric, values: [{value: 1234567, at: .6}]}}));
  assert.ok('1,234,567'.length * long.content.numberFont * .68 <= long.density.layout.width - 48);
});

test('the emitter scales 9:16 content through one .ui-density wrapper', () => {
  const built = buildEditorialModule(spec('checklist', {aspect: '9:16'}));
  const model = resolveEditorialModule(spec('checklist', {aspect: '9:16'}));
  assert.match(built.html, /^<section id="mod"[^>]*><div class="ui-density"><h2 class="ui-title">/);
  assert.ok(built.css.includes(`#mod>.ui-density{position:absolute;left:0;top:0;width:${model.density.layout.width}px;height:${model.density.layout.height}px;transform:scale(${model.density.scale});transform-origin:0 0}`));
  assert.ok(built.css.includes(`left:${model.rect.x}px;top:${model.rect.y}px;width:${model.rect.width}px;height:${model.rect.height}px`));
  assert.deepEqual(built.layout.rect, model.rect);
});

test('explicit 16:9 rects stay at scale 1, untouched', () => {
  const rect = {x: 80, y: 80, width: 850, height: 750};
  const explicit = resolveEditorialModule(spec('metric', {aspect: '16:9', rect}));
  assert.deepEqual(explicit.rect, rect);
  assert.equal(explicit.density.scale, 1);
  assert.equal(explicit.density.source, 'explicit');
  assert.equal(explicit.content.numberFont, 64);
  assert.doesNotMatch(buildEditorialModule(spec('metric', {aspect: '16:9', rect})).html, /ui-density/);
});

test('16:9 default rects sit centred in the landscape title-safe zone, above the caption band, at a confident scale', () => {
  const S = SAFE_ZONE_PROFILES.landscape;
  for (const name of Object.keys(SPECS)) {
    const model = resolveEditorialModule(spec(name, {aspect: '16:9'}));
    const {rect, density} = model;
    assert.equal(density.source, 'derived', name);
    assert.ok(rect.x >= S.safeZone.x && rect.x + rect.width <= S.safeZone.x + S.safeZone.width, `${name} x inside title-safe: ${JSON.stringify(rect)}`);
    assert.ok(rect.y >= S.safeZone.y && rect.y + rect.height <= S.captionBand.y, `${name} above the caption band: ${JSON.stringify(rect)}`);
    assert.ok(Math.abs(rect.x + rect.width / 2 - 960) <= 1, `${name} centred`);
    assert.ok(Math.abs(centre(rect) - 540) <= 1080 * S.centerOfMassTolerance, `${name} centre ${centre(rect)}`);
    assert.ok(density.scale >= 1.4, `${name} scale ${density.scale}`);
    assert.ok(model.chrome.font * density.scale >= 40, `${name} body ${model.chrome.font * density.scale}px`);
    assert.ok(density.natural <= density.layout.height + .5, name);
    assert.ok(density.layout.height - Math.max(160 / density.scale, density.natural) < 1, `${name} hugs its content`);
  }
  const media = resolveEditorialModule({...base, kind: 'media-window', aspect: '16:9', title: 'Demo', media: {kind: 'image', src: 'assets/demo.png'}});
  assert.deepEqual(media.rect, {x: 360, y: 117, width: 1200, height: 723});
  assert.equal(media.density.scale, 1);
});

test('every 16:9 editorial default passes layout-check with captions on', () => {
  const kinds = {...SPECS, 'media-window': {title: 'Demo', media: {kind: 'image', src: 'assets/demo.png'}}};
  for (const [name, extra] of Object.entries(kinds)) {
    const built = buildEditorialModule({...base, kind: name.replace('-treated', ''), ...extra, aspect: '16:9'});
    const elements = [
      ...elementsFromEditorialLayout(built.layout, {id: 'mod', role: name === 'media-window' ? 'media' : 'text', start: 0, end: 4}),
      {id: 'captions', role: 'caption', rect: SAFE_ZONE_PROFILES.landscape.captionBand, start: 0, end: 4}
    ];
    const report = checkLayout({canvas: {width: 1920, height: 1080}, elements, profile: 'landscape'});
    assert.deepEqual(report.findings.filter(finding => finding.severity === 'error'), [], name);
  }
  // A grid too tall for the old 500 px box still fits above the captions.
  const grid = resolveEditorialModule(spec('audience-grid', {aspect: '16:9', audience: {columns: 3, tiles: Array.from({length: 6}, (_, i) => ({label: `Viewer ${i}`, at: .6 + i * .3}))}}));
  assert.ok(grid.rect.height > 500 && grid.rect.y + grid.rect.height <= 864);
});

test('explicit 9:16 rects keep their footprint and grow the type to fit it', () => {
  const rect = {x: 90, y: 380, width: 900, height: 620};
  const model = resolveEditorialModule(spec('metric', {aspect: '9:16', rect}));
  assert.deepEqual(model.rect, rect);
  assert.equal(model.density.source, 'explicit');
  assert.ok(model.density.scale > 1.5);
  assert.ok(model.density.natural <= model.density.layout.height + .5);
  // A tight rect only grows as far as its content allows.
  const tight = {x: 90, y: 600, width: 900, height: 230};
  const callout = resolveEditorialModule(spec('callout', {aspect: '9:16', rect: tight}));
  assert.ok(callout.density.scale >= 1 && callout.density.scale < 1.2, `scale ${callout.density.scale}`);
  assert.ok(callout.density.natural <= callout.density.layout.height + .5);
  // Errors for an explicit rect are the pre-density messages.
  assert.throws(() => resolveEditorialModule(spec('callout', {aspect: '9:16', rect: {...tight, height: 160}, body: 'word '.repeat(30)})), /callout rect too short for body/);
});

test('9:16 media-window keeps scale 1 and a 16:9 media frame centred on the target', () => {
  const model = resolveEditorialModule({...base, kind: 'media-window', aspect: '9:16', title: 'Demo', media: {kind: 'image', src: 'assets/demo.png'}});
  assert.equal(model.density.scale, 1);
  assert.deepEqual(model.rect, {x: 90, y: 620, width: 840, height: 521});
  assert.doesNotMatch(buildEditorialModule({...base, kind: 'media-window', aspect: '9:16', title: 'Demo', media: {kind: 'image', src: 'assets/demo.png'}}).html, /ui-density/);
});

test('content that only fits the legacy footprint still resolves there', () => {
  // A long code line fits the old 900 px default but not the 840 px safe-zone width.
  const line = 'x'.repeat(44);
  const model = resolveEditorialModule({...base, kind: 'code-snippet', aspect: '9:16', title: 'Long line', code: {lines: [{at: .6, tokens: [{text: line, type: 'plain'}]}]}});
  assert.equal(model.density.source, 'legacy');
  assert.deepEqual(model.rect, {x: 90, y: 960, width: 900, height: 740});
});

test('both Remotion shells wrap module content in the same density wrapper', () => {
  const shared = readFileSync(new URL('../kit/remotion/modules/shared.tsx', import.meta.url), 'utf8');
  const shellB = readFileSync(new URL('../kit/remotion/modules/shell-b.tsx', import.meta.url), 'utf8');
  assert.ok(shared.includes("className=\"ui-density\" style={{position: 'absolute', left: 0, top: 0, width: d.layout.width, height: d.layout.height, transform: `scale(${d.scale})`, transformOrigin: '0 0'}}"));
  assert.ok(shared.includes('<section id={model.id} style={style}><Density model={model}>{children}</Density></section>'));
  assert.ok(shellB.includes('<Density model={model}>{children}</Density>'));
});
