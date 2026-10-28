// Catalogue H map-highlight (kit/core/catalog-h-map.mjs) and the vendored
// world (kit/core/world-110m.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {COUNTRIES, WORLD_SIZE} from '@launchclip/core/world-110m.mjs';
import {countryId, projectLonLat} from '@launchclip/core/catalog-h-map.mjs';
import {equalEarth, unwrapRing} from '../scripts/vendor-world.mjs';
import {EXTRA_SAMPLES, SAMPLES} from '../scripts/element-samples.mjs';

const equalEarthY0 = () => Math.round(WORLD_SIZE.height / 2 * 100) / 100;

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (params, aspect = '16:9') => ({...MODULES['map-highlight'].resolve(params, {id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand, aspect, hits: []}), module: 'map-highlight'});

test('the vendored world: 177 countries in the box, Equal Earth, antimeridian unwrapped', () => {
  assert.equal(Object.keys(COUNTRIES).length, 177);
  for (const [id, c] of Object.entries(COUNTRIES)) {
    assert.match(c.d, /^M[\d. MZ-]+Z$/, id);
    const [x0, y0, x1, y1] = c.b;
    assert.ok(x0 >= -60 && x1 <= WORLD_SIZE.width + 60 && y0 >= 0 && y1 <= WORLD_SIZE.height + 1 && x0 < x1 && y0 < y1, `${id} bounds ${c.b}`);
  }
  assert.deepEqual(equalEarth(0, 0), [0, 0]);
  // A ring crossing 180° stays continuous; a ring round the pole is untouched.
  assert.deepEqual(unwrapRing([[179, 60], [-179, 60], [-179, 62], [179, 62]]).map(p => p[0]), [179, 181, 181, 179]);
  const pole = [[-180, -80], [0, -80], [180, -80], [180, -90], [-180, -90]];
  assert.deepEqual(unwrapRing(pole), pole);
  // Russia no longer stretches across the whole map.
  assert.ok(COUNTRIES['643'].b[2] - COUNTRIES['643'].b[0] < WORLD_SIZE.width * 0.6);
});

test('countries resolve by name, alias or ISO code', () => {
  assert.equal(countryId('France'), '250');
  assert.equal(countryId('united states'), '840');
  assert.equal(countryId('USA'), '840');
  assert.equal(countryId('UK'), '826');
  assert.equal(countryId('Côte d\'Ivoire'), '384');
  assert.equal(countryId(76), '076');
  assert.equal(countryId('Atlantis'), null);
  assert.throws(() => resolve({highlight: ['Atlantis']}), /not a country on the map/);
  assert.throws(() => resolve({highlight: ['France', 'france']}), /same country twice/);
});

test('close countries zoom in, far ones keep the world; highlights fill in order', () => {
  for (const variant of VARIANTS['map-highlight']) for (const aspect of ['9:16', '16:9']) {
    const model = resolve({...SAMPLES['map-highlight'], variant}, aspect);
    assert.doesNotMatch(EMITTERS['map-highlight'](model).html + EMITTERS['map-highlight'](model).motion, /undefined|NaN/);
    assert.ok(model.content.zoom && model.content.zoom.k > 1.4, `${variant} ${aspect} zooms to Europe`);
    const state = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
    assert.equal(state.get('scene-world').scaleX, model.content.zoom.k);
    model.content.marks.forEach((m, i) => {
      if (variant === 'outline') assert.equal(state.get(`scene-country-${i}`).strokeDashoffset, 0);
      else assert.equal(state.get(`scene-country-${i}`).opacity, 1);
      // The label stays inside the map box.
      const B = model.content.box;
      assert.ok(m.pill.x >= B.x - 1e-6 && m.pill.x + m.pill.w <= B.x + B.width + 1e-6 && m.pill.y >= B.y - 1e-6 && m.pill.y + m.pill.h <= B.y + B.height + 1e-6, `${m.name} label`);
    });
    const times = model.content.marks.map(m => m.time);
    assert.ok(times.every((t, i) => !i || t > times[i - 1]));
  }
  const world = resolve({highlight: ['USA', 'Brazil', 'India', 'Australia']});
  assert.equal(world.content.zoom, null);
  assert.equal(resolve({highlight: ['France', 'Spain'], focus: 'world'}).content.zoom, null);
});

test('pins land by longitude and latitude, a route joins them, cards and badges follow', () => {
  const extra = name => EXTRA_SAMPLES.find(e => e.name === name);
  const route = extra('map-highlight-route');
  const model = resolve({...route.params, variant: route.variant});
  const c = model.content;
  const [x0, y0] = projectLonLat(0, 0);
  assert.ok(x0 === 500 && Math.abs(y0 - equalEarthY0()) < 0.02, 'the equator crosses the middle');
  assert.ok(c.zoom && c.zoom.k > 2, 'three nearby cities zoom in');
  assert.deepEqual(model.events.filter(e => /^(pin|route)-/.test(e.name)).map(e => e.name).sort(), ['pin-0', 'pin-1', 'pin-2', 'route-0', 'route-1']);
  assert.ok(c.pins[0].px < c.pins[2].px, 'Austin sits west of New York');
  const B = c.box;
  for (const pin of c.pins) assert.ok(pin.px >= B.x && pin.px <= B.x + B.width && pin.py >= B.y && pin.py <= B.y + B.height);
  const card = c.pins[2].card;
  assert.ok(card.x >= B.x && card.x + card.w <= B.x + B.width, 'the card stays on the map');
  const state = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
  assert.equal(state.get('scene-rm-1').strokeDashoffset, 0, 'the route is drawn');
  assert.equal(state.get('scene-card-2').opacity, 1);
  const html = EMITTERS['map-highlight'](model).html;
  assert.match(html, /maskUnits="userSpaceOnUse"/, 'mask attributes keep their case in HTML');
  // Dots: the land as a dot matrix, the highlighted countries' own dots lit; badges after the labels.
  const dots = resolve({...extra('map-highlight-dots').params, variant: 'dots'});
  assert.ok(dots.content.matrix.rest.length > 1000 && dots.content.matrix.lit.every(d => d.startsWith('M')));
  const lit = frameState(catalogHTimeline(dots), dots.motion.exitStart - 0.01);
  assert.equal(lit.get('scene-badge-1').opacity, 1);
  // Outline: the country traces itself.
  const outline = resolve({...extra('map-highlight-outline').params, variant: 'outline'});
  assert.equal(frameState(catalogHTimeline(outline), outline.motion.exitStart - 0.01).get('scene-country-0').strokeDashoffset, 0);
  assert.throws(() => resolve({}), /needs highlight \(countries\) or pins \(places\)/);
  assert.throws(() => resolve({pins: [{lon: 0, lat: 0, label: 'A'}], route: true}), /route needs at least two pins/);
  assert.throws(() => resolve({pins: [{lon: 200, lat: 0, label: 'A'}]}), /params\.pins\[0\]\.lon/);
});
