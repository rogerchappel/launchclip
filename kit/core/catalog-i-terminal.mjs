// Catalogue I terminal-session: a terminal window that types its commands
// character by character, streams each command's output rows (plain lines or
// PASS/FAIL rows with timings), scrolls when the rows outgrow the window,
// shows a fast-forward elapsed timer in the title bar while a long run
// streams, and draws a box round a path or token. Monospace at 0.6 em, so the
// box lands on the glyphs (kit/core/catalog-i-code-base.mjs). Registered
// with the code-evidence modules (kit/core/catalog-i-code.mjs).

import {frameSamples, timingRules} from './catalog-b-base.mjs';
import {sampleTime} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase} from './catalog-h-base.mjs';
import {iconNode} from './icons.mjs';
import {CODE_ADVANCE, abs, cardPalette, codeFont, cropLine, el, hex2, panelStyle, r2, rt, set, tw, windowBar} from './catalog-i-code-base.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const TERMINAL_VARIANTS = Object.freeze(['glass', 'solid']);
const STATUS = Object.freeze({PASS: 'add', OK: 'add', FAIL: 'del', ERROR: 'del', SKIP: 'muted'});
const TONES = ['fg', 'muted', 'accent', 'add', 'del'];
export const MAX_STEPS = 8;
const MAX_ROWS = 30;

