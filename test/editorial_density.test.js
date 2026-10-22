// Editorial density: content-derived default rects and the 9:16 type scale
// (kit/core/editorial-core.mjs, DENSITY). RFC §5 Shorts rules: key content in
// y 280–1450 / x 80–940, centre of mass near y 860, lower third never empty,
// key text at least 44 px.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DENSITY, resolveEditorialModule} from '../kit/core/editorial-core.mjs';
import {buildEditorialModule} from '../kit/hyperframes/editorial-ui-modules.mjs';

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

test('9:16 default rects take the safe-zone width and a content height, centred near the target', () => {
  for (const name of Object.keys(SPECS)) {
    const {rect, density} = resolveEditorialModule(spec(name, {aspect: '9:16'}));
    assert.equal(density.source, 'derived', name);
    assert.ok(rect.x >= 80 && rect.x + rect.width <= 940, `${name} x inside 80–940`);
    assert.ok(rect.y >= 280 && rect.y + rect.height <= DENSITY.portrait.captionTop, `${name} y inside 280–1190: ${JSON.stringify(rect)}`);
    assert.ok(centre(rect) > 280 + 1170 / 2 && Math.abs(centre(rect) - 860) <= 288, `${name} centre ${centre(rect)}`);
    assert.ok(rect.height < 740 && density.layout.height - Math.max(160, density.natural) < 1, `${name} hugs its content`);
  }
});

test('16:9 stays at scale 1: explicit rects are untouched, defaults hug content on the old baseline', () => {
  const rect = {x: 80, y: 80, width: 850, height: 750};
  const explicit = resolveEditorialModule(spec('metric', {aspect: '16:9', rect}));
  assert.deepEqual(explicit.rect, rect);
  assert.equal(explicit.density.scale, 1);
  assert.equal(explicit.content.numberFont, 64);
  assert.doesNotMatch(buildEditorialModule(spec('metric', {aspect: '16:9', rect})).html, /ui-density/);
  for (const name of Object.keys(SPECS)) {
    const model = resolveEditorialModule(spec(name, {aspect: '16:9'}));
    assert.equal(model.density.scale, 1, name);
    assert.equal(model.rect.x, 80, name);
    assert.equal(model.rect.width, 680, name);
    assert.equal(model.rect.y + model.rect.height, 980, `${name} bottom on y 980`);
    assert.doesNotMatch(buildEditorialModule(spec(name, {aspect: '16:9'})).html, /ui-density/, name);
  }
  // The old fixed 500 px box was too short for this grid; the derived rect fits it.
  const grid = resolveEditorialModule(spec('audience-grid', {aspect: '16:9', audience: {columns: 3, tiles: Array.from({length: 6}, (_, i) => ({label: `Viewer ${i}`, at: .6 + i * .3}))}}));
  assert.ok(grid.rect.height > 500);
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
