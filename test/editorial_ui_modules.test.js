import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {buildEditorialModule} from '../skills/launchclip-create-video/scripts/editorial-ui-modules.mjs';

const base = {id: 'learn', kind: 'checklist', aspect: '16:9', start: 70, duration: 28, title: 'What you will learn', rect: {x: 70, y: 130, width: 850, height: 820}};
const row = {label: 'Engineering principles', status: 'active', at: 2.79, doneAt: 6.72};
function commands(result) {
  const calls = [];
  runInNewContext(result.motion, {tl: {fromTo: (...args) => calls.push(['fromTo', ...args]), to: (...args) => calls.push(['to', ...args]), set: (...args) => calls.push(['set', ...args])}});
  return calls;
}

test('checklist states wait for speech cues and covered ticks follow active state', () => {
  const input = {...base, rows: [row, {label: 'Security', status: 'active', at: 6.72, doneAt: 10.1}, {label: 'AI workflows', status: 'active', at: 10.1, doneAt: 16.14}, {label: 'Hands-free agent', status: 'active', at: 16.14, doneAt: 19.2}, {label: 'Content and video', status: 'active', at: 19.2}]};
  const result = buildEditorialModule(input);
  assert.deepEqual(result, buildEditorialModule(input));
  assert.match(result.html, /status-0-active" style="opacity:0/);
  assert.match(result.html, /status-0-done" style="opacity:0/);
  const calls = commands(result);
  assert.ok(calls.some(call => call[1] === '#learn-status-0-active' && call.at(-1) === 72.79 && call[2].opacity === 1));
  assert.ok(calls.some(call => call[1] === '#learn-row-0 svg' && call.at(-1) === 76.72 && call[2].opacity === 1));
  assert.ok(result.events.every(event => event.time >= 70 && event.time < 98));
  assert.equal(result.events.find(event => event.id === 'learn-row-0-covered').time, 76.88);
});

test('media playback is a direct root sibling with synchronized higher chrome track', () => {
  const result = buildEditorialModule({...base, kind: 'media-window', track: 8, media: {kind: 'video', src: 'assets/demo.mp4', sourceStart: 12}});
  assert.match(result.html, /^<video[^>]*data-track-index="8"[^>]*data-media-start="12"[^>]*muted[^>]*><\/video><section[^>]*data-track-index="9"/);
  assert.match(result.html, /data-layout-allow-occlusion="true"/);
  const calls = commands(result);
  for (const target of ['#learn', '#learn-media']) assert.ok(calls.some(call => call[1] === target && call.at(-1) === 70));
  assert.match(result.html, /#ff6258/);
});

test('portrait image window and callout use target-specific bounded layouts', () => {
  const window = buildEditorialModule({...base, aspect: '9:16', rect: undefined, kind: 'media-window', media: {kind: 'image', src: 'assets/readable.png'}});
  assert.deepEqual(window.layout.canvas, {width: 1080, height: 1920});
  assert.match(window.html, /^<img/);
  const callout = buildEditorialModule({...base, aspect: '9:16', rect: undefined, kind: 'callout', body: 'Focus on the next useful step.'});
  assert.match(callout.html, /Focus on the next useful step/);
  assert.ok(callout.layout.rect.y + callout.layout.rect.height <= 1920);
});

test('bar stages are explicit chronological events without fabricated percentages or detached dots', () => {
  const result = buildEditorialModule({...base, kind: 'step-rail', steps: [{label: 'Plan', at: 1}, {label: 'Build', at: 3}, {label: 'Share', at: 5}]});
  assert.doesNotMatch(result.html, /ui-step-dot|%/);
  assert.match(result.motion, /scaleX:1/);
  assert.equal(result.events.at(-1).time, 75.3);
  assert.throws(() => buildEditorialModule({...base, kind: 'step-rail', steps: [{label: 'Plan', at: 2}, {label: 'Build', at: 1}]}), /strictly increase/);
});

test('module exits hard-clear at their boundary and rail transforms initialize in GSAP', () => {
  const media = buildEditorialModule({...base, kind: 'media-window', media: {kind: 'video', src: 'assets/demo.mp4'}});
  for (const target of ['#learn', '#learn-media']) assert.ok(commands(media).some(call => call[0] === 'set' && call[1] === target && call[2].opacity === 0 && call.at(-1) === 98));
  const rail = buildEditorialModule({...base, kind: 'step-rail', steps: [{label: 'Plan', at: 1}, {label: 'Build', at: 3}]});
  assert.doesNotMatch(rail.css, /transform:scaleX/);
  assert.ok(commands(rail).some(call => call[0] === 'set' && call[1] === '#learn .ui-fill' && call[2].scaleX === 0 && call.at(-1) === 70));
});

test('untrusted copy is escaped and generated animation never executes it', () => {
  const result = buildEditorialModule({...base, kind: 'callout', title: '</script><script>alert(1)</script>', body: '<img src=x onerror="bad()"> & text'});
  assert.doesNotMatch(result.html, /<script|<img/);
  assert.match(result.html, /&lt;script&gt;/);
  assert.doesNotMatch(result.motion, /alert|bad\(/);
  commands(result);
  for (const bad of [{id: 'x";bad()'}, {accent: 'red;bad()'}, {percent: 95}, {track: 1.5}, {duration: NaN}]) assert.throws(() => buildEditorialModule({...base, rows: [row], ...bad}));
});

test('invalid paths, times and layouts fail before emitting a composition', () => {
  for (const src of ['https://example.com/video.mp4', '/private/video.mp4', 'assets/../secret.mp4', 'assets/a"bad.mp4']) assert.throws(() => buildEditorialModule({...base, kind: 'media-window', media: {kind: 'video', src}}), /assets/);
  assert.throws(() => buildEditorialModule({...base, rows: [{...row, at: 28}]}), /row.at/);
  assert.throws(() => buildEditorialModule({...base, rows: [{...row, doneAt: 2}]}), /doneAt/);
  assert.throws(() => buildEditorialModule({...base, rows: [row], rect: {...base.rect, x: 1600}}), /rect.x/);
  assert.throws(() => buildEditorialModule({...base, rows: [{...row,label: 'Engineering principles and production foundations'}], rect: {x: 0, y: 0, width: 420, height: 300}}), /label too long/);
  assert.throws(() => buildEditorialModule({...base, rows: Array(6).fill(row), rect: {...base.rect, height: 160}}), /too short/);
  assert.throws(() => buildEditorialModule({...base, kind: 'callout', rect: {...base.rect, height: 160}, body: 'word '.repeat(30)}), /too short/);
});

test('local CLI emits the same module and fails clearly for invalid input', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'launchclip-ui-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, 'module.json');
  const script = new URL('../skills/launchclip-create-video/scripts/editorial-ui-modules.mjs', import.meta.url);
  const input = {...base, rows: [row]};
  await writeFile(path, JSON.stringify(input));
  const success = spawnSync(process.execPath, [script.pathname, path], {encoding: 'utf8'});
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout), buildEditorialModule(input));
  await writeFile(path, '{"kind":"factory"}');
  const failure = spawnSync(process.execPath, [script.pathname, path], {encoding: 'utf8'});
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, '');
  assert.match(failure.stderr, /id/);
});

