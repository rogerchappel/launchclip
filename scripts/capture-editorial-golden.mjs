#!/usr/bin/env node
// Captures the editorial module golden corpus: every fixture spec below is run
// through buildEditorialModule() and the output (or the thrown error message)
// is written to test/fixtures/editorial-golden.json. The corpus was first
// captured before the editorial core split; test/editorial_core.test.js holds
// the emitter to it byte for byte. Re-run only for an intended output change.
import {writeFile} from 'node:fs/promises';
import {buildEditorialModule} from '../skills/launchclip-create-video/scripts/editorial-ui-modules.mjs';

const out = new URL('../test/fixtures/editorial-golden.json', import.meta.url);
const warm = {surface: '#FFF1CE', foreground: '#171612', muted: '#5D5548', border: '#9B8769', accentText: '#A43C0A'};
const {accentText: _ink, ...warmNoInk} = warm;
const L = {id: 'mod', aspect: '16:9', start: 3, duration: 8, title: 'A useful idea', rect: {x: 80, y: 80, width: 850, height: 750}};
const wide = {...L, rect: {x: 80, y: 80, width: 1120, height: 760}};

// One or more valid specs per kind, covering every option.
const bases = {
  'callout-plain': {...L, kind: 'callout', body: 'Keep the next step clear.'},
  'callout-treated-full': {...L, kind: 'callout', treatment: {icon: 'branch', monospace: true, glow: true, corners: true, at: .6, segments: [{text: 'Review '}, {text: 'before shipping', highlight: true}]}},
  'callout-treated-underline': {...L, kind: 'callout', treatment: {icon: 'warning', at: .6, segments: [{text: 'Check '}, {text: 'before release', highlight: true, underlineAt: 2}, {text: ' and ship.'}]}},
  'callout-treated-body': {...L, kind: 'callout', body: 'A plain treated body.', treatment: {glow: true}},
  'callout-treated-mono': {...L, kind: 'callout', body: 'npm run build', treatment: {icon: 'terminal', monospace: true, corners: true}},
  'media-video': {...L, kind: 'media-window', track: 8, media: {kind: 'video', src: 'assets/demo.mp4', sourceStart: 12}},
  'media-video-nostart': {...L, kind: 'media-window', media: {kind: 'video', src: 'assets/demo clip.mp4'}},
  'media-image': {...L, kind: 'media-window', media: {kind: 'image', src: 'assets/demo.png'}},
  'checklist': {...L, kind: 'checklist', rows: [{label: 'One', status: 'active', at: .6, doneAt: 2}, {label: 'Two', status: 'done', at: 2.5}, {label: 'Three', status: 'pending', at: 3}]},
  'checklist-labels': {...L, kind: 'checklist', statusLabels: {pending: 'Later', active: 'Now', done: 'Covered'}, rows: [{label: 'Engineering principles', status: 'active', at: 1, doneAt: 3}, {label: 'Security', status: 'active', at: 3}]},
  'step-rail': {...L, kind: 'step-rail', steps: [{label: 'Plan', at: .6}, {label: 'Build', at: 2}, {label: 'Share', at: 4}]},
  'step-rail-numbered': {...L, kind: 'step-rail', numbered: true, steps: [{label: 'One', at: .6}, {label: 'Two', at: 4}]},
  'audience-grid': {...L, kind: 'audience-grid', audience: {tiles: [{label: 'One', at: .6}, {label: 'Two', at: 3}]}},
  'audience-grid-columns': {...L, kind: 'audience-grid', audience: {columns: 3, tiles: Array.from({length: 6}, (_, i) => ({label: `Viewer ${i}`, emoji: '🧑‍💻', at: .6 + i * .5}))}},
  'trend-chart': {...L, kind: 'trend-chart', chart: {mode: 'illustration', unit: 'views', points: [{label: 'One', value: 0, at: .6}, {label: 'Two', value: 20, at: 3}]}},
  'trend-chart-data': {...L, kind: 'trend-chart', chart: {mode: 'data', unit: 'views', source: 'Supplied analytics export', points: [{label: 'Start', value: 12, at: 1}, {label: 'Later', value: 36, at: 3}, {label: 'Now', value: 0, at: 5}]}},
  'growth-default': {...L, kind: 'growth-chart', growth: {mode: 'illustration'}},
  'growth-data': {...L, kind: 'growth-chart', growth: {mode: 'data', unit: 'views', source: 'Supplied export', points: [{label: 'Start', value: 0, at: .6}, {label: 'Later', value: 20, at: 2}, {label: 'Now', value: 90000, at: 4}]}},
  'growth-hidden': {...L, kind: 'growth-chart', growth: {mode: 'illustration', showValues: false, points: [{label: 'A', value: 1, at: .6}, {label: 'B', value: 5, at: 2}]}},
  'growth-illustration-points': {...L, kind: 'growth-chart', growth: {mode: 'illustration', unit: 'stars', points: [{label: 'A', value: 1, at: .6}, {label: 'B', value: 5, at: 2}]}},
  'metric-number': {...L, kind: 'metric', metric: {mode: 'illustration', unit: 'viewers', format: 'number', values: [{value: 12, at: .6}, {value: 180, at: 2}, {value: 36, at: 4}]}},
  'metric-percent': {...L, kind: 'metric', metric: {mode: 'illustration', unit: 'completion', format: 'percent', decimals: 1, values: [{value: 72.5, at: .6}, {value: 48, at: 2.2}]}},
  'metric-currency': {...L, kind: 'metric', metric: {mode: 'data', source: 'Ledger', unit: 'balance', format: 'currency', currency: 'USD', values: [{value: 1250.25, at: .6}, {value: -50, at: 2.2}]}},
  'metric-single': {...L, kind: 'metric', metric: {mode: 'illustration', unit: 'views', format: 'number', values: [{value: 1234567, at: .6}]}},
  'progress': {...L, kind: 'progress', progress: {mode: 'illustration', values: [{value: 0, at: .6}, {value: 20, at: 6}]}},
  'progress-label': {...L, kind: 'progress', progress: {mode: 'data', source: 'Tracker', max: 4, label: 'Example stages', values: [{value: 1, at: .6}, {value: 4, at: 2}, {value: 2, at: 4}]}},
  'date-card': {...L, kind: 'date-card', date: {month: 2, day: 29, year: 2028, caption: 'A planned milestone', at: 1}},
  'date-card-bare': {...L, kind: 'date-card', date: {month: 12, day: 2, at: .6}},
  'status-rack': {...L, kind: 'status-rack', rack: {mode: 'illustration', rows: [{label: 'Build', states: [{at: 1, lights: [true, false, false]}, {at: 2, lights: [true, true, false]}, {at: 3, lights: [false, true, false]}, {at: 4, lights: [false, true, false]}]}, {label: 'Deploy', states: [{at: 1.5, lights: [false, false, false]}, {at: 3, lights: [false, false, true]}]}]}},
  'status-rack-data': {...L, kind: 'status-rack', rack: {mode: 'data', source: 'CI dashboard', rows: [{label: 'Test', states: [{at: .6, lights: [true, true, true]}]}]}},
  'code-snippet': {...L, kind: 'code-snippet', code: {language: 'TypeScript', lines: [{at: .6, tokens: [{text: 'const ', type: 'keyword'}, {text: 'x = ', type: 'plain'}, {text: '7', type: 'number'}]}, {at: 1, tokens: [{text: ' ', type: 'plain'}, {text: '"hello"', type: 'string'}, {text: ' // hi', type: 'comment'}, {text: ' +', type: 'operator'}]}]}},
  'code-snippet-typing': {...L, kind: 'code-snippet', code: {typing: true, lines: [{at: .5, typeDuration: .8, tokens: [{text: 'const ', type: 'keyword'}, {text: 'x = 7;', type: 'plain'}]}, {at: 1.3, tokens: [{text: '<x>', type: 'string'}]}, {at: 2.2, typeDuration: .25, tokens: [{text: 'run()', type: 'plain'}]}]}},
  'excerpt': {...L, kind: 'excerpt-window', excerpt: {mode: 'illustration', lines: [{segments: [{text: 'Build a useful thing.'}]}, {segments: [{text: 'Then '}, {text: 'make it clear.', highlight: true}]}], focus: {line: 1, scale: 1.2, at: 2}}},
  'excerpt-sweep': {...L, kind: 'excerpt-window', excerpt: {mode: 'data', source: 'README.md', highlightMotion: true, lines: [{segments: [{text: 'Keep '}, {text: '<the subject>', highlight: true}]}, {segments: [{text: 'in view.'}]}, {segments: [{text: 'Always', highlight: true}]}], focus: {line: 0, scale: 1.1, at: 1.1}}},
  'excerpt-off': {...L, kind: 'excerpt-window', excerpt: {mode: 'illustration', highlightMotion: false, lines: [{segments: [{text: 'A useful idea.', highlight: true}]}], focus: {line: 0, scale: 1, at: 1}}},
  'focus-horizontal': {...L, kind: 'focus-flow', duration: 8.95, rect: {x: 80, y: 695, width: 1120, height: 340}, focus: {options: ['Compare', 'New tools', 'Side quests', 'The next build'], selected: 3, arriveAt: .28, chooseAt: 1, progressAt: 5.5, icon: 'terminal'}},
  'focus-vertical': {...L, kind: 'focus-flow', focus: {options: ['<b>A</b>', 'B', 'Third'], selected: 1, arriveAt: .6, chooseAt: 1.5, progressAt: 3, progressDuration: 1.2, progressLabel: 'Shipping the build'}},
  'focus-wide-two': {...wide, kind: 'focus-flow', focus: {options: ['Left', 'Right'], selected: 0, arriveAt: .6, chooseAt: 1.5, progressAt: 3, icon: 'rocket'}}
};

