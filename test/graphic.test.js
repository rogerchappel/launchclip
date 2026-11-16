// Planner-drawn graphics (kit/core/graphic.mjs, docs/FLUID_MOTION_RFC.md §10):
// the closed spec list, text that fits, the shared painter, and the members
// of node-graph and icon-grid it stands in for.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {makeCheck} from '@launchclip/core/catalog-b-base.mjs';
import {BEYOND, GRAPHIC_KINDS, fitGraphic, graphicNodes, graphicSpec} from '@launchclip/core/graphic.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (module, params, aspect = '9:16') => ({...MODULES[module].resolve(params, {id: 's', start: 0, duration: 10, format: FORMATS[aspect], brand, aspect, hits: []}), module});
const check = makeCheck('');
const spec = raw => graphicSpec(check, raw, 'graphic');
const ALL = [
  {kind: 'card', icon: 'croissant', label: 'Baker', badge: '3'},
  {kind: 'chip', icon: 'timer', label: 'Proofing'},
  {kind: 'badge', icon: 'flame', label: 'Oven'},
  {kind: 'ribbon', icon: 'star', label: 'Fresh'},
  {kind: 'prop', prop: 'bread', label: 'Loaves'},
  {kind: 'badge', text: '24'}
];
const ids = node => [node.id, ...(Array.isArray(node.children) ? node.children : []).flatMap(child => typeof child === 'object' ? ids(child) : [])].filter(Boolean);
const texts = node => (Array.isArray(node.children) ? node.children : []).flatMap(child => typeof child === 'string' ? [child] : texts(child));