const expressive = {...base, id: 'reach', title: 'Getting seen', rect: {x: 80, y: 130, width: 850, height: 650}};
const points = [{label: 'Start', value: 12, at: 1}, {label: 'Later', value: 36, at: 3}, {label: 'Now', value: 180, at: 5}];

test('illustrative audience activates bounded emoji tiles on explicit events without geometry or counts', () => {
  const input = {...expressive, kind: 'audience-grid', audience: {columns: 3, tiles: Array.from({length: 6}, (_, i) => ({label: 'Viewer', emoji: '👤', at: 1 + i * .5}))}};
  const result = buildEditorialModule(input);
  assert.deepEqual(result, buildEditorialModule(input));
  assert.match(result.html, /Illustration · audience tiles/);
  assert.doesNotMatch(result.html, /<svg|<path|<line|viewers reached/);
  assert.equal(result.events.at(-1).time, 73.74);
  assert.ok(commands(result).some(call => call[1] === '#reach-viewer-2' && call.at(-1) === 72));
  const portrait = buildEditorialModule({...input, aspect: '9:16', rect: {x: 90, y: 400, width: 900, height: 700}});
  assert.equal(portrait.layout.canvas.height, 1920);
});

test('illustrative numbers retain attribution and chart/count are directly seekable GSAP properties', () => {
  const result = buildEditorialModule({...expressive, kind: 'trend-chart', chart: {mode: 'illustration', unit: 'views', points}});
  assert.match(result.html, /Illustration · example values/);
  assert.match(result.html, /height:12px/);
  assert.match(result.html, /height:180px/);
  const calls = commands(result);
  assert.ok(calls.some(call => call[0] === 'set' && call[1] === '#reach-count' && call[2].textContent === 0 && call.at(-1) === 70));
  assert.ok(calls.some(call => call[0] === 'fromTo' && call[1] === '#reach-count' && call[2].textContent === 36 && call[3].textContent === 180 && call[3].snap.textContent === 1));
  assert.doesNotMatch(result.motion, /onUpdate|setTimeout|Date\.|Math.random/);
  assert.equal(result.events.at(-1).time, 75.38);
});

test('real data requires attribution and supports decreases and zero without NaN geometry', () => {
  assert.throws(() => buildEditorialModule({...expressive, kind: 'trend-chart', chart: {mode: 'data', unit: 'views', points}}), /source for real data/);
  const real = buildEditorialModule({...expressive, kind: 'trend-chart', chart: {mode: 'data', unit: 'views', source: 'Supplied analytics export', points: [...points.slice(0, 2), {label: 'Now', value: 0, at: 5}]}});
  assert.match(real.html, /Source: Supplied analytics export/);
  assert.match(real.motion, /textContent:0,snap/);
  const zero = buildEditorialModule({...expressive, kind: 'trend-chart', chart: {mode: 'illustration', unit: 'views', points: points.map(point => ({...point, value: 0}))}});
  assert.doesNotMatch(zero.html, /NaN|Infinity/);
  assert.match(zero.html, /height:0px/);
  assert.throws(() => buildEditorialModule({...expressive, kind: 'trend-chart', chart: {mode: 'illustration', unit: 'views', source: 'Misleading source', points}}), /cannot claim/);
});

