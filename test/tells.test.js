// Tells (docs/VIDEO_TELLS_RFC.md §1): the dated registry, one hit and one
// near miss per plan detector, and the gate on every example story.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {FRAME_TELLS, PLAN_TELLS, TELL_REGISTRY, frameTells, planTells} from '@launchclip/core/tells.mjs';
import {tellsGate} from '../src/direction_guardrails.js';

const fonts = {display: '"Anton", sans-serif', body: '"Manrope", sans-serif', meta: '"JetBrains Mono", monospace', serif: '"Instrument Serif", serif'};
const model = (extra = {}) => ({fonts, unit: 1, theme: {panel: '#1c1a17', muted: '#8a8378'}, motion: {enterEase: 'power3.out', enterFrom: {opacity: 0, y: 40}}, ...extra});
const txt = (text, style = {}) => ({tag: 'div', style: {fontFamily: fonts.body, fontSize: 40, ...style}, children: [text]});
const box = (children, style = {}, id) => ({tag: 'div', ...(id ? {id} : {}), style, children});
const scene = (id, module, start, end, extra = {}) => ({id, module, start, end, track: 0, scene: {id, module, params: {}, ...(extra.scene ?? {})}, model: model(extra.model), view: extra.view ?? null, ops: extra.ops ?? []});
const story = (extra = {}) => ({format: {width: 1080, height: 1920}, brand: {colors: {bg: '#191714', primary: '#ff6b3d', accent: '#ffb08a', paper: '#f2ede4'}, fonts: {display: 'anton', body: 'manrope', meta: 'jetbrains-mono'}}, ...extra});
const rules = (input) => planTells({story: story(), words: [], ...input}).map(f => f.rule);
const svg = {tag: 'svg', children: []};
const tween = (target, from, to, ease = 'power3.out') => ({type: 'tween', target, start: 0.2, duration: 0.4, ease, from, to});

test('the registry: every entry dated, typed and sourced; plan rules have a detector', () => {
  const ids = TELL_REGISTRY.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(TELL_REGISTRY.length >= 45);
  for (const t of TELL_REGISTRY) {
    assert.ok(['slop', 'quality'].includes(t.category), t.id);
    assert.ok(['error', 'warning', 'advisory'].includes(t.severity), t.id);
    assert.ok(['plan', 'frame', 'script'].includes(t.applies), t.id);
    assert.match(t.added, /^\d{4}-\d{2}-\d{2}$/, t.id);
    assert.equal(t.retired, null, t.id);
    assert.ok(t.fix && t.source, t.id);
    assert.ok(t.applies === 'script' || t.detector, `${t.id}: plan and frame rules have a detector`);
  }
  assert.deepEqual(TELL_REGISTRY.filter(t => t.applies === 'frame').map(t => t.id), ['accent-everywhere', 'buried-raster', 'unblended-media']);
});