const clock = s => {
  const v = Math.max(0, Math.round(s)), h = Math.floor(v / 3600), m = Math.floor(v / 60) % 60, sec = String(v % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** One output row → {parts: [{v, c}], text} (text: the plain string, for widths). */
function outputRow(check, raw, path) {
  if (typeof raw === 'string') {
    if (raw.length > 160 || /[\r\n]/.test(raw)) check.fail(path, 'must be one line of at most 160 characters');
    return {parts: [{v: raw, c: 'fg'}], text: raw};
  }
  check.obj(raw, path, ['status', 'time', 'text', 'tone'], ['text']);
  const text = check.str(raw.text, `${path}.text`, 140);
  if (raw.status === undefined) {
    const tone = raw.tone === undefined ? 'fg' : check.oneOf(raw.tone, `${path}.tone`, TONES);
    return {parts: [{v: text, c: tone}], text};
  }
  const status = check.oneOf(raw.status, `${path}.status`, Object.keys(STATUS));
  const time = raw.time === undefined ? '' : check.str(raw.time, `${path}.time`, 10);
  const head = `  ${status.padEnd(5)}`, mid = `${time.padStart(9)}  `;
  return {parts: [{v: head, c: STATUS[status], b: true}, {v: mid, c: 'muted'}, {v: text, c: 'fg'}], text: `${head}${mid}${text}`};
}

function terminalResolve(params, ctx) {
  const b = createHBase('terminal-session', params, ctx, {allowed: ['title', 'prompt', 'steps', 'stream', 'timer', 'highlight', 'at'], required: ['steps'], variants: TERMINAL_VARIANTS});
  const {u, rect, check, portrait} = b;
  const p = b.params;
  const title = p.title === undefined ? 'zsh' : check.str(p.title, 'params.title', 60);
  const prompt = p.prompt === undefined ? '$' : check.str(p.prompt, 'params.prompt', 6);
  const stream = p.stream === undefined ? 0.12 : check.num(p.stream, 'params.stream', 0.03, 1);
  check.arr(p.steps, 'params.steps', 1, MAX_STEPS);
  const steps = p.steps.map((s, i) => {
    const path = `params.steps[${i}]`;
    check.obj(s, path, ['cmd', 'output', 'at', 'typing'], ['cmd']);
    const cmd = check.str(s.cmd, `${path}.cmd`, 160);
    const output = s.output === undefined ? [] : check.arr(s.output, `${path}.output`, 0, MAX_ROWS).map((r, k) => outputRow(check, r, `${path}.output[${k}]`));
    return {cmd, output, at: s.at, typing: s.typing === undefined ? Math.min(1.4, Math.max(0.25, cmd.length / 28)) : check.num(s.typing, `${path}.typing`, 0.1, 6)};
  });
  let highlight = null;
  if (p.highlight !== undefined) {
    const h = typeof p.highlight === 'string' ? {token: p.highlight} : check.obj(p.highlight, 'params.highlight', ['token', 'step', 'row', 'at'], ['token']);
    const token = check.str(h.token, typeof p.highlight === 'string' ? 'params.highlight' : 'params.highlight.token', 80);
    const step = h.step === undefined ? steps.findIndex(s => s.cmd.includes(token)) : check.int(h.step, 'params.highlight.step', 0, steps.length - 1);
    if (step < 0) check.fail('params.highlight', `token ${JSON.stringify(token)} is in no command; give params.highlight.step (and row) to box it in an output row`);
    const row = h.row === undefined ? null : check.int(h.row, 'params.highlight.row', 0, steps[step].output.length - 1);
    const where = row === null ? steps[step].cmd : steps[step].output[row].text;
    if (!where.includes(token)) check.fail('params.highlight', `token ${JSON.stringify(token)} is not in ${row === null ? `steps[${step}].cmd` : `steps[${step}].output[${row}]`}`);
    highlight = {token, step, row, col: where.indexOf(token), vcol: null, at: h.at};
  }
  let timer = null;
  if (p.timer !== undefined) {
    const t = check.obj(p.timer, 'params.timer', ['to', 'from', 'step'], ['to']);
    const step = t.step === undefined ? steps.findLastIndex(s => s.output.length) : check.int(t.step, 'params.timer.step', 0, steps.length - 1);
    if (step < 0 || !steps[step].output.length) check.fail('params.timer', 'needs a step with output to run over (params.timer.step)');
    timer = {from: t.from === undefined ? 0 : check.num(t.from, 'params.timer.from', 0, 86400), to: check.num(t.to, 'params.timer.to', 1, 86400), step};
    if (timer.to <= timer.from) check.fail('params.timer.to', 'must be greater than params.timer.from');
  }

  // Lines: each step's command, then its output rows, then a last idle prompt.
  const lines = [];
  steps.forEach((s, i) => {
    s.line = lines.length;
    lines.push({kind: 'cmd', step: i, text: `${prompt} ${s.cmd}`});
    s.output.forEach((r, k) => lines.push({kind: 'out', step: i, row: k, text: r.text, parts: r.parts}));
  });
  lines.push({kind: 'idle', text: `${prompt} `});

  const pal = cardPalette(b, b.variant === 'solid' ? 'github' : 'glass');
  const W = r2(Math.min(rect.width, u(portrait ? 1000 : 1560)));
  const barH = u(54), pad = u(26);
  const longest = Math.max(...lines.map(l => l.text.length + 1), 24);
  let size = Math.floor(u(portrait ? 30 : 32));
  for (; size > Math.ceil(b.min.meta); size -= 2) if ((W - 2 * pad) / (size * CODE_ADVANCE) >= longest) break;
  size = Math.max(size, Math.ceil(b.min.meta));
  const adv = size * CODE_ADVANCE, cols = Math.floor((W - 2 * pad) / adv);
  const rowH = r2(size * 1.5);
  const want = barH + 2 * pad + lines.length * rowH;
  const H = r2(Math.min(rect.height, Math.max(want, u(portrait ? 900 : 560))));
  const capacity = Math.floor((H - barH - 2 * pad) / rowH);
  if (capacity < 4) check.fail('params', 'leaves room for fewer than 4 terminal rows; give the module a larger rect');
  // Crop long lines to the window, keeping the highlighted token in view.
  for (const line of lines) {
    const keep = highlight && line.step === highlight.step && ((line.kind === 'cmd' && highlight.row === null) || (line.kind === 'out' && line.row === highlight.row))
      ? [highlight.col + (line.kind === 'cmd' ? prompt.length + 1 : 0), highlight.col + (line.kind === 'cmd' ? prompt.length + 1 : 0) + highlight.token.length] : null;
    const {text, shift} = cropLine(line.text, cols - 1, keep);
    line.shift = shift;
    if (keep) highlight.vcol = keep[0] - shift;
    if (line.kind === 'out' && (shift || text !== line.text)) line.parts = [{v: text, c: line.parts.length > 1 ? 'fg' : line.parts[0].c}];
    line.view = text;
  }

  // Timing: build, then each step types, pauses for enter, streams its rows.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const exitAt = b.motion.exitStart;
  // Defaults that would run past the exit compress (to 35% at most).
  const need = steps.reduce((t, s) => t + s.typing + 0.25 + Math.max(0, s.output.length - 1) * stream + (s.output.length ? 0.3 : 0.1), 0);
  const room = exitAt - 0.4 - (buildAt + 0.55);
  const scale = steps.every(s => s.at === undefined) && need > room ? Math.max(0.35, room / need) : 1;
  let prevEnd = rt(buildAt + 0.55);
  steps.forEach((s, i) => {
    const tm = {typing: r2(s.typing * scale), gap: r2(0.25 * scale), each: r2(stream * scale)};
    s.time = cueTime(b, `step-${i}`, s.at, `params.steps[${i}].at`, prevEnd - b.start, prevEnd - b.start);
    s.shown = prevEnd;
    s.typeEnd = rt(s.time + tm.typing);
    s.rowTimes = s.output.map((_, k) => rt(s.typeEnd + tm.gap + k * tm.each));
    s.end = rt(s.output.length ? s.rowTimes.at(-1) + 0.3 * scale : s.typeEnd + 0.1);
    b.events.push({id: `${b.id}-step-${i}`, name: `step-${i}`, time: s.time, endTime: s.end, role: 'emphasis', cue: 'type'});
    prevEnd = s.end;
    delete s.at;
  });
  if (prevEnd > exitAt + 1e-6) check.fail('params.steps', `run until ${r2(prevEnd - b.start)} s, past the exit at ${r2(exitAt - b.start)} s; lengthen the scene, shorten the output, or lower params.stream`);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.55), role: 'emphasis', cue: 'whoosh-soft'});
  lines.forEach(line => {
    if (line.kind === 'cmd') line.time = steps[line.step].shown;
    else if (line.kind === 'out') line.time = steps[line.step].rowTimes[line.row];
    else line.time = prevEnd;
  });
  if (timer) {
    const s = steps[timer.step];
    timer.start = rt(s.typeEnd + 0.1); timer.end = rt(s.rowTimes.at(-1) + 0.2);
    timer.samples = frameSamples(timer.start, timer.end, b.fps, t => ({text: clock(timer.from + (timer.to - timer.from) * Math.min(1, (t - timer.start) / (timer.end - timer.start)))}));
    timer.first = clock(timer.from);
    b.events.push({id: `${b.id}-timer`, name: 'timer', time: timer.start, endTime: timer.end, role: 'emphasis', cue: 'tick'});
  }
  if (highlight) {
    const s = steps[highlight.step];
    const ready = highlight.row === null ? s.typeEnd : s.rowTimes[highlight.row];
    highlight.time = cueTime(b, 'highlight', highlight.at, 'params.highlight.at', ready - b.start + 0.3, ready - b.start);
    b.events.push({id: `${b.id}-highlight`, name: 'highlight', time: highlight.time, endTime: rt(highlight.time + 0.55), role: 'emphasis', cue: 'hit-soft'});
    const line = lines.findIndex(l => l.step === highlight.step && (highlight.row === null ? l.kind === 'cmd' : l.kind === 'out' && l.row === highlight.row));
    const bx = u(4);
    highlight.box = {line, x: r2(highlight.vcol * adv - bx), y: r2(line * rowH + rowH * 0.1), w: r2(highlight.token.length * adv + 2 * bx), h: r2(rowH * 0.8)};
    delete highlight.at;
  }
  // Typed command text: per-frame samples, split round the highlight token.
  steps.forEach((s, i) => {
    const line = lines[s.line];
    const typed = line.view.slice(prompt.length + 1);
    const cut = highlight && highlight.step === i && highlight.row === null ? [highlight.vcol - prompt.length - 1, highlight.vcol - prompt.length - 1 + highlight.token.length] : null;
    s.segments = cut ? [typed.slice(0, cut[0]), typed.slice(cut[0], cut[1]), typed.slice(cut[1])] : [typed];
    const total = typed.length;
    const samples = frameSamples(s.time, s.typeEnd, b.fps, t => ({n: Math.min(total, Math.floor(total * Math.min(1, (t - s.time) / (s.typeEnd - s.time)) + 1e-9))}));
    let offset = 0;
    s.typed = s.segments.map(seg => {
      const from = offset;
      offset += seg.length;
      const out = [];
      let last = '';
      for (const sm of samples) {
        const v = seg.slice(0, Math.max(0, Math.min(seg.length, sm.n - from)));
        if (v !== last) { out.push({t: sm.t, text: v}); last = v; }
      }
      if (last !== seg) out.push({t: s.typeEnd, text: seg});
      return out;
    });
  });
  const scroll = lines.map((l, k) => (k >= capacity ? {t: l.time, y: r2(-(k - capacity + 1) * rowH)} : null)).filter(Boolean);
  const x = r2((rect.width - W) / 2), y = r2((rect.height - H) / 2);
  const content = {variant: b.variant, pal, code: codeFont(b.fonts), title, prompt, x, y, W, H, barH, pad, size, rowH, adv: r2(adv), lines: lines.map(({kind, step, row, view, parts, time}) => ({kind, step, row, view, parts, time})),
    steps: steps.map(s => ({line: s.line, time: s.time, shown: s.shown, typeEnd: s.typeEnd, end: s.end, segments: s.segments, typed: s.typed})), scroll, scrollStep: r2(Math.min(0.12, stream * scale * 0.9)), timer, highlight, buildAt, buildEnd: rt(buildAt + 0.55), end: prevEnd};
  return b.finish(content, {minTextPx: b.min.key});
}