const directions = ['left', 'right', 'up', 'down', 'none'];
const fixtures = [];
const add = (name, spec) => fixtures.push({name, spec: JSON.parse(JSON.stringify(spec))});

for (const [name, spec] of Object.entries(bases)) {
  add(name, spec);
  add(`${name}/theme`, {...spec, theme: warm});
  add(`${name}/theme-no-accent-text`, {...spec, theme: warmNoInk});
  add(`${name}/glass`, {...spec, presentation: 'glass'});
  add(`${name}/glass-theme`, {...spec, presentation: 'glass', theme: warm});
  add(`${name}/solid`, {...spec, presentation: 'solid'});
  add(`${name}/accent`, {...spec, accent: '#22aa88', track: 5});
  add(`${name}/portrait-default-rect`, {...spec, aspect: '9:16', rect: undefined});
  add(`${name}/portrait`, {...spec, aspect: '9:16', rect: {x: 90, y: 300, width: 900, height: 1100}});
  add(`${name}/landscape-default-rect`, {...spec, rect: undefined});
  add(`${name}/motion-default-keys`, {...spec, motion: {}});
  add(`${name}/motion-custom`, {...spec, motion: {enter: 'right', exit: 'left', distance: 64, enterDuration: .4, exitDuration: .26, scale: .98}});
  add(`${name}/motion-glass-theme`, {...spec, presentation: 'glass', theme: warm, motion: {enter: 'down', exit: 'none', scale: .95}});
}
// Every enter/exit direction pairing on three representative kinds.
for (const name of ['callout-plain', 'media-image', 'growth-data']) {
  for (const enter of directions) for (const exit of directions) add(`${name}/motion-${enter}-${exit}`, {...bases[name], motion: {enter, exit, distance: 30}});
}
for (const name of ['media-video', 'excerpt-sweep', 'focus-horizontal', 'code-snippet-typing', 'status-rack']) {
  add(`${name}/motion-slow`, {...bases[name], motion: {enterDuration: .6, exitDuration: .5, distance: 0, scale: .92}});
}