// [rule, hit input, near-miss input]
const CASES = [
  ['quote-card-wide-set',
    {scenes: [scene('w', 'world', 0, 8), scene('q', 'quote-card', 2, 6)]},
    {scenes: [scene('w', 'world', 0, 8), scene('q', 'quote-card', 2, 6), scene('c', 'cast-scene', 0, 8)]}],
  ['dissolve-everywhere',
    {scenes: ['cut', 'fade', 'fade', 'fade', 'push'].map((type, i) => scene(`s${i}`, 'concept-card', i * 2, i * 2 + 2, {scene: {in: {type}}}))},
    {scenes: ['cut', 'fade', 'fade', 'push', 'push'].map((type, i) => scene(`s${i}`, 'concept-card', i * 2, i * 2 + 2, {scene: {in: {type}}}))}],
  ['centred-title-hook',
    {scenes: [scene('h', 'hook-title', 0, 3)]},
    {scenes: [scene('h', 'hook-title', 0, 3), scene('p', 'photo-scene', 0, 3)]}],
  ['fact-card-vs-caption',
    {story: story({overlays: [{type: 'captions'}]}), words: 'release notes write themselves every friday'.split(' ').map((word, i) => ({word, start: 1 + i * 0.3})), scenes: [scene('o', 'object-card', 1, 4, {scene: {params: {title: 'Release notes write themselves'}}})]},
    {story: story({overlays: [{type: 'captions'}]}), words: 'we ship on friday'.split(' ').map((word, i) => ({word, start: 1 + i * 0.3})), scenes: [scene('o', 'object-card', 1, 4, {scene: {params: {title: 'Release notes write themselves'}}})]}],
  ['identical-entrance',
    {scenes: [0, 1, 2, 3].map(i => scene(`s${i}`, 'concept-card', i, i + 1))},
    {scenes: [0, 1, 2, 3].map(i => scene(`s${i}`, 'concept-card', i, i + 1, {model: i % 2 ? {motion: {enterEase: 'expo.out', enterFrom: {opacity: 0, x: -40}}} : {}}))}],
  ['ai-palette',
    {story: story({brand: {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff'}}}), scenes: []},
    {story: story({brand: {colors: {bg: '#191714', primary: '#fdb022', accent: '#46d4ff'}}}), scenes: []}],
  ['cream-default',
    {story: story({brand: {colors: {bg: '#f4f1ea', primary: '#d97757', paper: '#f4f1ea'}, fonts: {display: 'Instrument Serif'}}}), scenes: []},
    {story: story({brand: {colors: {bg: '#f4f1ea', primary: '#2a6f97', paper: '#f4f1ea'}, fonts: {display: 'Instrument Serif'}}}), scenes: []}],
  ['gradient-text',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('Faster', {backgroundImage: 'linear-gradient(90deg, #a855f7, #3b82f6)', backgroundClip: 'text'})})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('Faster', {backgroundImage: 'linear-gradient(90deg, #a855f7, #3b82f6)'})})]}],
  ['glow',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([], {boxShadow: '0 0 24px #46d4ff99'})})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([], {boxShadow: '0 12px 24px #00000066'})})]}],
  ['radial-wash',
    {story: story({background: {kind: 'blobs', colors: ['#7c3aed', '#2563eb']}}), scenes: []},
    {story: story({background: {kind: 'blobs', colors: ['#2a2622', '#34302b']}}), scenes: []}],
  ['glass-default',
    {scenes: [scene('s', 'concept-card', 0, 3, {scene: {params: {presentation: 'glass'}}})]},
    {story: story({direction: {world: 'a glass-walled studio'}}), scenes: [scene('s', 'concept-card', 0, 3, {scene: {params: {presentation: 'glass'}}})]}],
  ['grid-stripes',
    {story: story({background: {kind: 'dot-grid'}}), scenes: []},
    {story: story({background: {kind: 'dot-grid'}, direction: {world: 'an engineering blueprint'}}), scenes: []}],
  ['chart-shades',
    {scenes: [scene('s', 'line-chart', 0, 3, {scene: {params: {series: [{label: 'a'}, {label: 'b'}]}}})]},
    {scenes: [scene('s', 'line-chart', 0, 3, {scene: {params: {series: [{label: 'a', highlight: true}, {label: 'b'}]}}})]}],
  ['gray-on-color',
    {scenes: [scene('s', 'concept-card', 0, 3, {model: {theme: {panel: '#e85d3a', muted: '#8a8378'}}, view: txt('Why it matters', {color: '#8a8378'})})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {model: {theme: {panel: '#e85d3a', muted: '#8a8378'}}, view: txt('Why it matters', {color: '#5a1c0c'})})]}],
  ['ghost-card',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([], {border: '1px solid #ffffff22', boxShadow: '0 20px 60px #00000055'})})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([], {border: '1px solid #ffffff22'})})]}],
  ['hard-offset-shadow',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([], {boxShadow: '6px 6px 0 #000000'})})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([], {boxShadow: '6px 6px 12px #000000'})})]}],
  ['overused-font',
    {scenes: [scene('s', 'quote-card', 0, 3, {view: txt('A quote', {fontFamily: fonts.serif})})]},
    {story: story({brand: {colors: {}, fonts: {serif: 'Instrument Serif'}}}), scenes: [scene('s', 'quote-card', 0, 3, {view: txt('A quote', {fontFamily: fonts.serif})})]}],
  ['kicker',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([txt('CHAPTER 2', {fontSize: 26, letterSpacing: '0.14em'}), txt('The cache fix', {fontSize: 96})])})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([txt('Chapter 2', {fontSize: 26}), txt('The cache fix', {fontSize: 96})])})]}],
  ['numbered-labels',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('01 Faster builds')})]},
    {scenes: [scene('s', 'step-rail', 0, 3, {view: txt('01 Faster builds')})]}],
  ['tracked-caps',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('BUILT FOR SMALL TEAMS', {letterSpacing: '0.12em'})})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('Built for small teams', {letterSpacing: '0.12em'})})]}],
  ['accent-word',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: {tag: 'div', style: {fontSize: 96, color: '#f2ede4'}, children: ['Ship ', {tag: 'span', style: {color: '#ff6b3d'}, children: ['faster']}]}})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: {tag: 'div', style: {fontSize: 96, color: '#f2ede4'}, children: ['Ship faster']}})]}],
  ['italic-serif-hook',
    {scenes: [scene('s', 'hook-title', 0, 3, {view: txt('Slow builds', {fontFamily: '"Instrument Serif", serif', fontStyle: 'italic', fontSize: 120})})]},
    {scenes: [scene('s', 'hook-title', 0, 3, {view: txt('Slow builds', {fontFamily: '"Instrument Serif", serif', fontSize: 120})})]}],
  ['flat-hierarchy',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([txt('Title', {fontSize: 60}), txt('Body line', {fontSize: 54})])})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([txt('Title', {fontSize: 96}), txt('Body line', {fontSize: 54})])})]}],
  ['crushed-tracking',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('Tight', {letterSpacing: '-0.06em'})})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('Tight', {letterSpacing: '-0.02em'})})]}],
  ['mono-costume',
    {scenes: [scene('s', 'stat-card', 0, 3, {view: txt('Source: quarterly review', {fontFamily: fonts.meta})})]},
    {scenes: [scene('s', 'stat-card', 0, 3, {view: txt('48,210', {fontFamily: fonts.meta})})]}],
  ['oversized-headline',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('We cut our build time in half last quarter', {fontFamily: fonts.display, fontSize: 140})})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('Builds, halved', {fontFamily: fonts.display, fontSize: 140})})]}],
  ['straggler',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('one two three four five six seven', {whiteSpace: 'normal', width: 200, fontSize: 40})})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('one two three four five six', {whiteSpace: 'normal', width: 200, fontSize: 40})})]}],
  ['caps-body',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('EVERY BUILD NOW RUNS ITS TESTS IN FOUR PARALLEL SHARDS SO THE WAIT IS SHORT')})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: txt('Every build now runs its tests in four parallel shards so the wait is short')})]}],
  ['mixed-number-format',
    {scenes: [scene('a', 'stat-card', 0, 3, {scene: {params: {value: '$48,210'}}}), scene('b', 'stat-card', 3, 6, {scene: {params: {value: '$124,860.40'}}})]},
    {scenes: [scene('a', 'stat-card', 0, 3, {scene: {params: {value: '$48,210'}}}), scene('b', 'stat-card', 3, 6, {scene: {params: {value: '$124,860'}}})]}],
  ['hero-metric',
    {scenes: [scene('a', 'stat-card', 0, 3), scene('b', 'concept-card', 3, 6), scene('c', 'odometer', 6, 9)]},
    {scenes: [scene('a', 'concept-card', 0, 3), scene('b', 'stat-card', 3, 6), scene('p', 'photo-scene', 3, 6), scene('c', 'odometer', 6, 9)]}],
  ['card-grid',
    {scenes: [scene('s', 'icon-row', 0, 3, {view: box([0, 1, 2].map(() => box([svg, txt('Title'), txt('Line')], {width: 300, height: 400})))})]},
    {scenes: [scene('s', 'icon-row', 0, 3, {view: box([0, 1, 2].map(i => box([svg, txt('Title'), txt('Line')], {width: 300 + i * 80, height: 400})))})]}],
  ['icon-tile',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([box([svg], {background: '#ff6b3d', borderRadius: 24}), txt('Headline')])})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([box([svg], {}), txt('Headline')])})]}],
  // The pilot's chips: two boxed panels on the flat brand plate; the near miss is the same chips over footage.
  ['boxed-on-flat',
    {scenes: [scene('s', 'compare', 0, 3, {view: box([box([txt('Cheap'), txt('Weekend brush')], {background: '#e5fcfc', borderRadius: 28}), box([txt('Dearer'), txt('Pay once')], {border: '2px solid #ccc', borderRadius: 28})])})]},
    {scenes: [scene('b', 'clip', 0, 3), scene('s', 'compare', 0, 3, {view: box([box([txt('Cheap'), txt('Weekend brush')], {background: '#e5fcfc', borderRadius: 28}), box([txt('Dearer'), txt('Pay once')], {border: '2px solid #ccc', borderRadius: 28})])})]}],
  ['stock-icon',
    {scenes: [scene('s', 'concept-card', 0, 3, {scene: {params: {text: 'All about upkeep', icon: 'layers'}}})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {scene: {params: {text: 'Three layers of oil', icon: 'layers'}}})]}],
  ['caption-echoes-headline',
    {story: story({overlays: [{type: 'captions'}]}), words: 'composite is wood fibre and plastic'.split(' ').map((word, i) => ({word, start: 1 + i * 0.3})), scenes: [scene('s', 'clip', 1, 4, {scene: {params: {title: 'Wood fibre + plastic blend'}}})]},
    {story: story({overlays: [{type: 'captions'}]}), words: 'composite never needs oiling'.split(' ').map((word, i) => ({word, start: 1 + i * 0.3})), scenes: [scene('s', 'clip', 1, 4, {scene: {params: {title: 'Wood fibre + plastic blend'}}})]}],
  ['emoji-icons',
    {scenes: [scene('s', 'icon-row', 0, 3, {scene: {params: {items: ['🚀 Launch']}}})]},
    {scenes: [scene('s', 'icon-row', 0, 3, {scene: {params: {items: ['Launch']}}})]}],
  ['decorative-chrome',
    {scenes: [scene('s', 'sparkline', 0, 3)]},
    {scenes: [scene('s', 'sparkline', 0, 3, {scene: {params: {source: 'Grafana, Oct 2026'}}})]}],
  ['pulsing-dot',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([], {width: 20, height: 20}, 's-dot'), ops: [{type: 'loop', target: 's-dot', start: 0, cycle: 1, from: {opacity: 1}, to: {opacity: 0.3}}]})]},
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([], {width: 20, height: 20}, 's-dot')})]}],
  ['blinking-cursor',
    {scenes: [scene('s', 'concept-card', 0, 3, {view: box([], {}, 's-caret')})]},
    {scenes: [scene('s', 'code-snippet', 0, 3, {view: box([], {}, 's-caret')})]}],
  ['marquee',
    {scenes: [scene('s', 'ticker-tape', 0, 3)]},
    {scenes: [scene('s', 'item-list', 0, 3)]}],
  ['bounce',
    {scenes: [scene('s', 'concept-card', 0, 3, {ops: [tween('s-a', {opacity: 0}, {opacity: 1}, 'back.out(1.7)')]})]},
    {story: story({motion: {grammar: 'playful'}}), scenes: [scene('s', 'concept-card', 0, 3, {ops: [tween('s-a', {opacity: 0}, {opacity: 1}, 'back.out(1.7)')]})]}],
  ['clipart',
    {scenes: [scene('s', 'custom', 0, 3, {scene: {params: {rect: {x: 0, y: 0, width: 1000, height: 1000}}}})]},
    {scenes: [scene('s', 'custom', 0, 3, {scene: {params: {rect: {x: 0, y: 0, width: 300, height: 300}}}})]}],
  ['ai-stock-imagery',
    {scenes: [scene('s', 'photo-scene', 0, 3, {scene: {params: {prompt: 'a glowing brain made of circuits'}}})]},
    {scenes: [scene('s', 'photo-scene', 0, 3, {scene: {params: {prompt: 'a release notes page on a laptop'}}})]}],
  ['baked-text',
    {scenes: [scene('s', 'photo-scene', 0, 3, {scene: {params: {prompt: 'a poster that says "Ship it"'}}})]},
    {scenes: [scene('s', 'photo-scene', 0, 3, {scene: {params: {prompt: 'a blank poster on a wall'}}})]}],
  ['organic-mask',
    {scenes: [scene('s', 'photo-scene', 0, 3, {view: box([], {clipPath: `polygon(${Array.from({length: 16}, (_, i) => `${i}% ${i * 2}%`).join(', ')})`})})]},
    {scenes: [scene('s', 'photo-scene', 0, 3, {view: box([], {clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)'})})]}],
  ['hero-missing',
    {story: story({direction: {product: 'x'}}), scenes: [scene('a', 'concept-card', 0, 3, {scene: {hero: 'a.title'}}), scene('b', 'concept-card', 3, 6)]},
    {story: story({direction: {product: 'x'}}), scenes: [scene('a', 'concept-card', 0, 3, {scene: {hero: 'a.title'}}), scene('b', 'concept-card', 3, 6, {scene: {hero: 'b.chart'}})]}],
  ['signature-thin',
    {story: story({direction: {signature: {detail: 'a stopwatch hand', element: 'stopwatch'}}}), scenes: [scene('a', 'concept-card', 0, 3, {scene: {params: {icon: 'stopwatch'}}}), scene('b', 'concept-card', 3, 6, {scene: {params: {icon: 'stopwatches'}}}), scene('c', 'concept-card', 6, 9)]},
    {story: story({direction: {signature: {detail: 'a stopwatch hand', element: 'stopwatch'}}}), scenes: [scene('a', 'concept-card', 0, 3, {scene: {params: {icon: 'stopwatch'}}}), scene('b', 'concept-card', 3, 6, {scene: {hero: 'stopwatch'}}), scene('c', 'concept-card', 6, 9, {view: box([], {}, 'stopwatch')})]}]
];

test('every plan detector has a hit and a near miss', () => {
  assert.deepEqual(CASES.map(([id]) => id).sort(), PLAN_TELLS.map(t => t.id).sort(), 'a case for every plan rule');
  for (const [id, hit, miss] of CASES) {
    assert.ok(rules(hit).includes(id), `${id} fires on its hit: ${JSON.stringify(planTells({story: story(), words: [], ...hit}))}`);
    assert.ok(!rules(miss).includes(id), `${id} stays quiet on its near miss`);
  }
});

test('a finding ends in its fix and carries the date the tell was added', () => {
  const finding = planTells({story: story(), scenes: CASES.find(([id]) => id === 'bounce')[1].scenes}).find(f => f.rule === 'bounce');
  assert.equal(finding.rule, 'bounce');
  assert.equal(finding.severity, 'error');
  assert.equal(finding.added, '2026-11-16');
  assert.match(finding.detail, /back\.out\(1\.7\); expo or quart out/);
});

const examples = readdirSync('examples/story').filter(name => existsSync(`examples/story/${name}/storyboard.json`));
const example = (name, change = raw => raw) => {
  const file = `examples/story/${name}/NARRATION.json`;
  const narration = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const words = Array.isArray(narration) ? narration : narration.words ?? [];
  return {story: resolveStory(change(JSON.parse(readFileSync(`examples/story/${name}/storyboard.json`, 'utf8'))), {words}), words};
};

test('calibration: every example story passes the tells gate (no errors)', () => {
  assert.ok(examples.length > 30);
  for (const name of examples) {
    const {story: resolved, words} = example(name);
    const gate = tellsGate(resolved, {words});
    assert.equal(gate.status, 'passed', `${name}: ${JSON.stringify(gate.findings.filter(f => f.severity === 'error'))}`);
  }
});

test('the gate reads the resolved story: an emoji in a planned card fails it', () => {
  const {story: resolved, words} = example('vocabulary', raw => ({...raw, scenes: raw.scenes.map(s => (s.module === 'icon-row' ? {...s, params: {...s.params, items: (s.params.items ?? []).map((item, i) => (i ? item : typeof item === 'string' ? `🚀 ${item}` : {...item, label: `🚀 ${item.label}`}))}} : s))}));
  const gate = tellsGate(resolved, {words});
  assert.equal(gate.status, 'failed');
  assert.equal(gate.findings[0].rule, 'emoji-icons');
});

// Frame rules: synthetic frames, one hit and one near miss each.
const image = (width, height, paint) => {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const [r, g, b] = paint(x, y); pixels.set([r, g, b, 255], (y * width + x) * 4); }
  return {width, height, pixels};
};
const ground = [25, 23, 20], peach = [255, 176, 138];
const accentFrame = (share) => image(100, 100, (x) => (x < share * 100 ? peach : ground));
// A media window at (30,30) 40×40 on the ground: a hard edge and a lifted black, or a soft edge into the ground.
const mediaFrame = (blended) => image(100, 100, (x, y) => {
  if (x < 30 || x >= 70 || y < 30 || y >= 70) return ground;
  if (blended) { const d = Math.min(x - 30, 69 - x, y - 30, 69 - y); return d < 8 ? ground : (x + y) % 2 ? [200, 200, 200] : ground; }
  return (x + y) % 2 ? [220, 220, 220] : [90, 90, 90];
});
const FRAME_CASES = [
  ['accent-everywhere',
    {frames: [{id: 's1', at: 1, image: accentFrame(0.3)}]},
    {frames: [{id: 's1', at: 1, image: accentFrame(0.05)}]}],
  ['buried-raster',
    {plates: [{id: 'plate', at: 0, path: 'plate', dim: 0.9, raw: 0.2, dimmed: 0.002, minimum: 0.01}]},
    {plates: [{id: 'plate', at: 0, path: 'plate', dim: 0.9, raw: 0.2, dimmed: 0.03, minimum: 0.01}]}],
  ['unblended-media',
    {media: [{id: 's2-media', at: 2, rect: {x: 30, y: 30, width: 40, height: 40}, image: mediaFrame(false)}]},
    {media: [{id: 's2-media', at: 2, rect: {x: 30, y: 30, width: 40, height: 40}, image: mediaFrame(true)}]}]
];
const frameRules = (input) => frameTells({story: story(), ...input}).map(f => f.rule);

test('every frame detector has a hit and a near miss', () => {
  assert.deepEqual(FRAME_CASES.map(([id]) => id).sort(), FRAME_TELLS.map(t => t.id).sort(), 'a case for every frame rule');
  for (const [id, hit, miss] of FRAME_CASES) {
    assert.ok(frameRules(hit).includes(id), `${id} fires on its hit: ${JSON.stringify(frameTells({story: story(), ...hit}))}`);
    assert.ok(!frameRules(miss).includes(id), `${id} stays quiet on its near miss`);
  }
});

test('accent-everywhere: a direction moment may be rich, and an accent that is the ground never fires', () => {
  const frames = [{id: 's1', at: 1, image: accentFrame(0.3)}];
  assert.deepEqual(frameRules({story: story({direction: {moments: ['s1']}}), frames}), []);
  assert.deepEqual(frameTells({story: story({brand: {colors: {bg: '#ffb08a', accent: '#ffb08a'}}}), frames}), []);
});