/** Default cue `fallback` (scene-relative) clamped into [min, last event], then timeOf. */
function cueTime(b, name, value, path, fallback, min) {
  return b.timeOf(name, value, path, Math.max(min, Math.min(fallback, b.lastEvent)), {min: Math.max(0, min - 1e-6)});
}

function terminalView(model) {
  const {id, unit: u} = model;
  const c = model.content, pal = c.pal;
  const t = {fontFamily: c.code, fontSize: c.size, lineHeight: `${c.rowH}px`, whiteSpace: 'pre', margin: 0};
  const rows = c.lines.map((line, k) => {
    const y = r2(k * c.rowH);
    let kids;
    if (line.kind === 'out') kids = line.parts.map(part => el('span', null, {color: pal[part.c] ?? pal.fg, ...(part.b ? {fontWeight: 700} : {})}, [part.v]));
    else {
      const promptSpan = el('span', null, {color: pal.accent, fontWeight: 700}, [`${c.prompt} `]);
      const cursor = el('span', `${id}-cur-${k}`, {display: 'inline-block', width: r2(c.adv), height: r2(c.size * 1.1), verticalAlign: 'text-bottom', background: pal.fg, opacity: 0});
      const typed = line.kind === 'cmd' ? c.steps[line.step].segments.map((_, g) => el('span', `${id}-ty-${line.step}-${g}`, {color: g === 1 ? pal.accent : pal.fg}, [''])) : [];
      kids = [promptSpan, ...typed, cursor];
    }
    return el('div', `${id}-ln-${k}`, abs(0, y, r2(c.W - 2 * c.pad), c.rowH, {...t, color: pal.fg, opacity: 0}), kids);
  });
  if (c.highlight) {
    const hb = c.highlight.box;
    rows.push(el('svg', `${id}-hl`, abs(hb.x, hb.y, hb.w, hb.h, {overflow: 'visible'}), [
      el('rect', `${id}-hlf`, {opacity: 0}, [], {x: 0, y: 0, width: hb.w, height: hb.h, rx: r2(4 * u), fill: hex2(pal.accent, 0.12)}),
      el('rect', `${id}-hlr`, {strokeDasharray: 1, strokeDashoffset: 1, filter: `drop-shadow(0 0 ${r2(6 * u)}px ${hex2(pal.accent, 0.8)})`}, [], {x: 0, y: 0, width: hb.w, height: hb.h, rx: r2(4 * u), fill: 'none', stroke: pal.accent, strokeWidth: r2(2.5 * u), pathLength: 1})
    ], {width: hb.w, height: hb.h, viewBox: `0 0 ${hb.w} ${hb.h}`, fill: 'none'}));
  }
  const bar = windowBar(c.W, c.barH, c.title, pal, c.code, c.size, u);
  const kids = [bar, el('div', null, abs(c.pad, r2(c.barH + c.pad), r2(c.W - 2 * c.pad), r2(c.H - c.barH - 2 * c.pad), {overflow: 'hidden'}), [el('div', `${id}-scroll`, abs(0, 0, r2(c.W - 2 * c.pad), r2(c.lines.length * c.rowH)), rows)])];
  if (c.timer) {
    const s = r2(c.size * 0.9), w = r2(s * 1.3 + 9 * c.adv);
    kids.push(el('div', `${id}-timer`, abs(r2(c.W - c.pad - w), 0, w, c.barH, {opacity: 0}), [
      iconNode('fast-forward', {x: 0, y: r2((c.barH - s) / 2), size: s, color: pal.accent, mode: 'duotone', tintOpacity: 1, stroke: 1.5}),
      el('div', `${id}-clock`, abs(r2(s * 1.3), 0, r2(w - s * 1.3), c.barH, {fontFamily: c.code, fontSize: s, lineHeight: `${c.barH}px`, color: pal.accent, fontWeight: 700, textAlign: 'right', margin: 0, whiteSpace: 'nowrap'}), [c.timer.first])
    ]));
  }
  return [el('div', `${id}-win`, abs(c.x, c.y, c.W, c.H, panelStyle(pal, u, 16)), kids)];
}