// Legacy test specs (test/editorial_ui_modules.test.js), valid and invalid.
const base = {id: 'learn', kind: 'checklist', aspect: '16:9', start: 70, duration: 28, title: 'What you will learn', rect: {x: 70, y: 130, width: 850, height: 820}};
const row = {label: 'Engineering principles', status: 'active', at: 2.79, doneAt: 6.72};
const expressive = {...base, id: 'reach', title: 'Getting seen', rect: {x: 80, y: 130, width: 850, height: 650}};
const points = [{label: 'Start', value: 12, at: 1}, {label: 'Later', value: 36, at: 3}, {label: 'Now', value: 180, at: 5}];
const legacy = {
  'checklist-five': {...base, rows: [row, {label: 'Security', status: 'active', at: 6.72, doneAt: 10.1}, {label: 'AI workflows', status: 'active', at: 10.1, doneAt: 16.14}, {label: 'Hands-free agent', status: 'active', at: 16.14, doneAt: 19.2}, {label: 'Content and video', status: 'active', at: 19.2}]},
  'escaped-callout': {...base, kind: 'callout', title: '</script><script>alert(1)</script>', body: '<img src=x onerror="bad()"> & text'},
  'audience-six': {...expressive, kind: 'audience-grid', audience: {columns: 3, tiles: Array.from({length: 6}, (_, i) => ({label: 'Viewer', emoji: '👤', at: 1 + i * .5}))}},
  'audience-portrait': {...expressive, kind: 'audience-grid', aspect: '9:16', rect: {x: 90, y: 400, width: 900, height: 700}, audience: {columns: 3, tiles: Array.from({length: 6}, (_, i) => ({label: 'Viewer', emoji: '👤', at: 1 + i * .5}))}},
  'audience-escaped': {...expressive, kind: 'audience-grid', audience: {tiles: [{label: '<b>A</b>', emoji: '<x>', at: 1}, {label: 'Viewer', emoji: '👤', at: 2}]}},
  'trend-escaped-source': {...expressive, kind: 'trend-chart', chart: {mode: 'data', unit: 'views', source: '<script>bad()</script>', points}},
  'trend-zero': {...expressive, kind: 'trend-chart', chart: {mode: 'illustration', unit: 'views', points: points.map(point => ({...point, value: 0}))}},
  'metric-change': {...expressive, kind: 'metric', metric: {mode: 'illustration', unit: 'growth', format: 'percent', values: [{value: 150, at: .6}, {value: -12, at: 2.2}]}},
  'growth-reference': {id: 'reach', kind: 'growth-chart', aspect: '16:9', start: 0, duration: 4.68, title: 'Reach develops', rect: {x: 70, y: 240, width: 1050, height: 640}, growth: {mode: 'illustration', unit: 'reach'}},
  'focus-reference': {id: 'focus', kind: 'focus-flow', aspect: '16:9', start: 0, duration: 8.95, title: 'One chosen task', rect: {x: 80, y: 695, width: 1120, height: 340}, focus: {options: ['Research', 'New tools', 'Side quests', 'The next build'], selected: 3, arriveAt: .28, chooseAt: 1, progressAt: 5.5, progressDuration: .8, progressLabel: 'The next build'}},
  'code-escaped': {...expressive, kind: 'code-snippet', code: {lines: [{at: 1, tokens: [{text: '<script>bad()</script>', type: 'plain'}]}]}},
  'callout-safe-segments': {...expressive, kind: 'callout', treatment: {segments: [{text: '<script>bad()</script>', highlight: true}]}},
  'excerpt-escaped': {...expressive, kind: 'excerpt-window', excerpt: {mode: 'illustration', lines: [{segments: [{text: '<script>bad()</script>'}]}], focus: {line: 0, scale: 1.2, at: 2}}},
  'checklist-portrait-pending': {...base, aspect: '9:16', rect: undefined, rows: [{label: 'Only pending', status: 'pending', at: 1}]}
};
for (const [name, spec] of Object.entries(legacy)) add(`legacy/${name}`, spec);