test('expressive inputs reject unsafe modes, invalid timing, oversized copy and overfull layouts', () => {
  const chart = {mode: 'illustration', unit: 'views', points};
  for (const bad of [{mode: 'real'}, {points: [{...points[0], value: Infinity}, points[1]]}, {points: [{...points[0], value: .5}, points[1]]}, {points: [points[0], {...points[1], at: 1.2}]}, {points: [{...points[0], percentage: 99}, points[1]]}]) assert.throws(() => buildEditorialModule({...expressive, kind: 'trend-chart', chart: {...chart, ...bad}}));
  const audience = {tiles: [{label: 'Viewer', emoji: '👤', at: 1}, {label: 'Viewer', emoji: '👤', at: 2}]};
  for (const bad of [{columns: 2.5}, {columns: 4}, {tiles: [{...audience.tiles[0], emoji: 'much too long accent'}, audience.tiles[1]]}]) assert.throws(() => buildEditorialModule({...expressive, kind: 'audience-grid', audience: {...audience, ...bad}}));
  assert.throws(() => buildEditorialModule({...expressive, kind: 'audience-grid', rect: {...expressive.rect, height: 160}, audience}), /does not fit/);
  assert.throws(() => buildEditorialModule({...expressive, kind: 'trend-chart', rect: {...expressive.rect, height: 160}, chart}), /does not fit/);
  const escaped = buildEditorialModule({...expressive, kind: 'audience-grid', audience: {tiles: [{label: '<b>A</b>', emoji: '<x>', at: 1}, audience.tiles[1]]}});
  assert.doesNotMatch(escaped.html, /<b>|<x>/);
  assert.match(escaped.html, /&lt;b&gt;/);
  const source = buildEditorialModule({...expressive, kind: 'trend-chart', chart: {mode: 'data', unit: 'views', source: '<script>bad()</script>', points}});
  assert.doesNotMatch(source.html, /<script>/);
  assert.doesNotMatch(source.motion, /bad\(/);
});

test('standalone metrics preserve their initial value and format increases, decreases, percent and money', () => {
  const metric = {mode: 'illustration', unit: 'viewers', format: 'number', values: [{value: 12, at: .6}, {value: 180, at: 2}, {value: 36, at: 4}]};
  const result = buildEditorialModule({...expressive, kind: 'metric', metric});
  assert.match(result.html, /class="ui-number">12</);
  assert.match(result.html, /Illustration · example values/);
  const frames = commands(result).filter(call => call[0] === 'set' && call[1] === '#reach-number');
  assert.ok(frames.some(call => call[2].textContent === '180' && call.at(-1) === 72.6));
  assert.ok(frames.some(call => call[2].textContent === '36' && call.at(-1) === 74.6));
  assert.doesNotMatch(result.motion, /onUpdate|setTimeout|Date\.|Math.random/);
  const percent = buildEditorialModule({...expressive, kind: 'metric', metric: {...metric, unit: 'completion', format: 'percent', decimals: 1, values: [{value: 72.5, at: .6}, {value: 48, at: 2.2}]}});
  assert.match(percent.html, /72.5%/);
  const change = buildEditorialModule({...expressive, kind: 'metric', metric: {...metric, unit: 'growth', format: 'percent', values: [{value: 150, at: .6}, {value: -12, at: 2.2}]}});
  assert.match(change.html, /150%/);
  assert.ok(commands(change).some(call => call[2]?.textContent === '-12%'));
  assert.ok(commands(percent).some(call => call[2]?.textContent === '48.0%'));
  const money = buildEditorialModule({...expressive, kind: 'metric', metric: {...metric, unit: 'balance', format: 'currency', currency: 'USD', decimals: 2, values: [{value: 1250.25, at: .6}, {value: -50, at: 2.2}]}});
  assert.match(money.html, /USD\s1,250.25/);
  assert.ok(commands(money).some(call => call[2]?.textContent === '-USD\u00a050.00'));
});

test('standalone progress supports reversed values and rejects invented or out-of-range data', () => {
  const progress = {mode: 'illustration', max: 4, label: 'Example stages', values: [{value: 1, at: .6}, {value: 4, at: 2}, {value: 2, at: 4}]};
  const result = buildEditorialModule({...expressive, kind: 'progress', progress});
  assert.match(result.html, /class="ui-number">25%</);
  assert.ok(commands(result).some(call => call[1] === '#reach .ui-progress-fill' && call[2]?.scaleX === .5));
  assert.equal(result.events.at(-1).time, 74.6);
  for (const bad of [{mode: 'data'}, {max: 0}, {values: [{value: 5, at: .6}]}, {values: [{value: -1, at: .6}]}, {values: [{value: 1, at: 2}, {value: 2, at: 2.5}]}]) assert.throws(() => buildEditorialModule({...expressive, kind: 'progress', progress: {...progress, ...bad}}));
  const metric = {mode: 'illustration', format: 'percent', unit: 'completion', values: [{value: 50, at: .6}]};
  for (const bad of [{values: [{value: Infinity, at: .6}]}, {format: 'currency'}, {currency: 'USD'}, {decimals: 3}, {decimals: .5}]) assert.throws(() => buildEditorialModule({...expressive, kind: 'metric', metric: {...metric, ...bad}}));
});

test('numbered steps remain optional, bounded and distinct from checklist state', () => {
  const result = buildEditorialModule({...base, kind: 'step-rail', numbered: true, steps: [{label: 'Plan', at: 1}, {label: 'Build', at: 3}, {label: 'Share', at: 5}]});
  assert.equal((result.html.match(/class="ui-step-number"/g) ?? []).length, 3);
  assert.match(result.html, />1<\/span>Plan/);
  assert.match(result.html, />3<\/span>Share/);
  assert.match(result.css, /ui-step-number/);
  assert.throws(() => buildEditorialModule({...base, rows: [row], numbered: true}), /step-rail only/);
  assert.throws(() => buildEditorialModule({...base, kind: 'callout', body: 'Readable text', presentation: 'arbitrary-css'}), /solid or glass/);
  const media = buildEditorialModule({...base, kind: 'media-window', presentation: 'glass', media: {kind: 'video', src: 'assets/demo.mp4'}});
  assert.match(media.html, /^<video[^>]*><\/video><section/);
  assert.match(media.css, /\.ui-bar\{background:rgba/);
});

test('directional motion preserves a readable rest pose and exposes absolute travel windows', () => {
  const input = {...base, kind: 'callout', body: 'Carry this idea into the next beat.', motion: {enter: 'right', exit: 'left', distance: 64, enterDuration: .4, exitDuration: .26, scale: .98}};
  const result = buildEditorialModule(input), calls = commands(result);
  assert.deepEqual(result, buildEditorialModule(input));
  const entry = calls.find(call => call[0] === 'fromTo' && call[1] === '#learn');
  assert.equal(entry[2].x, 64);
  assert.equal(entry[2].scale, .98);
  assert.equal(entry[3].x, 0);
  assert.equal(entry[3].y, 0);
  assert.equal(entry[3].scale, 1);
  const exit = calls.find(call => call[0] === 'to' && call[1] === '#learn');
  assert.equal(exit[2].x, -64);
  assert.equal(exit.at(-1), 97.74);
  assert.deepEqual(result.layout.motion, {enterEnd: 70.4, exitStart: 97.74, end: 98});
  assert.equal(result.events[0].time, 70.4);
  assert.ok(calls.some(call => call[0] === 'set' && call[1] === '#learn' && call.at(-1) === 98 && call[2].opacity === 0));
  assert.doesNotMatch(result.motion, /filter|onUpdate|setTimeout|Math.random/);
});

test('directional media and chrome share the same screen pivot and timing', () => {
  const result = buildEditorialModule({...base, kind: 'media-window', media: {kind: 'image', src: 'assets/demo.png'}, motion: {enter: 'down', exit: 'up', scale: .95}});
  assert.match(result.html, /^<img[^>]*><section/);
  const entries = commands(result).filter(call => call[0] === 'fromTo');
  assert.equal(entries.length, 2);
  assert.equal(entries[0][2].transformOrigin, '0px 0px');
  assert.equal(entries[1][2].transformOrigin, '0px -48px');
  assert.equal(entries[0][2].y, entries[1][2].y);
  assert.deepEqual(entries[0][3], entries[1][3]);
  assert.equal(entries[0].at(-1), entries[1].at(-1));
});

test('motion rejects unsafe travel, unsupported effects and unreadable timing', () => {
  const input = {...base, kind: 'callout', body: 'Clear next step.'};
  for (const motion of [{enter: 'diagonal'}, {exit: '<script>'}, {distance: 97}, {distance: -1}, {scale: 1.1}, {enterDuration: .7}, {exitDuration: .1}, {filter: 'blur(4px)'}]) assert.throws(() => buildEditorialModule({...input, motion}), /motion/);
  assert.throws(() => buildEditorialModule({...input, duration: 1, motion: {enterDuration: .6, exitDuration: .5}}), /readable hold/);
  assert.throws(() => buildEditorialModule({...base, motion: {enterDuration: .6}, rows: [{label: 'Too early', status: 'active', at: .4}]}), /row.at/);
  assert.throws(() => buildEditorialModule({...expressive, duration: 4, kind: 'metric', motion: {exitDuration: .5}, metric: {mode: 'illustration', unit: 'views', format: 'number', values: [{value: 12, at: .6}, {value: 36, at: 3}]}}), /at/);
});

test('developer callouts use allowlisted symbols escaped segments and independent finite accents', () => {
  const input = {...expressive, kind:'callout', treatment:{icon:'branch',monospace:true,glow:true,corners:true,at:.6,segments:[{text:'Review '},{text:'before shipping',highlight:true}]}};
  const result = buildEditorialModule(input);
  assert.deepEqual(result,buildEditorialModule(input));
  assert.match(result.html,/ui-emphasis">before shipping/);
  assert.match(result.css,/ui-monospace/);
  assert.match(result.css,/left:-8px/);
  assert.equal((result.html.match(/aria-hidden="true"/g)??[]).length,6);
  const calls=commands(result);
  assert.ok(calls.some(call=>call[1]==='#reach-symbol'&&call[2].scale===.86));
  assert.ok(calls.some(call=>call[1]==='#reach-corner-br'&&call.at(-1)===70.72));
  assert.equal(result.events.at(-1).time,71);
  assert.doesNotMatch(result.motion,/boxShadow|filter|repeat|onUpdate/);
  for(const icon of ['terminal','branch','users','rocket']) assert.match(buildEditorialModule({...input,treatment:{...input.treatment,icon}}).html,/<svg/);
  for(const treatment of [{icon:'github'},{icon:'<svg>'},{glow:'true'},{segments:[{text:'ok',highlight:'yes'}]}]) assert.throws(()=>buildEditorialModule({...input,treatment}));
  assert.throws(()=>buildEditorialModule({...input,body:'Conflicting copy'}),/replace body/);
  assert.throws(()=>buildEditorialModule({...input,rect:{...input.rect,x:0}}),/clearance/);
  const safe=buildEditorialModule({...input,treatment:{segments:[{text:'<script>bad()</script>',highlight:true}]}});
  assert.doesNotMatch(safe.html,/<script>/);assert.doesNotMatch(safe.motion,/bad\(/);
});

test('date cards validate calendar values and animate the supplied date without render clocks', () => {
  const input={...expressive,kind:'date-card',date:{month:2,day:29,year:2028,caption:'A planned milestone',at:1}};
  const result=buildEditorialModule(input);
  assert.match(result.html,/FEBRUARY · 2028/);assert.match(result.html,/>29<\/div>/);
  assert.equal(result.events.at(-1).time,71.32);commands(result);
  assert.doesNotMatch(result.motion,/Date|setTimeout/);
  for(const date of [{...input.date,year:2027},{...input.date,month:4,day:31},{...input.date,month:2.5},{...input.date,day:0}]) assert.throws(()=>buildEditorialModule({...input,date}));
  assert.throws(()=>buildEditorialModule({...input,rect:{...input.rect,height:160}}),/too short/);
});

test('status racks change lights in both directions and emit only actual state changes', () => {
  const rack={mode:'illustration',rows:[{label:'Build',states:[{at:1,lights:[true,false,false]},{at:2,lights:[true,true,false]},{at:3,lights:[false,true,false]},{at:4,lights:[false,true,false]}]}]};
  const result=buildEditorialModule({...expressive,kind:'status-rack',rack});
  assert.match(result.html,/Illustration · status states/);
  assert.equal(result.events.length,4);
  assert.ok(commands(result).some(call=>call[1]==='#reach-light-0-0'&&call[2].backgroundColor==='#536071'&&call.at(-1)===73));
  assert.throws(()=>buildEditorialModule({...expressive,kind:'status-rack',rack:{...rack,mode:'data'}}),/source/);
  assert.throws(()=>buildEditorialModule({...expressive,kind:'status-rack',rack:{...rack,rows:[{label:'Bad',states:[{at:1,lights:[1,false,true]}]}]}}),/booleans/);
  assert.throws(()=>buildEditorialModule({...expressive,kind:'status-rack',rack:{...rack,rows:Array(9).fill(rack.rows[0])}}),/1–8/);
});

test('code snippets use bounded typed tokens preserving spacing and rejecting executable markup', () => {
  const code={language:'TypeScript',lines:[{at:.6,tokens:[{text:'const ',type:'keyword'},{text:'x = ',type:'plain'},{text:'7',type:'number'}]},{at:1,tokens:[{text:' ',type:'plain'},{text:'"hello"',type:'string'}]}]};
  const result=buildEditorialModule({...expressive,kind:'code-snippet',code});
  assert.match(result.html,/ui-token-number">7/);assert.match(result.html,/TypeScript · Example/);
  assert.equal(result.events.at(-1).time,71.24);commands(result);
  const safe=buildEditorialModule({...expressive,kind:'code-snippet',code:{lines:[{at:1,tokens:[{text:'<script>bad()</script>',type:'plain'}]}]}});
  assert.doesNotMatch(safe.html,/<script>/);assert.match(safe.html,/&lt;script&gt;/);
  for(const tokens of [[{text:'bad',type:'html'}],[{text:'a\nb',type:'plain'}],[{text:'x'.repeat(80),type:'plain'}]]) assert.throws(()=>buildEditorialModule({...expressive,kind:'code-snippet',code:{lines:[{at:1,tokens}]}}));
  assert.throws(()=>buildEditorialModule({...expressive,kind:'code-snippet',code:{lines:Array(4).fill(code.lines[0])}}),/1–3/);
});

test('excerpt windows keep fixed chrome and safely focus bounded highlighted text', () => {
  const excerpt={mode:'illustration',lines:[{segments:[{text:'Build a useful thing.'}]},{segments:[{text:'Then '},{text:'make it clear.',highlight:true}]}],focus:{line:1,scale:1.2,at:2}};
  const result=buildEditorialModule({...expressive,kind:'excerpt-window',excerpt});
  assert.match(result.html,/Illustration · text excerpt/);assert.match(result.html,/ui-excerpt-highlight">make it clear/);
  const focus=commands(result).find(call=>call[0]==='to'&&call[1]==='#reach-excerpt');
  assert.equal(focus[2].scale,1.2);assert.equal(focus.at(-1),72);assert.equal(result.events.at(-1).time,72.5);
  assert.ok(focus[2].x>=0&&focus[2].y>=0);
  assert.doesNotMatch(result.motion,/\.ui-bar|fetch|onUpdate|Date\./);
  for(const bad of [{mode:'data'},{focus:{...excerpt.focus,scale:1.4}},{focus:{...excerpt.focus,line:2}},{lines:[{segments:[{text:'x'.repeat(120)}]}]}]) assert.throws(()=>buildEditorialModule({...expressive,kind:'excerpt-window',excerpt:{...excerpt,...bad}}));
  const escaped=buildEditorialModule({...expressive,kind:'excerpt-window',excerpt:{...excerpt,lines:[{segments:[{text:'<script>bad()</script>'}]}],focus:{...excerpt.focus,line:0}}});
  assert.doesNotMatch(escaped.html,/<script>/);assert.doesNotMatch(escaped.motion,/bad\(/);
});

test('callout headings and timed underline emphasis have separate seekable acquisition', () => {
  const input={...expressive,kind:'callout',treatment:{icon:'warning',at:.6,segments:[{text:'Check '},{text:'before release',highlight:true,underlineAt:2}]}};
  const result=buildEditorialModule(input),calls=commands(result);
  assert.match(result.html,/ui-underlined/);
  assert.ok(calls.some(call=>call[1]==='#reach-heading'&&call[0]==='fromTo'&&call[2].y===6));
  assert.ok(calls.some(call=>call[1]==='#reach-underline-1'&&call[0]==='set'&&call[2].scaleX===0&&call.at(-1)===70));
  assert.ok(calls.some(call=>call[1]==='#reach-underline-1'&&call[0]==='to'&&call[2].scaleX===1&&call.at(-1)===72));
  assert.equal(result.events.find(event=>event.id==='reach-underline-1-settle').time,72.28);
  for(const icon of ['check','warning']) assert.match(buildEditorialModule({...input,treatment:{...input.treatment,icon}}).html,/<svg/);
  assert.throws(()=>buildEditorialModule({...input,treatment:{...input.treatment,segments:[{text:'early',underlineAt:.7}]}}),/follow treatment/);
  assert.throws(()=>buildEditorialModule({...input,rect:{x:80,y:80,width:420,height:500},treatment:{segments:[{text:'very long unbroken emphasized phrase needing two full lines',underlineAt:2}]}}),/fit one line/);
});

const paletteBase={id:'palette',aspect:'16:9',start:0,duration:8,title:'A useful idea',rect:{x:80,y:80,width:850,height:750}};
const paletteSpecs=[{kind:'callout',body:'Keep the next step clear.'},{kind:'media-window',media:{kind:'image',src:'assets/demo.png'}},{kind:'checklist',rows:[{label:'One',status:'active',at:.6,doneAt:2}]},{kind:'step-rail',steps:[{label:'One',at:.6},{label:'Two',at:4}]},{kind:'audience-grid',audience:{tiles:[{label:'One',at:.6},{label:'Two',at:3}]}},{kind:'trend-chart',chart:{mode:'illustration',unit:'views',points:[{label:'One',value:0,at:.6},{label:'Two',value:20,at:3}]}},{kind:'metric',metric:{mode:'illustration',unit:'views',format:'number',values:[{value:0,at:.6},{value:20,at:6}]}},{kind:'progress',progress:{mode:'illustration',values:[{value:0,at:.6},{value:20,at:6}]}},{kind:'date-card',date:{month:2,day:2,at:.6}},{kind:'status-rack',rack:{mode:'illustration',rows:[{label:'Build',states:[{at:.6,lights:[true,false,false]},{at:3,lights:[false,true,false]}]}]}},{kind:'code-snippet',code:{lines:[{at:.6,tokens:[{text:'const ',type:'keyword'},{text:'value = 7;',type:'plain'}]}]}},{kind:'excerpt-window',excerpt:{mode:'illustration',lines:[{segments:[{text:'A useful idea.'}]}],focus:{line:0,scale:1.2,at:2}}}];

const originalPaletteHashes={"callout":"65377e8879aaf9bfda689e707755e1d6025a3e1f3b346830b52daedcb3fe5e42","media-window":"ac4814e27676ea2fe468eca9474b5fbb0f0820338946b14d70a5218715e33e01","checklist":"37492c1d22854cc390cb494dd09f1bd83e7ab095018bc3ac1ce88323ce4a6023","step-rail":"0b4a8879c27044e871e4b969397b96a344e92b219751ea785d5f3791af55ccd0","audience-grid":"a1e2c85b1d431838dbf141459ba1c47747ee5453194ede1a8fc582808a4c2196","trend-chart":"0a0169797db1180dddfb30966dbcc596fd9f97c552c664377abf808d83a6ea7d","metric":"374cf3d6bdb2594b52919ea753e1ef5092ac8a197e8f2616c6cb2b87840f3d9a","progress":"9962b59abfb4533d63ea4bbfdb02fea6d404697772abd309e51cbe63f9e886fe","date-card":"8bac996206bdf5fc7e826a2c43357bdbfab78fcf2102bed16af42e9e3700d733","status-rack":"9b85e5a0f9ffec4d0eb9044def5751867178485b453f2368eba68cedcdf0ccb0","code-snippet":"a6a0f8e4760c7f106be96d2d1b5d8d33dbfa78ad83b1a2a67e92cccec30fd4de","excerpt-window":"dcf8327b57714e4a130f229e9db442f5dc3252c8d4677a6584eb97ad1b3237b7"};

const warmPalette={surface:'#FFF1CE',foreground:'#171612',muted:'#5D5548',border:'#9B8769',accentText:'#A43C0A'};

test('optional palettes preserve every original module output and theme only presentation', () => {
  for (const spec of paletteSpecs) {
    const original=buildEditorialModule({...paletteBase,...spec});
    assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'),originalPaletteHashes[spec.kind],spec.kind);
    const themed=buildEditorialModule({...paletteBase,...spec,theme:warmPalette});
    assert.equal(themed.html,original.html);
    assert.deepEqual(themed.events,original.events);
    assert.deepEqual(themed.layout,original.layout);
    assert.match(themed.css,/#palette\{background:#FFF1CE;color:#171612;border-color:#9B8769\}/);
  }
  const list=buildEditorialModule({...paletteBase,...paletteSpecs.find(spec=>spec.kind==='checklist'),theme:warmPalette});
  assert.ok(commands(list).some(call=>call[1]==='#palette-row-0'&&call[2].backgroundColor==='#FFF1CE'&&call.at(-1)===2));
  const rack=buildEditorialModule({...paletteBase,...paletteSpecs.find(spec=>spec.kind==='status-rack'),theme:warmPalette});
  assert.ok(commands(rack).some(call=>call[1]==='#palette-light-0-0'&&call[2].backgroundColor==='#9B8769'&&call.at(-1)===3));
  const glass=buildEditorialModule({...paletteBase,kind:'callout',body:'Clear copy.',theme:warmPalette,presentation:'glass'});
  assert.match(glass.css,/#FFF1CEDB/);assert.match(glass.css,/#FFF1CEBD/);
});

test('palette input rejects unsafe or incomplete colors and defaults optional accent text to ink', () => {
  const input={...paletteBase,kind:'callout',body:'Clear copy.'};
  for (const theme of [null,[],{}, {...warmPalette,surface:'red'}, {...warmPalette,foreground:'#123'}, {...warmPalette,border:'var(--color)'}, {...warmPalette,muted:123456}, {...warmPalette,accentText:'#fff;bad()'}, {...warmPalette,font:'external'}]) assert.throws(()=>buildEditorialModule({...input,theme}),/theme/);
  const {accentText,...theme}=warmPalette;
  const result=buildEditorialModule({...input,theme});
  assert.match(result.css,/ui-emphasis[^}]*color:#171612/);
  assert.doesNotMatch(result.motion,/bad\(|fetch|onUpdate/);
});

test('focus convergence preserves the chosen subject and starts progress only after it settles', () => {
  const input={...paletteBase,kind:'focus-flow',duration:8.95,rect:{x:80,y:695,width:1120,height:340},theme:warmPalette,focus:{options:['Compare','New tools','Side quests','The next build'],selected:3,arriveAt:.28,chooseAt:1,progressAt:5.5,icon:'terminal'}};
  const result=buildEditorialModule(input),calls=commands(result);
  assert.deepEqual(result,buildEditorialModule(input));assert.match(result.html,/Illustration · focus sequence/);
  assert.equal((result.html.match(/class="ui-focus-option"/g)??[]).length,4);
  const chosen=calls.find(call=>call[0]==='to'&&call[1]==='#palette-option-3'&&call[2].borderColor);
  assert.equal(chosen[2].x,407.25);assert.equal(chosen[2].scale,1.4);assert.equal(chosen.at(-1),1.18);
  assert.ok(calls.some(call=>call[1]==='#palette-option-0'&&call[2].opacity===0&&call.at(-1)===1));
  assert.ok(calls.some(call=>call[1]==='#palette-focus-fill'&&call[2].scaleX===1&&call.at(-1)===5.5));
  assert.equal(result.events.find(e=>e.id==='palette-chosen-task').time,1.6);
  assert.doesNotMatch(result.motion,/onUpdate|setTimeout|Date\.|Math.random/);
  assert.throws(()=>buildEditorialModule({...input,focus:{...input.focus,options:['Same','same']}}),/distinct/);
  assert.throws(()=>buildEditorialModule({...input,focus:{...input.focus,progressAt:1.5}}),/settle/);
  assert.throws(()=>buildEditorialModule({...input,focus:{...input.focus,selected:4}}),/selected/);
  assert.throws(()=>buildEditorialModule({...input,focus:{...input.focus,chooseAt:.5}}),/hold options/);
});

test('growth distinguishes relative illustrations from supplied real counts with bounded staged bars', () => {
  const result=buildEditorialModule({...paletteBase,kind:'growth-chart',growth:{mode:'illustration'}});
  assert.match(result.html,/Illustration · relative growth/);assert.match(result.css,/ui-metric\{display:none\}/);
  assert.equal(result.events.filter(e=>e.id.includes('-point-')).length,4);
  assert.ok(commands(result).some(call=>call[0]==='fromTo'&&call[1]==='#palette-column-2'&&call[2].opacity===0));
  assert.throws(()=>buildEditorialModule({...paletteBase,kind:'growth-chart',growth:{mode:'data',source:'Analytics'}}),/supplied points/);
  const points=[{label:'Start',value:0,at:.6},{label:'Later',value:20,at:2},{label:'Now',value:90,at:4}];
  const real=buildEditorialModule({...paletteBase,kind:'growth-chart',growth:{mode:'data',unit:'views',source:'Supplied export',points}});
  assert.match(real.html,/Source: Supplied export/);assert.doesNotMatch(real.css,/ui-metric\{display:none\}/);
  assert.throws(()=>buildEditorialModule({...paletteBase,kind:'growth-chart',growth:{mode:'illustration',points:[points[1],{...points[2],value:10}]}}),/must not decrease/);
  assert.throws(()=>buildEditorialModule({...paletteBase,kind:'growth-chart',growth:{mode:'illustration',showValues:'no'}}),/boolean/);
  const escaped=buildEditorialModule({...paletteBase,kind:'focus-flow',focus:{options:['<b>A</b>','B'],selected:0,arriveAt:.6,chooseAt:1.5,progressAt:3}});
  assert.doesNotMatch(escaped.html,/<b>/);assert.match(escaped.html,/&lt;b&gt;/);
});

test('visible code typing preserves token spacing, finite spans and legacy default output', () => {
  const base={id:'typed',kind:'code-snippet',aspect:'16:9',start:4,duration:4,title:'A useful example',rect:{x:80,y:80,width:900,height:320}};
  const lines=[{at:.5,typeDuration:.8,tokens:[{text:'const ',type:'keyword'},{text:'x = 7;',type:'plain'}]},{at:1.3,typeDuration:.25,tokens:[{text:'<x>',type:'string'}]}];
  const result=buildEditorialModule({...base,code:{typing:true,lines}});
  assert.equal((result.html.match(/class="ui-code-character"/g)||[]).length,15);
  assert.match(result.html,/&lt;/); assert.match(result.html,/&gt;/);
  assert.deepEqual(result.events.filter(e=>e.role==='typing'),[{id:'typed-code-0-typing-start',time:4.5,endTime:5.3,duration:.8,role:'typing'},{id:'typed-code-1-typing-start',time:5.3,endTime:5.55,duration:.25,role:'typing'}]);
  assert.match(result.motion,/#typed-char-0-11/); assert.doesNotMatch(result.motion,/onUpdate|setTimeout/);
  assert.equal(result.events.find(e=>e.id==='typed-code-0-settle').time,5.3);
  const legacy=buildEditorialModule({...base,code:{lines:[{at:.5,tokens:lines[0].tokens}]}});
  assert.doesNotMatch(legacy.html,/ui-code-character/); assert.equal(legacy.events.find(e=>e.id==='typed-code-0-settle').time,4.74);
  for(const code of [{typing:'yes',lines},{typing:false,lines},{typing:true,lines:[{...lines[0],typeDuration:.01}]},{typing:true,lines:[lines[0],{...lines[1],at:1}]}]) assert.throws(()=>buildEditorialModule({...base,code}));
  assert.throws(()=>buildEditorialModule({...base,duration:2,code:{typing:true,lines:[{...lines[0],at:1,typeDuration:1}]}}),/settle/);
});

test('excerpt highlight sweep separates its background from stationary escaped text', () => {
  const base={id:'sweep',kind:'excerpt-window',aspect:'16:9',start:2,duration:4,title:'A useful excerpt',rect:{x:90,y:200,width:900,height:400},excerpt:{mode:'illustration',highlightMotion:true,lines:[{segments:[{text:'Keep '},{text:'<the subject>',highlight:true}]}],focus:{line:0,scale:1.1,at:1.1}}};
  const result=buildEditorialModule(base);
  assert.match(result.html,/ui-highlight-fill" aria-hidden="true/);assert.match(result.html,/ui-highlight-text">&lt;the subject&gt;/);
  assert.match(result.css,/transform-origin:left center/);assert.match(result.motion,/scaleX:1,duration:0.35/);
  assert.equal(result.events.find(e=>e.id==='sweep-highlight-sweep-settle').time,3.45);
  assert.doesNotMatch(result.motion,/backgroundColor|onUpdate/);
  assert.throws(()=>buildEditorialModule({...base,excerpt:{...base.excerpt,highlightMotion:'yes'}}),/boolean/);
  assert.throws(()=>buildEditorialModule({...base,duration:1.6}),/settle/);
  const old=buildEditorialModule({...base,excerpt:{...base.excerpt,highlightMotion:false}});
  assert.doesNotMatch(old.html,/ui-highlight-fill/);assert.match(old.motion,/backgroundColor/);
});