/** Blink a cursor (on 0.53 s, off 0.53 s) over [from, to). */
function blink(ops, target, from, to) {
  for (let t = from, on = true; t < to - 1e-6; t = rt(t + 0.53), on = !on) set(ops, target, t, {opacity: on ? 1 : 0});
  set(ops, target, to, {opacity: 0});
}

function terminalTimeline(model, ops) {
  const {id, start, unit: u, end} = model;
  const c = model.content;
  const from = {opacity: 0, x: 0, y: r2(26 * u), scaleX: 0.97, scaleY: 0.97, blur: r2(12 * u)};
  set(ops, `${id}-win`, start, from);
  tw(ops, `${id}-win`, c.buildAt, 0.55, 'power3.out', from, {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, blur: 0});
  c.lines.forEach((line, k) => {
    set(ops, `${id}-ln-${k}`, start, {opacity: 0});
    set(ops, `${id}-ln-${k}`, line.time, {opacity: 1});
  });
  c.steps.forEach((s, i) => {
    s.segments.forEach((_, g) => {
      set(ops, `${id}-ty-${i}-${g}`, start, {text: ''});
      for (const sm of s.typed[g]) set(ops, `${id}-ty-${i}-${g}`, sampleTime(sm.t), {text: sm.text});
    });
    const cur = `${id}-cur-${s.line}`;
    set(ops, cur, start, {opacity: 0});
    if (s.time - s.shown > 0.3) blink(ops, cur, s.shown, s.time);
    set(ops, cur, s.time, {opacity: 1});
    set(ops, cur, rt(s.typeEnd + 0.12), {opacity: 0});
  });
  const idle = `${id}-cur-${c.lines.length - 1}`;
  set(ops, idle, start, {opacity: 0});
  blink(ops, idle, c.end, end);
  let y = 0;
  set(ops, `${id}-scroll`, start, {x: 0, y: 0});
  for (const s of c.scroll) {
    tw(ops, `${id}-scroll`, s.t, c.scrollStep, 'power2.out', {x: 0, y}, {x: 0, y: s.y});
    y = s.y;
  }
  if (c.timer) {
    set(ops, `${id}-timer`, start, {opacity: 0, x: 0, y: r2(8 * u)});
    tw(ops, `${id}-timer`, rt(c.timer.start - 0.2), 0.3, 'power2.out', {opacity: 0, y: r2(8 * u)}, {opacity: 1, y: 0});
    set(ops, `${id}-clock`, start, {text: c.timer.first});
    for (const sm of c.timer.samples) set(ops, `${id}-clock`, sampleTime(sm.t), {text: sm.text});
  }
  if (c.highlight) {
    set(ops, `${id}-hlr`, start, {strokeDashoffset: 1});
    tw(ops, `${id}-hlr`, c.highlight.time, 0.55, 'power2.inOut', {strokeDashoffset: 1}, {strokeDashoffset: 0});
    set(ops, `${id}-hlf`, start, {opacity: 0});
    tw(ops, `${id}-hlf`, rt(c.highlight.time + 0.3), 0.35, 'power1.out', {opacity: 0}, {opacity: 1});
  }
}