test('graphic: the closed list, and errors that say what to change', () => {
  assert.deepEqual(GRAPHIC_KINDS, ['card', 'chip', 'badge', 'ribbon', 'prop']);
  for (const raw of ALL) assert.equal(spec(raw).kind, raw.kind);
  const fails = [
    [{icon: 'star'}, /graphic.kind is required/],
    [{kind: 'blob'}, /kind must be one of card, chip, badge, ribbon, prop/],
    [{kind: 'card'}, /a card needs icon or label/],
    [{kind: 'chip', icon: 'star'}, /a chip needs label/],
    [{kind: 'card', icon: 'chefhat'}, /icon must be an icon name.*did you mean/],
    [{kind: 'prop', prop: 'oven'}, /prop must be a world-kit prop \(laptop/],
    [{kind: 'prop', prop: 'mug', state: 'open'}, /mug has no states/],
    [{kind: 'badge', text: '1234'}, /text must be a string of 1–3/],
    [{kind: 'badge', icon: 'flame', text: '1'}, /an icon or text, not both/],
    [{kind: 'card', label: 'Hi', html: '<b>hi</b>'}, /html is not supported \(allowed: kind, icon, label, badge\)/],
    [{kind: 'chip', label: '<script>'}, /angle brackets/],
    ['card', /must be a graphic/]
  ];
  for (const [raw, message] of fails) assert.throws(() => spec(raw), message, JSON.stringify(raw));
});

test('graphic: past the closed list, the error names the module that draws it, or says none does yet', () => {
  const fails = [
    [{kind: 'bar-chart'}, /kind must be one of card, chip, badge, ribbon, prop, got "bar-chart": the list is closed, and that is the bar-chart module's job/],
    [{kind: 'arrows'}, /the callout-arrow module's job/],
    [{kind: 'images', label: 'x'}, /the photo-scene module's job/],
    [{kind: 'hexagon'}, /no catalogue module draws that yet/],
    [{kind: 'card', label: 'Baker', detail: 'Starts at 4am'}, /graphic.detail is not supported \(allowed: kind, icon, label, badge\): the list is closed, and that is the concept-card module's job/],
    [{kind: 'chip', label: 'Hot', progress: 0.4}, /the progress module's job/],
    [{kind: 'card', label: 'Baker', color: '#f00'}, /graphic.color .*no catalogue module draws that yet/],
    [{kind: 'card', label: 'Baker', x: 120}, /the module lays out its members; no module takes free positions/],
    [{kind: 'card', label: 'Team', children: [{kind: 'chip', label: 'a'}]}, /graphic.children must be plain text or a name, not a list: graphics do not nest.*icon-grid, node-graph/],
    [{kind: 'card', label: {kind: 'chip', label: 'a'}}, /graphic.label must be plain text or a name, not an object: graphics do not nest/],
    [{kind: 'prop', prop: 'mug', icon: 'star'}, /graphic.icon is not supported \(allowed: kind, prop, state, label\): icon belongs on a card or chip or badge or ribbon/]
  ];
  for (const [raw, message] of fails) assert.throws(() => spec(raw), message, JSON.stringify(raw));
  const known = new Set(knownModules());
  for (const module of Object.values(BEYOND).filter(Boolean)) assert.ok(known.has(module), `${module} is a catalogue module`);
});

test('graphic: text that fits, or a validation error', () => {
  const chip = spec({kind: 'chip', icon: 'timer', label: 'Proofing'});
  assert.equal(fitGraphic(check, 'g', chip, 1000, {preferred: 32, min: 20}), 32);
  const tight = fitGraphic(check, 'g', chip, 200, {preferred: 32, min: 10});
  assert.ok(tight < 32 && tight >= 10);
  assert.throws(() => fitGraphic(check, 'g', chip, 120, {preferred: 32, min: 24}), /g.label does not fit 120px at 24px type; shorten it/);
});

test('graphic: the painter draws each kind in the palette and type it is given', () => {
  const look = {color: '#46d4ff', ink: '#06070d', fg: '#f2eee6', panel: '#14151a', fonts: {body: 'Body'}, unit: 1, icon: 66, labelSize: 32, colors: brand.colors, key: 'g'};
  for (const raw of ALL) {
    const nodes = graphicNodes(spec(raw), 250, 178, look);
    const tree = {children: nodes};
    const words = texts(tree);
    if (raw.label) assert.ok(words.includes(raw.label), `${raw.kind} shows its label`);
    if (raw.badge || raw.text) assert.ok(words.includes(raw.badge ?? raw.text), `${raw.kind} shows its short text`);
    const json = JSON.stringify(nodes);
    if (raw.icon) assert.match(json, /"tag":"svg".*"viewBox":"0 0 24 24"/, `${raw.kind} draws its icon`);
    if (raw.kind !== 'prop') assert.match(json, /#46d4ff/, `${raw.kind} uses the member colour`);
    if (raw.label) assert.match(json, /"fontFamily":"Body"/);
  }
  // The card's `over` nodes sit on the face, under the icon (node-graph's lit rim).
  const over = {tag: 'div', id: 'lit', children: []};
  const card = graphicNodes(spec(ALL[0]), 250, 178, {...look, over: [over]});
  assert.equal(card[1], over);
});

test('node-graph: a graphic stands in for any node and joins the flock, wires and idle', () => {
  const nodes = ALL.map(graphic => ({graphic}));
  for (const aspect of ['9:16', '16:9']) {
    const model = resolve('node-graph', {hub: {label: 'Head chef', icon: 'chef-hat'}, nodes}, aspect);
    assert.deepEqual(model.content.nodes.map(n => n.graphic.kind), ALL.map(g => g.kind));
    const all = ids(catalogHView(model));
    const ops = catalogHTimeline(model);
    for (const n of model.content.nodes) {
      for (const part of ['', '-idle', '-lit']) assert.ok(all.includes(`s-node-${n.id}${part}`), `${aspect} ${n.id}${part}`);
      assert.ok(ops.some(op => op.target === `s-node-${n.id}-idle` && op.type === 'tween'), `${n.id} breathes`);
    }
    assert.ok(model.content.card.width >= 0);
  }
  // A plain node and a graphic mix; a graphic replaces label and icon.
  const mixed = resolve('node-graph', {hub: 'Lead', nodes: ['Research', {label: 'Voice', icon: 'mic'}, {graphic: ALL[1]}]});
  assert.deepEqual(mixed.content.nodes.map(n => n.graphic.kind), ['card', 'card', 'chip']);
  assert.throws(() => resolve('node-graph', {hub: 'Lead', nodes: ['A', 'B', {label: 'C', graphic: ALL[1]}]}), /nodes\[2\].graphic replaces label and icon/);
  assert.throws(() => resolve('node-graph', {hub: 'Lead', nodes: ['A', 'B', {id: 'c'}]}), /nodes\[2\].label is required/);
  assert.throws(() => resolve('node-graph', {hub: 'Lead', nodes: ['A', 'B', {graphic: {kind: 'card', icon: 'nope'}}]}), /nodes\[2\].graphic.icon must be an icon name/);
});

test('icon-grid: a graphic stands in for an item, sized to its cell, and flocks and breathes with the rest', () => {
  for (const aspect of ['9:16', '16:9']) {
    const model = resolve('icon-grid', {title: 'The morning shift', items: [...ALL.map(graphic => ({graphic})), {icon: 'coffee', label: 'Coffee'}]}, aspect);
    const c = model.content;
    for (const cell of c.cells.filter(cell => cell.graphic)) {
      assert.ok(cell.gw <= c.cellW - 16 * model.unit + 1e-6 && cell.gh <= c.cellH, `${aspect} ${cell.graphic.kind} inside its cell`);
      assert.ok(cell.gL >= 26 * model.unit, `${aspect} label size ${cell.gL}`);
    }
    const all = ids(catalogHView(model));
    const ops = catalogHTimeline(model);
    c.cells.forEach((_, i) => {
      assert.ok(all.includes(`s-cell-${i}-idle`));
      assert.ok(ops.some(op => op.target === `s-cell-${i}-idle` && op.type === 'tween'), `cell ${i} breathes`);
    });
  }
  assert.throws(() => resolve('icon-grid', {items: ['star', {icon: 'star', graphic: ALL[0]}]}), /items\[1\].graphic replaces icon and label/);
  assert.throws(() => resolve('icon-grid', {columns: 6, items: Array.from({length: 6}, () => ({graphic: {kind: 'ribbon', label: 'A very long label!!'}}))}, '9:16'), /does not fit/);
});
