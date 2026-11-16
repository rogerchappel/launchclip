// Catalogue H map-highlight (kit/core/catalog-h-map.mjs) and the vendored
// world (kit/core/world-110m.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {COUNTRIES, WORLD_SIZE} from '@launchclip/core/world-110m.mjs';
import {ROUTE_HEAD, countryId, projectLonLat} from '@launchclip/core/catalog-h-map.mjs';
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

// Maps that travel (RFC §E.5): the journey route, arrivals and the camera.
const journey = (name, aspect) => {
  const sample = EXTRA_SAMPLES.find(e => e.name === name);
  return {...MODULES['map-highlight'].resolve({...sample.params, variant: sample.variant}, {id: 'scene', start: 1, duration: sample.duration, format: FORMATS[aspect], brand, aspect, hits: []}), module: 'map-highlight'};
};

test('a journey: countries light in arc-length order with constant sequences; pins land as the route reaches them', () => {
  for (const [name, aspect] of [['map-highlight-journey', '16:9'], ['map-highlight-journey-portrait', '9:16']]) {
    const model = journey(name, aspect);
    const c = model.content, T = c.travel;
    const stops = c.marks.map(m => m.stop), times = c.marks.map(m => m.time);
    assert.deepEqual([...stops].sort((a, b) => a - b), stops, 'arrivals follow the route');
    assert.deepEqual([...times].sort((a, b) => a - b), times);
    const ops = catalogHTimeline(model);
    const draws = ops.filter(op => op.type === 'tween' && /-(country|border)-\d+$/.test(op.target) && op.to?.strokeDashoffset === 0);
    assert.ok(draws.length === c.marks.length && draws.every(op => op.duration === 1.6), 'every border draws over 1.6 s');
    for (const [i, leg] of T.legs.entries()) assert.ok(Math.abs(c.pins[i + 1].time - (leg.time + leg.duration - 0.15)) < 1e-6, `pin ${i + 1} lands with its leg`);
    // The head travels with the drawn route and fades once it completes.
    const mid = T.legs[1].time + T.legs[1].duration / 2;
    const at = frameState(ops, mid);
    assert.ok(Math.abs((1 - at.get('scene-jm').strokeDashoffset) - (ROUTE_HEAD - at.get('scene-core').strokeDashoffset)) < 1e-6);
    assert.equal(at.get('scene-core').opacity, 1);
    assert.equal(frameState(ops, T.routeEnd + 0.6).get('scene-core').opacity, 0);
    const html = EMITTERS['map-highlight'](model).html + EMITTERS['map-highlight'](model).motion;
    assert.doesNotMatch(html, /undefined|NaN/);
  }
});

test('the map camera never overshoots, and pinned labels ride with the map', () => {
  for (const [name, aspect] of [['map-highlight-journey', '16:9'], ['map-highlight-camera', '16:9']]) {
    const model = journey(name, aspect);
    const c = model.content, T = c.travel;
    const ops = catalogHTimeline(model);
    for (const seg of T.segments) {
      assert.ok(['power2.inOut', 'power3.inOut', 'power2.out'].includes(seg.ease));
      for (let f = 0; f <= 20; f++) {
        const w = frameState(ops, seg.start + seg.duration * f / 20 + 1e-4).get('scene-world');
        for (const [key, prop] of [['x', 'x'], ['y', 'y'], ['k', 'scaleX']]) {
          const [lo, hi] = [Math.min(seg.from[key], seg.to[key]), Math.max(seg.from[key], seg.to[key])];
          assert.ok(w[prop] >= lo - 1e-6 && w[prop] <= hi + 1e-6, `${name} ${prop} stays between its keys at ${f}/20`);
        }
      }
    }
    // A label anchored to a place stays on it while the camera moves.
    for (let t = model.start; t < model.start + model.duration - 0.6; t += 0.37) {
      const state = frameState(ops, t);
      const w = state.get('scene-world');
      c.marks.forEach((m, i) => {
        const a = state.get(`scene-anchor-m${i}`);
        const [wx, wy] = COUNTRIES[m.id].c;
        const want = [c.box.x + c.origin.x + w.x + wx * c.s * w.scaleX, c.box.y + c.origin.y + w.y + wy * c.s * w.scaleY];
        assert.ok(Math.abs(m.px + a.x - want[0]) < 1 && Math.abs(m.py + a.y - want[1]) < 1, `${name} ${m.name} at ${t.toFixed(2)} s`);
      });
    }
  }
  assert.throws(() => resolve({pins: [{lon: 0, lat: 0, label: 'A'}, {lon: 10, lat: 5, label: 'B'}], route: true, camera: 'follow'}), /"follow" needs a journey route/);
  assert.throws(() => resolve({highlight: [{country: 'France', arrive: 'route'}]}), /arrive "route" needs a journey route/);
  assert.throws(() => resolve({...EXTRA_SAMPLES.find(e => e.name === 'map-highlight-journey').params}), /the journey needs [\d.]+ s/);
});