// Error cases: one or more per validation message.
const callout = {...L, kind: 'callout', body: 'Clear copy.'};
const errors = {
  'not-object': [],
  'null': null,
  'unsupported-key': {...callout, percent: 95},
  'bad-id': {...callout, id: 'x";bad()'},
  'missing-id': {kind: 'factory'},
  'bad-kind': {...callout, kind: 'factory'},
  'bad-presentation': {...callout, presentation: 'arbitrary-css'},
  'numbered-checklist': {...bases.checklist, numbered: true},
  'numbered-non-boolean': {...bases['step-rail'], numbered: 'yes'},
  'bad-aspect': {...callout, aspect: '4:3'},
  'bad-start': {...callout, start: -1},
  'bad-duration': {...callout, duration: NaN},
  'motion-not-object': {...callout, motion: 'up'},
  'motion-unsupported': {...callout, motion: {filter: 'blur(4px)'}},
  'motion-enter': {...callout, motion: {enter: 'diagonal'}},
  'motion-exit': {...callout, motion: {exit: '<script>'}},
  'motion-distance': {...callout, motion: {distance: 97}},
  'motion-enter-duration': {...callout, motion: {enterDuration: .7}},
  'motion-exit-duration': {...callout, motion: {exitDuration: .1}},
  'motion-scale': {...callout, motion: {scale: 1.1}},
  'motion-hold': {...callout, duration: 1, motion: {enterDuration: .6, exitDuration: .5}},
  'rect-not-object': {...callout, rect: [1, 2]},
  'rect-unsupported': {...callout, rect: {...L.rect, z: 1}},
  'rect-width': {...callout, rect: {...L.rect, width: 300}},
  'rect-height': {...callout, rect: {...L.rect, height: 100}},
  'rect-x': {...callout, rect: {...L.rect, x: 1600}},
  'rect-y': {...callout, rect: {...L.rect, y: 900}},
  'title-empty': {...callout, title: '   '},
  'title-long': {...callout, title: 'x'.repeat(55)},
  'accent': {...callout, accent: 'red;bad()'},
  'theme-null': {...callout, theme: null},
  'theme-array': {...callout, theme: []},
  'theme-empty': {...callout, theme: {}},
  'theme-surface': {...callout, theme: {...warm, surface: 'red'}},
  'theme-foreground': {...callout, theme: {...warm, foreground: '#123'}},
  'theme-muted': {...callout, theme: {...warm, muted: 123456}},
  'theme-accent-text': {...callout, theme: {...warm, accentText: '#fff;bad()'}},
  'theme-unsupported': {...callout, theme: {...warm, font: 'external'}},
  'foreign-field': {...callout, rows: []},
  'status-labels-kind': {...callout, statusLabels: {pending: 'P'}},
  'status-labels-unsupported': {...bases.checklist, statusLabels: {later: 'P'}},
  'status-labels-long': {...bases.checklist, statusLabels: {done: 'x'.repeat(15)}},
  'track-range': {...callout, track: 99},
  'track-integer': {...callout, track: 1.5},
  'media-missing': {...bases['media-image'], media: undefined},
  'media-kind': {...bases['media-image'], media: {kind: 'audio', src: 'assets/a.mp3'}},
  'media-src-url': {...bases['media-image'], media: {kind: 'video', src: 'https://example.com/video.mp4'}},
  'media-src-abs': {...bases['media-image'], media: {kind: 'video', src: '/private/video.mp4'}},
  'media-src-dotdot': {...bases['media-image'], media: {kind: 'video', src: 'assets/../secret.mp4'}},
  'media-src-quote': {...bases['media-image'], media: {kind: 'video', src: 'assets/a"bad.mp4'}},
  'media-source-start-image': {...bases['media-image'], media: {kind: 'image', src: 'assets/a.png', sourceStart: 1}},
  'media-source-start-range': {...bases['media-image'], media: {kind: 'video', src: 'assets/a.mp4', sourceStart: -1}},
  'callout-body-missing': {...callout, body: undefined},
  'callout-too-short': {...callout, rect: {...L.rect, height: 160}, body: 'word '.repeat(30)},
  'treatment-unsupported': {...bases['callout-treated-full'], treatment: {color: 'red'}},
  'treatment-glow': {...bases['callout-treated-full'], treatment: {glow: 'true'}},
  'treatment-icon': {...bases['callout-treated-full'], treatment: {icon: 'github'}},
  'treatment-both': {...bases['callout-treated-full'], body: 'Conflicting copy'},
  'treatment-segments-empty': {...bases['callout-treated-full'], treatment: {segments: []}},
  'treatment-segment-unsupported': {...bases['callout-treated-full'], treatment: {segments: [{text: 'ok', bold: true}]}},
  'treatment-segment-text': {...bases['callout-treated-full'], treatment: {segments: [{text: ''}]}},
  'treatment-segment-highlight': {...bases['callout-treated-full'], treatment: {segments: [{text: 'ok', highlight: 'yes'}]}},
  'treatment-underline-fit': {...bases['callout-treated-full'], rect: {x: 80, y: 80, width: 420, height: 500}, treatment: {segments: [{text: 'very long unbroken emphasized phrase needing two full lines', underlineAt: 2}]}},
  'treatment-underline-early': {...bases['callout-treated-underline'], treatment: {at: .6, segments: [{text: 'early', underlineAt: .7}]}},
  'treatment-combined-long': {...bases['callout-treated-full'], treatment: {segments: [{text: 'x'.repeat(100)}, {text: 'y'.repeat(100)}]}},
  'treatment-too-short': {...bases['callout-treated-full'], rect: {...L.rect, height: 160}, treatment: {icon: 'users', segments: [{text: 'word '.repeat(30)}]}},
  'treatment-corners-clearance': {...bases['callout-treated-full'], rect: {...L.rect, x: 0}},
  'treatment-at': {...bases['callout-treated-full'], treatment: {at: 7.9}},
  'excerpt-highlight-motion': {...bases['excerpt-sweep'], excerpt: {...bases['excerpt-sweep'].excerpt, highlightMotion: 'yes'}},
  'excerpt-mode': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, mode: 'real'}},
  'excerpt-data-source': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, mode: 'data'}},
  'excerpt-illustration-source': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, source: 'x'}},
  'excerpt-lines': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, lines: []}},
  'excerpt-focus-line': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, focus: {line: 2, scale: 1.2, at: 2}}},
  'excerpt-focus-integer': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, focus: {line: .5, scale: 1.2, at: 2}}},
  'excerpt-focus-scale': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, focus: {line: 1, scale: 1.4, at: 2}}},
  'excerpt-too-short': {...bases.excerpt, rect: {...L.rect, height: 200}},
  'excerpt-segments': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, lines: [{segments: []}, {segments: [{text: 'x'}]}]}},
  'excerpt-segment-text': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, lines: [{segments: [{text: 'a\tb'}]}, {segments: [{text: 'x'}]}]}},
  'excerpt-segment-highlight': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, lines: [{segments: [{text: 'a', highlight: 1}]}, {segments: [{text: 'x'}]}]}},
  'excerpt-line-long': {...bases.excerpt, excerpt: {...bases.excerpt.excerpt, lines: [{segments: [{text: 'x'.repeat(119)}]}, {segments: [{text: 'x'}]}]}},
  'excerpt-sweep-settle': {...bases['excerpt-sweep'], duration: 1.6},
  'date-month-range': {...bases['date-card'], date: {...bases['date-card'].date, month: 13}},
  'date-year-range': {...bases['date-card'], date: {...bases['date-card'].date, year: 0}},
  'rack-mode-invalid': {...bases['status-rack'], rack: {...bases['status-rack'].rack, mode: 'live'}},
  'rack-row-unsupported': {...bases['status-rack'], rack: {mode: 'illustration', rows: [{label: 'A', color: 'red', states: []}]}},
  'date-month': {...bases['date-card'], date: {...bases['date-card'].date, month: 2.5}},
  'date-day': {...bases['date-card'], date: {...bases['date-card'].date, day: 0}},
  'date-year': {...bases['date-card'], date: {...bases['date-card'].date, year: 20.5}},
  'date-leap': {...bases['date-card'], date: {...bases['date-card'].date, year: 2027}},
  'date-april': {...bases['date-card'], date: {...bases['date-card'].date, month: 4, day: 31}},
  'date-century': {...bases['date-card'], date: {...bases['date-card'].date, year: 1900}},
  'date-too-short': {...bases['date-card'], rect: {...L.rect, height: 160}},
  'date-caption': {...bases['date-card'], date: {...bases['date-card'].date, caption: 'x'.repeat(43)}},
  'rack-mode': {...bases['status-rack'], rack: {...bases['status-rack'].rack, mode: 'data'}},
  'rack-rows': {...bases['status-rack'], rack: {...bases['status-rack'].rack, rows: Array(9).fill(bases['status-rack'].rack.rows[0])}},
  'rack-too-short': {...bases['status-rack'], rect: {...L.rect, height: 200}},
  'rack-label-long': {...bases['status-rack'], rect: {...L.rect, width: 420}, rack: {mode: 'illustration', rows: [{label: 'A very long rack label', states: [{at: 1, lights: [true, false, false]}]}]}},
  'rack-states': {...bases['status-rack'], rack: {mode: 'illustration', rows: [{label: 'A', states: []}]}},
  'rack-state-order': {...bases['status-rack'], rack: {mode: 'illustration', rows: [{label: 'A', states: [{at: 1, lights: [true, false, false]}, {at: 1.2, lights: [true, true, false]}]}]}},
  'rack-lights': {...bases['status-rack'], rack: {mode: 'illustration', rows: [{label: 'Bad', states: [{at: 1, lights: [1, false, true]}]}]}},
  'code-typing-type': {...bases['code-snippet-typing'], code: {...bases['code-snippet-typing'].code, typing: 'yes'}},
  'code-type-duration-no-typing': {...bases['code-snippet-typing'], code: {...bases['code-snippet-typing'].code, typing: false}},
  'code-type-duration-range': {...bases['code-snippet-typing'], code: {typing: true, lines: [{at: .5, typeDuration: .01, tokens: [{text: 'x', type: 'plain'}]}]}},
  'code-typing-overlap': {...bases['code-snippet-typing'], code: {typing: true, lines: [{at: .5, typeDuration: .8, tokens: [{text: 'x', type: 'plain'}]}, {at: 1, tokens: [{text: 'y', type: 'plain'}]}]}},
  'code-typing-settle': {...bases['code-snippet-typing'], duration: 2, code: {typing: true, lines: [{at: 1, typeDuration: 1, tokens: [{text: 'x', type: 'plain'}]}]}},
  'code-lines': {...bases['code-snippet'], code: {lines: Array(4).fill(bases['code-snippet'].code.lines[0])}},
  'code-language': {...bases['code-snippet'], code: {...bases['code-snippet'].code, language: 'x'.repeat(25)}},
  'code-too-short': {...bases['code-snippet'], rect: {...L.rect, height: 200}},
  'code-order': {...bases['code-snippet'], code: {lines: [{at: 1, tokens: [{text: 'a', type: 'plain'}]}, {at: 1.1, tokens: [{text: 'b', type: 'plain'}]}]}},
  'code-tokens': {...bases['code-snippet'], code: {lines: [{at: 1, tokens: []}]}},
  'code-token-type': {...bases['code-snippet'], code: {lines: [{at: 1, tokens: [{text: 'bad', type: 'html'}]}]}},
  'code-token-newline': {...bases['code-snippet'], code: {lines: [{at: 1, tokens: [{text: 'a\nb', type: 'plain'}]}]}},
  'code-token-long': {...bases['code-snippet'], code: {lines: [{at: 1, tokens: [{text: 'x'.repeat(81), type: 'plain'}]}]}},
  'code-line-long': {...bases['code-snippet'], code: {lines: [{at: 1, tokens: [{text: 'x'.repeat(80), type: 'plain'}]}]}},
  'audience-tiles': {...bases['audience-grid'], audience: {tiles: [{label: 'One', at: 1}]}},
  'audience-columns': {...bases['audience-grid'], audience: {...bases['audience-grid'].audience, columns: 2.5}},
  'audience-columns-count': {...bases['audience-grid'], audience: {...bases['audience-grid'].audience, columns: 4}},
  'audience-fit': {...bases['audience-grid'], rect: {...L.rect, height: 160}},
  'audience-label-long': {...bases['audience-grid'], rect: {...L.rect, width: 420}, audience: {tiles: [{label: 'x'.repeat(24), at: 1}, {label: 'y', at: 2}]}},
  'audience-emoji': {...bases['audience-grid'], audience: {tiles: [{label: 'One', emoji: 'much too long accent', at: 1}, {label: 'Two', at: 2}]}},
  'audience-emoji-compact': {...bases['audience-grid'], audience: {tiles: [{label: 'One', emoji: 'abcdefghi', at: 1}, {label: 'Two', at: 2}]}},
  'focus-options': {...bases['focus-vertical'], focus: {...bases['focus-vertical'].focus, options: ['One']}},
  'focus-distinct': {...bases['focus-vertical'], focus: {...bases['focus-vertical'].focus, options: ['Same', 'same']}},
  'focus-selected': {...bases['focus-vertical'], focus: {...bases['focus-vertical'].focus, selected: 4}},
  'focus-selected-integer': {...bases['focus-vertical'], focus: {...bases['focus-vertical'].focus, selected: .5}},
  'focus-icon': {...bases['focus-vertical'], focus: {...bases['focus-vertical'].focus, icon: 'github'}},
  'focus-hold': {...bases['focus-vertical'], focus: {...bases['focus-vertical'].focus, chooseAt: .7}},
  'focus-settle': {...bases['focus-vertical'], focus: {...bases['focus-vertical'].focus, progressAt: 1.6}},
  'focus-progress-duration': {...bases['focus-vertical'], focus: {...bases['focus-vertical'].focus, progressDuration: 3}},
  'focus-progress-hold': {...bases['focus-vertical'], focus: {...bases['focus-vertical'].focus, progressAt: 6.5}},
  'focus-option-long': {...bases['focus-vertical'], rect: {...L.rect, width: 420}, focus: {...bases['focus-vertical'].focus, options: ['x'.repeat(24), 'B']}},
  'focus-fit': {...bases['focus-vertical'], rect: {...L.rect, height: 200}},
  'chart-growth-show-values': {...bases['growth-default'], growth: {mode: 'illustration', showValues: 'no'}},
  'chart-growth-data-points': {...bases['growth-default'], growth: {mode: 'data', source: 'Analytics'}},
  'chart-growth-duration': {...bases['growth-default'], duration: 2.5},
  'chart-mode': {...bases['trend-chart'], chart: {...bases['trend-chart'].chart, mode: 'real'}},
  'chart-points': {...bases['trend-chart'], chart: {...bases['trend-chart'].chart, points: [{label: 'a', value: 1, at: 1}]}},
  'chart-unit': {...bases['trend-chart'], chart: {...bases['trend-chart'].chart, unit: undefined}},
  'chart-source': {...bases['trend-chart'], chart: {...bases['trend-chart'].chart, mode: 'data'}},
  'chart-illustration-source': {...bases['trend-chart'], chart: {...bases['trend-chart'].chart, source: 'Misleading'}},
  'chart-fit': {...bases['trend-chart'], rect: {...L.rect, height: 160}},
  'chart-point-unsupported': {...bases['trend-chart'], chart: {...bases['trend-chart'].chart, points: [{label: 'a', value: 1, at: 1, percentage: 99}, {label: 'b', value: 2, at: 2}]}},
  'chart-point-value': {...bases['trend-chart'], chart: {...bases['trend-chart'].chart, points: [{label: 'a', value: Infinity, at: 1}, {label: 'b', value: 2, at: 2}]}},
  'chart-point-whole': {...bases['trend-chart'], chart: {...bases['trend-chart'].chart, points: [{label: 'a', value: .5, at: 1}, {label: 'b', value: 2, at: 2}]}},
  'chart-growth-decrease': {...bases['growth-data'], growth: {mode: 'illustration', points: [{label: 'a', value: 20, at: 1}, {label: 'b', value: 10, at: 2}]}},
  'chart-label-long': {...bases['trend-chart'], rect: {...L.rect, width: 420}, chart: {...bases['trend-chart'].chart, points: Array.from({length: 6}, (_, i) => ({label: 'x'.repeat(16), value: i, at: 1 + i * .5}))}},
  'chart-time-order': {...bases['trend-chart'], chart: {...bases['trend-chart'].chart, points: [{label: 'a', value: 1, at: 1}, {label: 'b', value: 2, at: 1.2}]}},
  'chart-metric-wide': {...bases['trend-chart'], rect: {...L.rect, width: 420}, chart: {mode: 'illustration', unit: 'x'.repeat(18), points: [{label: 'a', value: 1, at: 1}, {label: 'b', value: 900000000, at: 2}]}},
  'chart-exit': {...bases['growth-data'], motion: {}, growth: {...bases['growth-data'].growth, points: [{label: 'a', value: 1, at: 1}, {label: 'b', value: 2, at: 7.4}]}},
  'metric-mode': {...bases['metric-number'], metric: {...bases['metric-number'].metric, mode: 'real'}},
  'metric-data-source': {...bases['metric-number'], metric: {...bases['metric-number'].metric, mode: 'data'}},
  'metric-illustration-source': {...bases['metric-number'], metric: {...bases['metric-number'].metric, source: 'x'}},
  'metric-values': {...bases['metric-number'], metric: {...bases['metric-number'].metric, values: []}},
  'metric-value-range': {...bases['metric-number'], metric: {...bases['metric-number'].metric, values: [{value: Infinity, at: .6}]}},
  'metric-at': {...bases['metric-number'], metric: {...bases['metric-number'].metric, values: [{value: 1, at: .1}]}},
  'metric-spacing': {...bases['metric-number'], metric: {...bases['metric-number'].metric, values: [{value: 1, at: 1}, {value: 2, at: 1.5}]}},
  'metric-unit': {...bases['metric-number'], metric: {...bases['metric-number'].metric, unit: ''}},
  'metric-format': {...bases['metric-number'], metric: {...bases['metric-number'].metric, format: 'ratio'}},
  'metric-decimals': {...bases['metric-number'], metric: {...bases['metric-number'].metric, decimals: 3}},
  'metric-decimals-integer': {...bases['metric-number'], metric: {...bases['metric-number'].metric, decimals: .5}},
  'metric-currency-code': {...bases['metric-number'], metric: {...bases['metric-number'].metric, format: 'currency'}},
  'metric-currency-misuse': {...bases['metric-number'], metric: {...bases['metric-number'].metric, currency: 'USD'}},
  'metric-too-wide': {...bases['metric-number'], rect: {...L.rect, width: 420}, metric: {...bases['metric-number'].metric, values: [{value: 999999999, at: .6}], format: 'currency', currency: 'USD'}},
  'metric-too-short': {...bases['metric-number'], rect: {...L.rect, height: 200}},
  'metric-motion-at': {...bases['metric-number'], duration: 4, motion: {exitDuration: .5}, metric: {...bases['metric-number'].metric, values: [{value: 12, at: .6}, {value: 36, at: 3}]}},
  'progress-max': {...bases.progress, progress: {...bases.progress.progress, max: 0}},
  'progress-label': {...bases.progress, progress: {...bases.progress.progress, label: 'x'.repeat(33)}},
  'progress-range': {...bases.progress, progress: {...bases.progress.progress, values: [{value: 101, at: .6}]}},
  'progress-negative': {...bases.progress, progress: {...bases.progress.progress, values: [{value: -1, at: .6}]}},
  'progress-unsupported': {...bases.progress, progress: {...bases.progress.progress, unit: 'x'}},
  'checklist-rows': {...bases.checklist, rows: []},
  'checklist-too-short': {...bases.checklist, rows: Array(6).fill(row), rect: {...L.rect, height: 160}},
  'checklist-row-unsupported': {...bases.checklist, rows: [{...row, color: 'red'}]},
  'checklist-row-label': {...bases.checklist, rows: [{...row, label: ''}]},
  'checklist-row-status': {...bases.checklist, rows: [{...row, status: 'later'}]},
  'checklist-row-at': {...bases.checklist, rows: [{...row, at: 28}]},
  'checklist-done-at': {...bases.checklist, rows: [{...row, at: 2, doneAt: 1}]},
  'checklist-done-at-status': {...bases.checklist, rows: [{label: 'x', status: 'done', at: 1, doneAt: 2}]},
  'checklist-label-long': {...bases.checklist, rows: [{...row, label: 'Engineering principles and production foundations'}], rect: {x: 0, y: 0, width: 420, height: 300}},
  'checklist-motion-at': {...bases.checklist, motion: {enterDuration: .6}, rows: [{label: 'Too early', status: 'active', at: .4}]},
  'step-steps': {...bases['step-rail'], steps: [{label: 'Only', at: 1}]},
  'step-too-short': {...bases['step-rail'], rect: {...L.rect, height: 200}},
  'step-unsupported': {...bases['step-rail'], steps: [{label: 'A', at: 1, icon: 'x'}, {label: 'B', at: 2}]},
  'step-label': {...bases['step-rail'], steps: [{label: 'x'.repeat(23), at: 1}, {label: 'B', at: 2}]},
  'step-label-long': {...bases['step-rail'], rect: {...L.rect, width: 420}, steps: Array.from({length: 6}, (_, i) => ({label: 'x'.repeat(20), at: 1 + i}))},
  'step-order': {...bases['step-rail'], steps: [{label: 'Plan', at: 2}, {label: 'Build', at: 1}]},
  'step-at': {...bases['step-rail'], steps: [{label: 'Plan', at: 0}, {label: 'Build', at: 1}]}
};
for (const [name, spec] of Object.entries(errors)) add(`error/${name}`, spec);

const corpus = fixtures.map(({name, spec}) => {
  try {
    return {name, spec, output: buildEditorialModule(spec)};
  } catch (error) {
    return {name, spec, error: error.message};
  }
});
await writeFile(out, `${JSON.stringify(corpus)}\n`);
const failed = corpus.filter(entry => entry.error).length;
process.stdout.write(`${corpus.length} fixtures (${corpus.length - failed} outputs, ${failed} errors) → ${out.pathname}\n`);