export const terminalSession = {
  id: 'terminal-session',
  describe: 'A terminal that types: each command types character by character after the prompt, then its output streams row by row (plain lines, or PASS/FAIL rows with timings), scrolling when it outgrows the window; a ⏩ timer in the title bar fast-forwards the elapsed time while a long run streams, and a box draws round a path or token. For "git clone, pip install, run_all" proof beats.',
  params: {title: 'window title ≤ 60 (default "zsh")', prompt: 'string ≤ 6 (default "$")', steps: `[{cmd ≤ 160, output?: [string | {status: PASS | FAIL | OK | ERROR | SKIP, time? ≤ 10 ("10.0 s"), text} | {text, tone?: fg | muted | accent | add | del}] ≤ ${MAX_ROWS}, typing? (seconds), at?}] 1–${MAX_STEPS} (events step-<i>)`,
    stream: 'seconds between output rows (default 0.12)', timer: '{to (seconds of real time shown), from? (default 0), step? (default the last with output)}: the ⏩ elapsed timer runs over that step\'s output (event timer)',
    highlight: '"token" | {token, step?, row? (an output row), at?}: a box draws round it (event highlight)', at: `build start: ${at}`, variant: VARIANT_PARAM, rect: '{x, y, width, height} canvas px inside the safe zone (optional)'},
  events: ['build', 'step-0', 'step-1', 'step-2', 'step-3', 'step-4', 'step-5', 'step-6', 'step-7', 'timer', 'highlight'],
  timing: timingRules({rules: ['each command types in min(1.4, max(0.25, chars / 28)) s, 0.25 s for enter, then one output row every stream s', 'the next step follows the last row by 0.3 s; defaults that would run past the exit compress to fit (to 35%)']}),
  variants: TERMINAL_VARIANTS,
  resolve: terminalResolve, view: terminalView, timeline: terminalTimeline
};

export const TERMINAL_MODULES = [terminalSession];
