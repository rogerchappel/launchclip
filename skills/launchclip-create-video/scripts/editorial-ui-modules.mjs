#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const KINDS = ['media-window', 'checklist', 'step-rail', 'callout', 'audience-grid', 'trend-chart', 'metric', 'progress', 'date-card', 'status-rack', 'code-snippet', 'excerpt-window', 'focus-flow', 'growth-chart'];
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const js = value => JSON.stringify(value).replace(/</g, '\\u003c');
function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label}: unsupported ${key}`);
}
function number(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return value;
}
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must contain 1–${max} characters`);
  return value;
}
function localMedia(media) {
  object(media, 'media', ['kind', 'src', 'sourceStart']);
  if (!['image', 'video'].includes(media.kind)) throw new Error('media.kind must be image or video');
  text(media.src, 'media.src', 240);
  if (!/^[a-zA-Z0-9_./ -]+$/.test(media.src) || media.src.startsWith('/') || media.src.includes('..') || !media.src.startsWith('assets/')) throw new Error('media.src must be a project-local assets/ path');
  if (media.sourceStart !== undefined) number(media.sourceStart, 'media.sourceStart', 0, 86400);
  if (media.kind === 'image' && media.sourceStart !== undefined) throw new Error('sourceStart is only for video');
}

function series(config, label, duration, enterDuration = .28, exitDuration = null) {
  if (!['illustration', 'data'].includes(config.mode)) throw new Error(`${label}.mode must be illustration or data`);
  if (config.mode === 'data') text(config.source, `${label}.source for real data`, 80);
  else if (config.source !== undefined) throw new Error('illustration cannot claim a real data source');
  if (!Array.isArray(config.values) || config.values.length < 1 || config.values.length > 8) throw new Error(`${label}.values must contain 1–8 entries`);
  let previous = -1;
  config.values.forEach((entry, i) => {
    object(entry, `${label}.values[${i}]`, ['value', 'at']);
    number(entry.value, 'value', -1_000_000_000, 1_000_000_000);
    number(entry.at, 'at', enterDuration, duration - Math.max(.8, (exitDuration ?? 0) + .6));
    if (entry.at <= previous || (previous >= 0 && entry.at - previous + 1e-9 < .65)) throw new Error('value times must increase with at least 0.65s between events');
    previous = entry.at;
  });
  return config.mode === 'illustration' ? 'Illustration · example values' : `Source: ${config.source}`;
}

// Text changes are finite timeline states, not callbacks or wall-clock work.
// They restore even when a renderer seeks backwards with events suppressed.
function textFrames(motion, selector, from, to, format, time) {
  for (let frame = 0; frame <= 18; frame++) {
    const progress = frame / 18, eased = 1 - (1 - progress) ** 3;
    motion.push(`tl.set(${js(selector)}, {textContent:${js(format(from + (to - from) * eased))}}, ${time + frame / 30});`);
  }
}

// Small symbolic glyphs authored locally; no brand marks or arbitrary SVG input.
const SYMBOLS = {
  check: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  warning: '<path d="m12 3 10 18H2ZM12 9v5m0 3h.01"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m12-10v3c0 4-12 0-12 5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
  rocket: '<path d="M8 16c-2-5 2-11 11-12 1 9-5 13-10 11m4-6 2 2M8 12l-4 1-1 4 5-1m4 0 1 5 4-1 1-4m-10 3-4 3"/>'
};
const symbol = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${SYMBOLS[name]}</svg>`;

const DIRECTIONS = ['left', 'right', 'up', 'down', 'none'];
function motionSpec(value, duration) {
  if (value === undefined) return null;
  object(value, 'motion', ['enter', 'exit', 'distance', 'enterDuration', 'exitDuration', 'scale']);
  const config = {enter: 'up', exit: 'up', distance: 48, enterDuration: .36, exitDuration: .28, scale: 1, ...value};
  for (const key of ['enter', 'exit']) if (!DIRECTIONS.includes(config[key])) throw new Error(`motion.${key} must be ${DIRECTIONS.join(', ')}`);
  number(config.distance, 'motion.distance', 0, 96);
  number(config.enterDuration, 'motion.enterDuration', .2, .6);
  number(config.exitDuration, 'motion.exitDuration', .16, .5);
  number(config.scale, 'motion.scale', .92, 1);
  if (duration < config.enterDuration + config.exitDuration + .5) throw new Error('motion must leave at least 0.5s of readable hold');
  return config;
}
function offset(direction, distance) {
  return {x: direction === 'left' ? -distance : direction === 'right' ? distance : 0,
    y: direction === 'up' ? -distance : direction === 'down' ? distance : 0};
}
function moduleMotion(target, start, duration, config, media = false) {
  const selector = js(target);
  if (!config) return [`tl.fromTo(${selector}, {opacity:0,y:18}, {opacity:1,y:0,duration:0.28,ease:'power3.out'}, ${start});`, `tl.to(${selector}, {opacity:0,y:-8,duration:0.22,ease:'power2.in'}, ${start + duration - .22});`];
  // Root media and chrome share the chrome's top-left pivot, despite their
  // distinct root DOM boxes. The media box begins 48px below that pivot.
  const origin = media ? '0px -48px' : '0px 0px';
  return [`tl.set(${selector}, ${js({opacity: 0, ...offset(config.enter, config.distance), scale: config.scale, transformOrigin: origin})}, ${start});`, `tl.fromTo(${selector}, ${js({opacity: 0, ...offset(config.enter, config.distance), scale: config.scale, transformOrigin: origin})}, ${js({opacity: 1, x: 0, y: 0, scale: 1, duration: config.enterDuration, ease: 'power3.out', immediateRender: false})}, ${start});`,
    `tl.to(${selector}, ${js({opacity: 0, ...offset(config.exit, config.distance), scale: config.scale, duration: config.exitDuration, ease: 'power2.in'})}, ${start + duration - config.exitDuration});`];
}

// Skill-local authoring helper, not a production API. The host owns its paused
// GSAP timeline and places these fragments directly inside its composition root.
export function buildEditorialModule(input) {
  object(input, 'module', ['id', 'kind', 'aspect', 'start', 'duration', 'rect', 'title', 'accent', 'rows', 'steps', 'media', 'body', 'track', 'statusLabels', 'audience', 'chart', 'metric', 'progress', 'presentation', 'numbered', 'motion', 'treatment', 'date', 'rack', 'code', 'excerpt', 'theme', 'focus', 'growth']);
  if (!/^[a-z][a-z0-9-]{0,59}$/.test(input.id ?? '')) throw new Error('id must be a unique lowercase DOM-safe identifier');
  if (!KINDS.includes(input.kind)) throw new Error(`kind must be ${KINDS.join(', ')}`);
  if (input.presentation !== undefined && !['solid', 'glass'].includes(input.presentation)) throw new Error('presentation must be solid or glass');
  if (input.numbered !== undefined && (input.kind !== 'step-rail' || typeof input.numbered !== 'boolean')) throw new Error('numbered is a boolean for step-rail only');
  if (!['16:9', '9:16'].includes(input.aspect)) throw new Error('aspect must be 16:9 or 9:16');
  const canvas = input.aspect === '16:9' ? {width: 1920, height: 1080} : {width: 1080, height: 1920};
  const start = number(input.start, 'start', 0, 86400);
  const duration = number(input.duration, 'duration', 1, 3600);
  const movement = motionSpec(input.motion, duration);
  const enterDuration = movement?.enterDuration ?? .28, exitDuration = movement?.exitDuration ?? .22;
  const rect = input.rect ?? (input.aspect === '16:9' ? {x: 80, y: 480, width: 680, height: 500} : {x: 90, y: 960, width: 900, height: 740});
  object(rect, 'rect', ['x', 'y', 'width', 'height']);
  number(rect.width, 'rect.width', 420, canvas.width);
  number(rect.height, 'rect.height', 160, canvas.height);
  number(rect.x, 'rect.x', 0, canvas.width - rect.width);
  number(rect.y, 'rect.y', 0, canvas.height - rect.height);
  text(input.title, 'title', 54);
  const accent = input.accent ?? '#FF6A00';
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new Error('accent must be a six-digit hex color');
  let theme = null;
  if (input.theme !== undefined) {
    object(input.theme, 'theme', ['surface', 'foreground', 'muted', 'border', 'accentText']);
    for (const key of ['surface', 'foreground', 'muted', 'border']) if (typeof input.theme[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.theme[key])) throw new Error(`theme.${key} must be a six-digit hex color`);
    if (input.theme.accentText !== undefined && (typeof input.theme.accentText !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.theme.accentText))) throw new Error('theme.accentText must be a six-digit hex color');
    theme = {...input.theme, accentText: input.theme.accentText ?? input.theme.foreground};
  }
  const allowed = {'media-window': ['media'], checklist: ['rows'], 'step-rail': ['steps'], callout: ['body', 'treatment'], 'audience-grid': ['audience'], 'trend-chart': ['chart'], metric: ['metric'], progress: ['progress'], 'date-card': ['date'], 'status-rack': ['rack'], 'code-snippet': ['code'], 'excerpt-window': ['excerpt'], 'focus-flow': ['focus'], 'growth-chart': ['growth']}[input.kind];
  for (const key of ['media', 'rows', 'steps', 'body', 'audience', 'chart', 'metric', 'progress', 'treatment', 'date', 'rack', 'code', 'excerpt', 'focus', 'growth']) if (input[key] !== undefined && !allowed.includes(key)) throw new Error(`${input.kind} does not accept ${key}`);
  const statusLabels = {pending: 'Pending', active: 'Active', done: 'Done', ...(input.statusLabels ?? {})};
  if (input.statusLabels !== undefined) {
    if (input.kind !== 'checklist') throw new Error('statusLabels is only for checklist');
    object(input.statusLabels, 'statusLabels', ['pending', 'active', 'done']);
    for (const label of Object.values(statusLabels)) text(label, 'status label', 14);
  }
  const id = input.id, selector = `#${id}`, font = Math.max(24, Math.min(36, Math.round(rect.width / 22)));
  const statusWidth = Math.max(100, Math.ceil(Math.max(...Object.values(statusLabels).map(label => label.length)) * (font - 6) * .65));
  const pad = 24, titleLines = Math.ceil(input.title.length / Math.max(1, Math.floor((rect.width - 48) / ((font + 4) * .65))));
  const header = pad * 2 + titleLines * (font + 4) * 1.15;
  const track = input.track ?? 2;
  number(track, 'track', 1, 98);
  if (!Number.isInteger(track)) throw new Error('track must be an integer');
  const timed = `class="clip" data-start="${start}" data-duration="${duration}" data-track-index="${track}"`;
  const chromeTimed = timed.replace(`data-track-index="${track}"`, `data-track-index="${track + 1}" data-layout-allow-occlusion="true"`);
  const placement = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
  const events = [{id: `${id}-enter`, time: start + enterDuration}];
  const motion = moduleMotion(selector, start, duration, movement);
  motion.push(`tl.set(${js(selector)}, {opacity:0}, ${start + duration});`);
  const at = (value, label) => number(value, label, enterDuration, duration - (movement ? Math.max(.45, exitDuration + .3) : .45));
  let css = `#${id}{position:absolute;${placement};box-sizing:border-box;overflow:hidden;background:#17191d;color:#f7f7f8;border:1px solid #535761;border-radius:18px;box-shadow:0 16px 48px #0005;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:${font}px;line-height:1.25}#${id} *{box-sizing:border-box}#${id} .ui-title{margin:0;padding:${pad}px;font-size:${font + 4}px;font-weight:700;line-height:1.15}#${id} .ui-row{display:flex;align-items:center;gap:18px;padding:14px ${pad}px;border-top:1px solid #383c45}#${id} .ui-label{flex:1;min-width:0;overflow-wrap:break-word}#${id} .ui-check{width:36px;height:36px;flex:none;border:2px solid #828791;border-radius:7px;display:grid;place-items:center}#${id} .ui-check svg{width:32px;height:32px;opacity:0}#${id} .ui-status{font-size:${font - 6}px;color:#b8bbc3;width:${statusWidth}px;flex:none;text-align:right;position:relative}#${id} .ui-bar{position:absolute;top:0;left:0;right:0;height:48px;display:flex;align-items:center;gap:10px;padding:0 16px;background:#24272e;border-bottom:1px solid #535761}#${id} .ui-dot{width:12px;height:12px;border-radius:50%}#${id} .ui-bar-label{margin-left:12px;font-size:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#${id} .ui-content{padding:${pad}px}#${id} .ui-rail{position:relative;margin:20px ${pad}px 0;height:8px;background:#474c56;border-radius:4px}#${id} .ui-fill{height:100%;background:${accent};transform-origin:left;border-radius:4px}#${id} .ui-steps{display:flex;justify-content:space-between;padding:22px ${pad}px;gap:12px}#${id} .ui-step{flex:1;min-width:0;font-size:${Math.max(22, font - 4)}px;overflow-wrap:break-word;opacity:.65}#${id} .ui-body{padding:0 ${pad}px ${pad}px;margin:0;color:#d3d6dd;overflow-wrap:break-word}`;
  let body = '', media = '';
  if (['date-card', 'status-rack', 'code-snippet', 'excerpt-window', 'focus-flow', 'growth-chart'].includes(input.kind)) css += `#${id}{background:#101923;border-color:#465568;border-radius:14px;box-shadow:0 0 18px ${accent}16,0 14px 38px #0005}`;
  if (input.presentation === 'glass') {
    // Opaque tint is the readability fallback when native video compositing
    // does not reproduce backdrop blur. Keep framed media itself sharp.
    css += input.kind === 'media-window' ? `#${id} .ui-bar{background:rgba(28,31,39,.88);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}` : `#${id}{background:rgba(23,25,29,.86);border-color:#ffffff50;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){#${id}{background:rgba(23,25,29,.74)}}`;
  }
  if (input.kind === 'media-window') {
    localMedia(input.media);
    const source = input.media;
    motion.push(`tl.set(${js(`#${id}-media`)}, {opacity:0}, ${start + duration});`);
    const content = `position:absolute;left:${rect.x}px;top:${rect.y + 48}px;width:${rect.width}px;height:${rect.height - 48}px;object-fit:contain;background:#111;border-radius:0 0 18px 18px`;
    // Direct root child: HyperFrames controls the video clock. Chrome never
    // restarts the source or owns narration. Pattern follows the assembler's
    // root-media-window-bar/dot markup, not an external React UI library.
    media = source.kind === 'video' ? `<video id="${id}-media" ${timed} data-media-start="${source.sourceStart ?? 0}" src="${escape(source.src)}" muted playsinline style="${content}"></video>` : `<img id="${id}-media" ${timed} src="${escape(source.src)}" alt="${escape(input.title)}" style="${content}" />`;
    body = `<div class="ui-bar"><span class="ui-dot" style="background:#ff6258"></span><span class="ui-dot" style="background:#ffc04a"></span><span class="ui-dot" style="background:#40c957"></span><span class="ui-bar-label">${escape(input.title)}</span></div>`;
    motion.push(...moduleMotion(`#${id}-media`, start, duration, movement, true));
  } else {
    body = `<h2 class="ui-title">${escape(input.title)}</h2>`;
    if (input.kind === 'callout') {
      if (input.treatment === undefined) {
        text(input.body, 'body', 160);
        const lines = Math.ceil(input.body.length / Math.max(18, Math.floor((rect.width - pad * 2) / (font * .58))));
        if (rect.height < header + lines * font * 1.25 + pad) throw new Error('callout rect too short for body');
        body += `<p class="ui-body">${escape(input.body)}</p>`;
      } else {
        const treatment = input.treatment;
        object(treatment, 'treatment', ['icon', 'monospace', 'glow', 'corners', 'segments', 'at']);
        for (const key of ['monospace', 'glow', 'corners']) if (treatment[key] !== undefined && typeof treatment[key] !== 'boolean') throw new Error(`treatment.${key} must be a boolean`);
        if (treatment.icon !== undefined && !Object.hasOwn(SYMBOLS, treatment.icon)) throw new Error('icon must be terminal, branch, users, rocket, check or warning');
        let copy, markup; const underlines = []; const chunks = [];
        if (treatment.segments !== undefined) {
          if (input.body !== undefined) throw new Error('segments replace body; do not supply both');
          if (!Array.isArray(treatment.segments) || treatment.segments.length < 1 || treatment.segments.length > 12) throw new Error('segments must contain 1–12 entries');
          copy = ''; markup = treatment.segments.map((segment, i) => {
            object(segment, 'segment', ['text', 'highlight', 'underlineAt']);
            if (typeof segment.text !== 'string' || !segment.text.length || segment.text.length > 160) throw new Error('segment.text must contain 1–160 characters');
            if (segment.highlight !== undefined && typeof segment.highlight !== 'boolean') throw new Error('segment.highlight must be a boolean');
            copy += segment.text;
            if (segment.underlineAt !== undefined) {
              if (/[\r\n\t]/.test(segment.text) || segment.text.length * font * .68 > rect.width - 36) throw new Error('underlined phrase must fit one line');
              const time = start + at(segment.underlineAt, 'segment.underlineAt');
              underlines.push({i, time}); chunks.push(segment.text.length);
            } else chunks.push(...(segment.text.match(/\S+\s*|\s+/g) ?? []).map(part => part.length));
            return `<span class="${[segment.highlight ? 'ui-emphasis' : '', segment.underlineAt !== undefined ? 'ui-underlined' : ''].filter(Boolean).join(' ')}">${escape(segment.text)}${segment.underlineAt === undefined ? '' : `<span id="${id}-underline-${i}" class="ui-underline" aria-hidden="true"></span>`}</span>`;
          }).join('');
          text(copy, 'combined segments', 160);
        } else {copy = text(input.body, 'body', 160); markup = escape(copy);}
        const inset = 18, iconWidth = treatment.icon ? 60 : 0;
        const headingLines = Math.ceil(input.title.length / Math.max(1, Math.floor((rect.width - inset * 2 - iconWidth) / ((font + 2) * .68))));
        const headingHeight = Math.max(treatment.icon ? 48 : 0, headingLines * (font + 2) * 1.2);
        const columns = Math.max(1, Math.floor((rect.width - inset * 2) / (font * .68)));
        let lines = Math.ceil(copy.length / columns);
        if (underlines.length) {let count = 1, used = 0; for (const chunk of chunks) {if (used && used + chunk > columns) {count++; used = 0;} count += Math.max(0, Math.ceil(chunk / columns) - 1); used = chunk > columns ? chunk % columns : used + chunk;} lines = Math.max(lines, count);}
        if (rect.height < inset * 3 + headingHeight + lines * font * 1.3) throw new Error('treated callout rect too short for copy');
        const family = treatment.monospace ? 'ui-monospace,monospace' : 'inherit';
        css += `#${id}{background:#101923;border-color:#465568;border-radius:14px}#${id} .ui-callout-heading{display:flex;align-items:center;gap:12px;padding:18px}#${id} .ui-title{padding:0;font-size:${font + 2}px;line-height:1.2;min-width:0;overflow-wrap:break-word;font-family:${family}}#${id} .ui-body{padding:0 18px 18px;font-family:${family};line-height:1.3;color:#e0e7ef}#${id} .ui-emphasis{color:${accent};font-weight:700}#${id} .ui-underlined{position:relative;display:inline-block;white-space:nowrap}#${id} .ui-underline{position:absolute;left:0;right:0;bottom:-2px;height:2px;background:${accent};transform-origin:left center;display:block}#${id} .ui-symbol{width:48px;height:48px;flex:none;color:#f7f7f8}#${id} .ui-symbol svg{width:48px;height:48px;display:block}#${id} .ui-corner{position:absolute;width:18px;height:18px;pointer-events:none;border-color:${accent};border-style:solid;border-width:0;opacity:0}#${id} .ui-corner-tl{left:7px;top:7px;border-left-width:2px;border-top-width:2px}#${id} .ui-corner-tr{right:7px;top:7px;border-right-width:2px;border-top-width:2px}#${id} .ui-corner-bl{left:7px;bottom:7px;border-left-width:2px;border-bottom-width:2px}#${id} .ui-corner-br{right:7px;bottom:7px;border-right-width:2px;border-bottom-width:2px}`;
        // Font shorthand keeps the local monospace treatment intact through
        // the renderer's font-family normalization, as with code/date widgets.
        if (treatment.monospace) css += `#${id} .ui-title{font:700 ${font + 2}px/1.2 ui-monospace,monospace}#${id} .ui-body{font:${font}px/1.3 ui-monospace,monospace}`;
        body = `<div class="ui-callout-heading">${treatment.icon ? `<span id="${id}-symbol" class="ui-symbol" aria-hidden="true">${symbol(treatment.icon)}</span>` : ''}<h2 id="${id}-heading" class="ui-title">${escape(input.title)}</h2></div><p id="${id}-copy" class="ui-body">${markup}</p>`;
        const time = start + at(treatment.at ?? enterDuration, 'treatment.at');
        motion.push(`tl.fromTo(${js(`#${id}-heading`)}, {opacity:0,y:6}, {opacity:1,y:0,duration:0.28,ease:'power3.out'}, ${time});`);
        underlines.forEach(({i, time: underlineTime}) => {
          if (underlineTime < time + .4) throw new Error('underline must follow treatment settle');
          motion.push(`tl.set(${js(`#${id}-underline-${i}`)}, {scaleX:0}, ${start});`, `tl.to(${js(`#${id}-underline-${i}`)}, {scaleX:1,duration:0.28,ease:'power3.out'}, ${underlineTime});`);
          events.push({id: `${id}-underline-${i}-settle`, time: underlineTime + .28});
        });
        motion.push(`tl.fromTo(${js(`#${id}-copy`)}, {opacity:0,y:8}, {opacity:1,y:0,duration:0.3,ease:'power3.out'}, ${time + .08});`);
        if (treatment.icon) motion.push(`tl.fromTo(${js(`#${id}-symbol`)}, {opacity:0,scale:0.86,rotation:-6}, {opacity:1,scale:1,rotation:0,duration:0.34,ease:'power3.out'}, ${time});`);
        if (treatment.glow) {
          css += `#${id}{box-shadow:0 0 24px ${accent}25,0 14px 38px #0005}#${id} .ui-accent-edge{position:absolute;inset:0;border:1px solid ${accent};border-radius:14px;opacity:0;pointer-events:none}`;
          body += `<div id="${id}-edge" class="ui-accent-edge" aria-hidden="true"></div>`;
          motion.push(`tl.fromTo(${js(`#${id}-edge`)}, {opacity:0}, {opacity:0.6,duration:0.4,ease:'power2.out'}, ${time});`);
        }
        if (treatment.corners && (rect.x < 12 || rect.y < 12 || rect.x + rect.width > canvas.width - 12 || rect.y + rect.height > canvas.height - 12)) throw new Error('corners require 12px canvas clearance');
        if (treatment.corners) css += `#${id}{overflow:visible}#${id} .ui-corner-tl{left:-8px;top:-8px}#${id} .ui-corner-tr{right:-8px;top:-8px}#${id} .ui-corner-bl{left:-8px;bottom:-8px}#${id} .ui-corner-br{right:-8px;bottom:-8px}`;
        if (treatment.corners) ['tl','tr','bl','br'].forEach((corner, i) => {
          body += `<span id="${id}-corner-${corner}" class="ui-corner ui-corner-${corner}" aria-hidden="true"></span>`;
          motion.push(`tl.fromTo(${js(`#${id}-corner-${corner}`)}, {opacity:0,x:${corner.endsWith('l') ? 6 : -6},y:${corner.startsWith('t') ? 6 : -6}}, {opacity:1,x:0,y:0,duration:0.28,ease:'power3.out'}, ${time + i * .04});`);
        });
        events.push({id: `${id}-treatment-settle`, time: time + .4});
      }
    } else if (input.kind === 'excerpt-window') {
      object(input.excerpt, 'excerpt', ['mode', 'source', 'lines', 'focus']);
      const excerpt = input.excerpt;
      if (!['illustration', 'data'].includes(excerpt.mode)) throw new Error('excerpt.mode must be illustration or data');
      if (excerpt.mode === 'data') text(excerpt.source, 'excerpt.source', 80);
      else if (excerpt.source !== undefined) throw new Error('illustration cannot claim a real data source');
      if (!Array.isArray(excerpt.lines) || excerpt.lines.length < 1 || excerpt.lines.length > 5) throw new Error('excerpt.lines must contain 1–5 lines');
      object(excerpt.focus, 'excerpt.focus', ['line', 'scale', 'at']);
      number(excerpt.focus.line, 'focus.line', 0, excerpt.lines.length - 1);
      if (!Number.isInteger(excerpt.focus.line)) throw new Error('focus.line must be an integer');
      const zoom = number(excerpt.focus.scale, 'focus.scale', 1, 1.3), time = start + at(excerpt.focus.at, 'focus.at');
      const note = excerpt.mode === 'illustration' ? 'Illustration · text excerpt' : `Source: ${excerpt.source}`;
      const textFont = Math.max(24, Math.min(32, Math.floor(rect.width / 24))), lineHeight = Math.ceil(textFont * 1.5);
      const noteHeight = Math.ceil(note.length / Math.floor((rect.width - 48) / (22 * .65))) * 29 + 16;
      const viewWidth = rect.width - 48, viewHeight = rect.height - 48 - noteHeight - 48;
      const textHeight = lineHeight * excerpt.lines.length;
      if (viewHeight < textHeight * zoom) throw new Error('excerpt-window rect too short for focused text');
      let longest = 0;
      const lines = excerpt.lines.map((line, i) => {
        object(line, 'excerpt line', ['segments']);
        if (!Array.isArray(line.segments) || line.segments.length < 1 || line.segments.length > 12) throw new Error('excerpt segments must contain 1–12 entries');
        let length = 0;
        const segments = line.segments.map(segment => {
          object(segment, 'excerpt segment', ['text', 'highlight']);
          if (typeof segment.text !== 'string' || segment.text.length < 1 || segment.text.length > 120 || /[\r\n\t]/.test(segment.text)) throw new Error('excerpt segment must be short single-line text');
          if (segment.highlight !== undefined && typeof segment.highlight !== 'boolean') throw new Error('highlight must be a boolean');
          length += segment.text.length;
          return `<span${segment.highlight ? ' class="ui-excerpt-highlight"' : ''}>${escape(segment.text)}</span>`;
        }).join('');
        const width = length * textFont * .68;
        if (width * zoom > viewWidth) throw new Error('excerpt line too long at focused zoom; shorten or widen it');
        longest = Math.max(longest, width);
        return `<div class="ui-excerpt-line">${segments}</div>`;
      }).join('');
      // Focus travel is compiled from the supplied line and fixed geometry;
      // all text remains within the viewport at both endpoints and maximum zoom.
      const x = (viewWidth - longest * zoom) / 2;
      const y = Math.max(0, Math.min(viewHeight - textHeight * zoom, viewHeight / 2 - (excerpt.focus.line + .5) * lineHeight * zoom));
      css += `#${id} .ui-excerpt-note{position:absolute;top:48px;left:0;right:0;padding:16px 24px 0;font-size:22px;line-height:1.3;color:#d3d6dd}#${id} .ui-excerpt-viewport{position:absolute;left:24px;right:24px;top:${48 + noteHeight + 24}px;bottom:24px;overflow:hidden}#${id} .ui-excerpt-content{width:${longest}px;height:${textHeight}px;font:${textFont}px/1.5 ui-monospace,monospace;transform-origin:top left}#${id} .ui-excerpt-line{height:${lineHeight}px;white-space:pre}#${id} .ui-excerpt-highlight{background:transparent;border-radius:3px}`;
      body = `<div class="ui-bar"><span class="ui-dot" style="background:#ff6258"></span><span class="ui-dot" style="background:#ffc04a"></span><span class="ui-dot" style="background:#40c957"></span><span class="ui-bar-label">${escape(input.title)}</span></div><div class="ui-excerpt-note">${escape(note)}</div><div class="ui-excerpt-viewport"><div id="${id}-excerpt" class="ui-excerpt-content">${lines}</div></div>`;
      motion.push(`tl.set(${js(`#${id}-excerpt`)}, {x:0,y:0,scale:1}, ${start});`, `tl.to(${js(`#${id}-excerpt`)}, {x:${x},y:${y},scale:${zoom},duration:0.5,ease:'power3.inOut'}, ${time});`, `tl.to(${js(`#${id} .ui-excerpt-highlight`)}, {backgroundColor:${js(accent + '55')},duration:0.24,ease:'power2.out'}, ${time + .16});`);
      events.push({id: `${id}-excerpt-focus`, time: time + .5});
    } else if (input.kind === 'date-card') {
      object(input.date, 'date', ['month', 'day', 'year', 'caption', 'at']);
      const date = input.date;
      number(date.month, 'date.month', 1, 12); number(date.day, 'date.day', 1, 31);
      if (!Number.isInteger(date.month) || !Number.isInteger(date.day)) throw new Error('date month/day must be integers');
      if (date.year !== undefined) {number(date.year, 'date.year', 1, 9999); if (!Number.isInteger(date.year)) throw new Error('date.year must be an integer');}
      const leap = date.year === undefined || date.year % 4 === 0 && (date.year % 100 !== 0 || date.year % 400 === 0);
      if (date.day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][date.month - 1]) throw new Error('day does not exist in supplied month/year');
      const caption = date.caption === undefined ? '' : text(date.caption, 'date.caption', 42);
      const captionLines = caption ? Math.ceil(caption.length / Math.floor((rect.width - 40) / (22 * .65))) : 0;
      if (rect.height < 48 + 132 + titleLines * (font + 4) * 1.15 + 36 + captionLines * 29) throw new Error('date-card rect too short');
      const time = start + at(date.at, 'date.at'), month = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'][date.month - 1];
      css += `#${id} .ui-month{height:48px;background:${accent};color:#101923;display:grid;place-items:center;font:700 22px/1.2 ui-monospace,monospace;letter-spacing:2px}#${id} .ui-day{font:800 112px/1.1 system-ui,sans-serif;text-align:center;height:132px;padding-top:8px}#${id} .ui-title{text-align:center;padding:12px 20px}#${id} .ui-date-note{text-align:center;font:22px/1.3 ui-monospace,monospace;margin:0;padding:0 20px 12px;color:#d3d6dd}`;
      body = `<div class="ui-month">${month}${date.year === undefined ? '' : ` · ${date.year}`}</div><div id="${id}-day" class="ui-day">${date.day}</div><h2 class="ui-title">${escape(input.title)}</h2>${caption ? `<p class="ui-date-note">${escape(caption)}</p>` : ''}`;
      motion.push(`tl.fromTo(${js(`#${id}-day`)}, {opacity:0,y:14,scale:0.94}, {opacity:1,y:0,scale:1,duration:0.32,ease:'power3.out'}, ${time});`);
      events.push({id: `${id}-date-settle`, time: time + .32});
    } else if (input.kind === 'status-rack') {
      object(input.rack, 'rack', ['mode', 'source', 'rows']);
      const rack = input.rack;
      if (!['illustration', 'data'].includes(rack.mode)) throw new Error('rack.mode must be illustration or data');
      if (rack.mode === 'data') text(rack.source, 'rack.source', 80);
      else if (rack.source !== undefined) throw new Error('illustration cannot claim a real data source');
      if (!Array.isArray(rack.rows) || rack.rows.length < 1 || rack.rows.length > 8) throw new Error('rack.rows must contain 1–8 rows');
      const note = rack.mode === 'illustration' ? 'Illustration · status states' : `Source: ${rack.source}`;
      const noteLines = Math.ceil(note.length / Math.floor((rect.width - 48) / (22 * .65)));
      if (rect.height < header + noteLines * 29 + 20 + rack.rows.length * 52 + 24) throw new Error('status-rack rect too short');
      css += `#${id} .ui-rack-note{font-size:22px;line-height:1.3;color:#d3d6dd;margin:0;padding:0 24px 20px}#${id} .ui-rack{display:grid;gap:8px;padding:0 24px 24px}#${id} .ui-rack-row{height:44px;border:1px solid #465061;border-radius:8px;background:#101923;display:flex;align-items:center;gap:12px;padding:0 12px;font:22px/1.25 ui-monospace,monospace;opacity:0}#${id} .ui-rack-marker{width:22px;height:5px;background:#7e8795;flex:none;border-radius:2px}#${id} .ui-rack-label{flex:1;min-width:0}#${id} .ui-lights{display:flex;gap:8px}#${id} .ui-light{width:18px;height:18px;background:#536071;border-radius:50%;flex:none}`;
      body += `<p class="ui-rack-note">${escape(note)}</p><div class="ui-rack">`;
      rack.rows.forEach((row, i) => {
        object(row, 'rack row', ['label', 'states']); text(row.label, 'rack.label', 24);
        if (row.label.length > Math.floor((rect.width - 48 - 24 - 22 - 24 - 70) / (22 * .65))) throw new Error('rack label too long for rect');
        if (!Array.isArray(row.states) || row.states.length < 1 || row.states.length > 8) throw new Error('row.states must contain 1–8 states');
        body += `<div id="${id}-rack-${i}" class="ui-rack-row"><span class="ui-rack-marker" aria-hidden="true"></span><span class="ui-rack-label">${escape(row.label)}</span><span class="ui-lights" aria-label="supplied status indicators">${[0,1,2].map(j => `<span id="${id}-light-${i}-${j}" class="ui-light"></span>`).join('')}</span></div>`;
        let previous = -1, previousLights = [false, false, false];
        row.states.forEach((state, n) => {
          object(state, 'rack state', ['at', 'lights']); const offset = at(state.at, 'rack state.at');
          if (offset <= previous || previous >= 0 && offset - previous < .3 - 1e-9) throw new Error('rack state times must increase by at least 0.3s'); previous = offset;
          if (!Array.isArray(state.lights) || state.lights.length !== 3 || state.lights.some(light => typeof light !== 'boolean')) throw new Error('rack lights must be exactly three booleans');
          const time = start + offset; let changed = n === 0;
          if (n === 0) motion.push(`tl.fromTo(${js(`#${id}-rack-${i}`)}, {opacity:0,x:-10}, {opacity:1,x:0,duration:0.22,ease:'power3.out'}, ${time});`);
          state.lights.forEach((light, j) => {if (light !== previousLights[j]) {changed = true; motion.push(`tl.to(${js(`#${id}-light-${i}-${j}`)}, {backgroundColor:${js(light ? accent : (theme?.border ?? '#536071'))},duration:0.18,ease:'power2.out'}, ${time});`);}});
          previousLights = [...state.lights];
          if (changed) events.push({id: `${id}-rack-${i}-state-${n}`, time: time + (n === 0 ? .22 : .18)});
        });
      });
      body += '</div>';
    } else if (input.kind === 'code-snippet') {
      object(input.code, 'code', ['language', 'lines']); const code = input.code;
      const language = code.language === undefined ? 'Example code' : text(code.language, 'code.language', 24);
      if (!Array.isArray(code.lines) || code.lines.length < 1 || code.lines.length > 3) throw new Error('code.lines must contain 1–3 lines');
      const codeFont = Math.max(22, Math.min(28, Math.floor(rect.width / 28))), lineHeight = Math.ceil(codeFont * 1.5);
      if (rect.height < header + 44 + code.lines.length * lineHeight + 24) throw new Error('code-snippet rect too short');
      const tokenTypes = ['plain', 'keyword', 'string', 'number', 'comment', 'operator'];
      css += `#${id} .ui-code-language{font:22px/1.3 ui-monospace,monospace;margin:0;padding:0 24px 16px;color:#b8c4d3}#${id} .ui-code{margin:0;padding:0 24px 24px;font:${codeFont}px/1.5 ui-monospace,monospace}#${id} .ui-code-line{display:block;height:${lineHeight}px;white-space:pre;opacity:0}#${id} .ui-token-keyword{color:#ffa9a0}#${id} .ui-token-string{color:#add8ff}#${id} .ui-token-number{color:${accent}}#${id} .ui-token-comment{color:#a5b1c2}#${id} .ui-token-operator{color:#e1bcff}`;
      body += `<p class="ui-code-language">${escape(language)} · Example</p><pre class="ui-code">`;
      let previous = -1;
      code.lines.forEach((line, i) => {
        object(line, 'code line', ['tokens', 'at']); const offset = at(line.at, 'code line.at');
        if (offset <= previous || previous >= 0 && offset - previous < .3 - 1e-9) throw new Error('code line times must increase by at least 0.3s'); previous = offset;
        if (!Array.isArray(line.tokens) || line.tokens.length < 1 || line.tokens.length > 24) throw new Error('code line requires 1–24 tokens');
        let length = 0;
        const tokens = line.tokens.map(token => {object(token, 'code token', ['text', 'type']); if (typeof token.text !== 'string' || token.text.length < 1 || token.text.length > 80) throw new Error('token.text must contain 1–80 characters'); if (/[\r\n\t]/.test(token.text)) throw new Error('code token must be one line without tabs'); if (!tokenTypes.includes(token.type)) throw new Error('unsupported token type'); length += token.text.length; return `<span class="ui-token-${token.type}">${escape(token.text)}</span>`;}).join('');
        if (length > Math.floor((rect.width - 48) / (codeFont * .65))) throw new Error('code line too long for rect; shorten the example or widen the module');
        body += `<span id="${id}-code-${i}" class="ui-code-line">${tokens}</span>`;
        motion.push(`tl.fromTo(${js(`#${id}-code-${i}`)}, {opacity:0,x:12}, {opacity:1,x:0,duration:0.24,ease:'power3.out'}, ${start + offset});`);
        events.push({id: `${id}-code-${i}-settle`, time: start + offset + .24});
      });
      body += '</pre>';
    } else if (input.kind === 'audience-grid') {
      object(input.audience, 'audience', ['tiles', 'columns']);
      const {tiles} = input.audience;
      if (!Array.isArray(tiles) || tiles.length < 2 || tiles.length > 12) throw new Error('audience.tiles must contain 2–12 entries; split larger grids');
      const columns = input.audience.columns ?? Math.min(tiles.length, rect.width < 600 ? 2 : 3);
      number(columns, 'audience.columns', 2, 4);
      if (!Number.isInteger(columns) || columns > tiles.length) throw new Error('columns must be an integer no larger than the tile count');
      const cellWidth = (rect.width - 48 - 16 * (columns - 1)) / columns;
      const cellHeight = font >= 32 ? 180 : 160, labelFont = Math.max(22, font - 6);
      const rowCount = Math.ceil(tiles.length / columns);
      if (cellWidth < 130 || rect.height < header + 55 + 24 + rowCount * cellHeight + (rowCount - 1) * 16) throw new Error('audience grid does not fit rect; use fewer tiles/columns or a larger rect');
      css += `#${id} .ui-note{margin:0;padding:0 24px 20px;color:#d3d6dd;font-size:22px;line-height:1.3}#${id} .ui-audience{display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:16px;padding:0 24px 24px}#${id} .ui-viewer{height:${cellHeight}px;padding:16px;border:2px solid #535761;border-radius:14px;background:#24272e;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0}#${id} .ui-avatar{font-size:52px;line-height:1.1}#${id} .ui-viewer-label{font-size:${labelFont}px;text-align:center;overflow-wrap:break-word}`;
      body += '<p class="ui-note">Illustration · audience tiles</p><div class="ui-audience">';
      tiles.forEach((tile, i) => {
        object(tile, `audience.tiles[${i}]`, ['label', 'emoji', 'at']);
        text(tile.label, 'tile.label', 24);
        if (tile.label.length > Math.floor((cellWidth - 32) / (labelFont * .65)) * 2) throw new Error('tile label too long for rect');
        const emoji = tile.emoji ?? '👤';
        text(emoji, 'tile.emoji', 16);
        if (Array.from(emoji).length > 8 || /[\r\n]/.test(emoji)) throw new Error('tile.emoji must be a compact icon accent');
        const time = start + at(tile.at, 'tile.at');
        body += `<div id="${id}-viewer-${i}" class="ui-viewer"><span class="ui-avatar" aria-hidden="true">${escape(emoji)}</span><span class="ui-viewer-label">${escape(tile.label)}</span></div>`;
        motion.push(`tl.fromTo(${js(`#${id}-viewer-${i}`)}, {opacity:0,y:8}, {opacity:1,y:0,borderColor:${js(accent)},duration:0.24,ease:'power3.out'}, ${time});`);
        events.push({id: `${id}-viewer-${i}-settle`, time: time + .24});
      });
      body += '</div>';
    } else if (input.kind === 'focus-flow') {
      object(input.focus, 'focus', ['options', 'selected', 'arriveAt', 'chooseAt', 'progressAt', 'progressDuration', 'progressLabel', 'icon']);
      const focus = input.focus, options = focus.options;
      if (!Array.isArray(options) || options.length < 2 || options.length > 4) throw new Error('focus.options must contain 2–4 meaningful labels');
      options.forEach(label => text(label, 'focus option', 24));
      if (new Set(options.map(label => label.trim().toLowerCase())).size !== options.length) throw new Error('focus options must be distinct');
      number(focus.selected, 'focus.selected', 0, options.length - 1);
      if (!Number.isInteger(focus.selected)) throw new Error('focus.selected must be an integer');
      if (focus.icon !== undefined && !Object.hasOwn(SYMBOLS, focus.icon)) throw new Error('focus.icon must be a built-in symbolic icon');
      const arrive = at(focus.arriveAt, 'focus.arriveAt'), choose = at(focus.chooseAt, 'focus.chooseAt'), progress = at(focus.progressAt, 'focus.progressAt');
      const progressDuration = number(focus.progressDuration ?? .8, 'focus.progressDuration', .3, 2);
      if (choose < arrive + .24 + (options.length - 1) * .08 + .2 || progress < choose + .9) throw new Error('focus must hold options before choosing and settle the chosen task before progress');
      if (progress + progressDuration + .35 > duration - exitDuration) throw new Error('focus progress must finish with a readable hold before exit');
      const label = focus.progressLabel === undefined ? 'Illustrative progress' : text(focus.progressLabel, 'focus.progressLabel', 32);
      const rowHeight = 64, gap = 14, horizontal = input.aspect === '16:9' && rect.width >= 900;
      const stageHeight = horizontal ? 96 : options.length * (rowHeight + gap) - gap;
      const optionWidth = horizontal ? (rect.width - 48 - gap * (options.length - 1)) / options.length : rect.width - 48;
      const optionFont = horizontal ? 22 : Math.max(24, font - 2), available = optionWidth - 32 - (focus.icon ? 46 : 0);
      if (options.some(option => option.length * optionFont * .65 > available * (horizontal ? 2 : 1))) throw new Error('focus option too long for rect');
      if (label.length * 22 * .65 > rect.width - 48 || rect.height < header + 50 + stageHeight + 94) throw new Error('focus-flow does not fit rect');
      const target = (stageHeight - rowHeight) / 2, targetX = (rect.width - 48 - optionWidth) / 2;
      css += `#${id} .ui-focus-note{font-size:22px;line-height:1.3;margin:0;padding:0 24px 20px;color:#d3d6dd}#${id} .ui-focus-stage{position:relative;height:${stageHeight}px;margin:0 24px}#${id} .ui-focus-option{position:absolute;left:0;top:0;width:${optionWidth}px;height:${rowHeight}px;padding:0 16px;display:flex;align-items:center;justify-content:center;gap:12px;border:1px solid #535761;border-radius:12px;background:#24272e;font-size:${optionFont}px;line-height:1.25;text-align:center;opacity:0}#${id} .ui-focus-option>span:last-child{min-width:0;overflow-wrap:break-word}#${id} .ui-focus-icon{width:34px;height:34px;flex:none}#${id} .ui-focus-icon svg{width:34px;height:34px;display:block}#${id} .ui-focus-progress{margin:18px 24px 24px;opacity:0}#${id} .ui-focus-progress-label{font-size:22px;line-height:1.3;margin-bottom:12px}#${id} .ui-focus-track{height:12px;border-radius:6px;background:#474c56;overflow:hidden}#${id} .ui-focus-fill{height:100%;background:${accent};transform-origin:left center}`;
      body += '<p class="ui-focus-note">Illustration · focus sequence</p><div class="ui-focus-stage">';
      options.forEach((option, i) => {
        const key = `${id}-option-${i}`, initial = horizontal ? 0 : i * (rowHeight + gap), initialX = horizontal ? i * (optionWidth + gap) : 0;
        body += `<div id="${key}" class="ui-focus-option">${i === focus.selected && focus.icon ? `<span class="ui-focus-icon" aria-hidden="true">${symbol(focus.icon)}</span>` : ''}<span>${escape(option)}</span></div>`;
        motion.push(`tl.fromTo(${js(`#${key}`)}, {opacity:0,x:${initialX},y:${initial + 8}}, {opacity:1,x:${initialX},y:${initial},duration:0.24,ease:'power3.out'}, ${start + arrive + i * .08});`);
        if (i === focus.selected) motion.push(`tl.to(${js(`#${key}`)}, {x:${targetX},y:${target},scale:${horizontal ? 1.4 : 1},borderColor:${js(accent)},backgroundColor:${js(accent + '22')},duration:0.42,ease:'power3.inOut'}, ${start + choose + .18});`);
        else motion.push(`tl.to(${js(`#${key}`)}, {opacity:0,duration:0.16,ease:'power2.out'}, ${start + choose});`, `tl.to(${js(`#${key}`)}, {x:${targetX},y:${target},scale:0.94,duration:0.38,ease:'power3.inOut'}, ${start + choose});`);
      });
      body += `</div><div id="${id}-focus-progress" class="ui-focus-progress"><div class="ui-focus-progress-label">${escape(label)}</div><div class="ui-focus-track"><div id="${id}-focus-fill" class="ui-focus-fill"></div></div></div>`;
      motion.push(`tl.set(${js(`#${id}-focus-fill`)}, {scaleX:0}, ${start});`, `tl.to(${js(`#${id}-focus-progress`)}, {opacity:1,duration:0.2}, ${start + progress});`, `tl.to(${js(`#${id}-focus-fill`)}, {scaleX:1,duration:${progressDuration},ease:'power2.inOut'}, ${start + progress});`);
      events.push({id: `${id}-options-settle`, time: start + arrive + (options.length - 1) * .08 + .24}, {id: `${id}-chosen-task`, time: start + choose + .6}, {id: `${id}-focus-progress-settle`, time: start + progress + progressDuration});
    } else if (input.kind === 'trend-chart' || input.kind === 'growth-chart') {
      const isGrowth = input.kind === 'growth-chart';
      const supplied = isGrowth ? input.growth : input.chart;
      object(supplied, isGrowth ? 'growth' : 'chart', isGrowth ? ['mode', 'points', 'unit', 'source', 'showValues'] : ['mode', 'points', 'unit', 'source']);
      if (isGrowth && supplied.showValues !== undefined && typeof supplied.showValues !== 'boolean') throw new Error('growth.showValues must be a boolean');
      const showValues = !isGrowth || (supplied.showValues ?? supplied.points !== undefined);
      let chart = supplied;
      if (isGrowth && supplied.points === undefined) {
        if (supplied.mode !== 'illustration') throw new Error('real growth data requires supplied points');
        if (duration < enterDuration + exitDuration + 2.4) throw new Error('default growth illustration needs a longer duration');
        const interval = (duration - enterDuration - exitDuration - .9) / 3;
        chart = {...supplied, points: [1,3,8,20].map((value, i) => ({label: ['Start','Next','Later','Reach'][i], value, at: enterDuration + i * interval}))};
      }
      const {mode, points} = chart;
      if (!['illustration', 'data'].includes(mode)) throw new Error('chart.mode must be illustration or data');
      if (!Array.isArray(points) || points.length < 2 || points.length > 8) throw new Error('chart.points must contain 2–8 entries');
      const unit = text(isGrowth ? (chart.unit ?? 'reach') : chart.unit, 'chart.unit', 18);
      if (mode === 'data') text(chart.source, 'chart.source for real data', 80);
      else if (chart.source !== undefined) throw new Error('illustration cannot claim a real data source');
      const attribution = mode === 'illustration' ? (isGrowth && !showValues ? 'Illustration · relative growth' : 'Illustration · example values') : `Source: ${chart.source}`;
      const columnWidth = (rect.width - 48 - 16 * (points.length - 1)) / points.length;
      const chartHeight = 180, labelFont = 22;
      const attributionLines = Math.ceil(attribution.length / Math.floor((rect.width - 48) / (22 * .65)));
      if (columnWidth < 40 || rect.height < header + attributionLines * 29 + 24 + (isGrowth ? (showValues ? 88 : 0) : 80) + chartHeight + 80) throw new Error('trend chart does not fit rect; use fewer points or a larger rect');
      let previous = -1;
      points.forEach((point, i) => {
        object(point, `chart.points[${i}]`, ['label', 'value', 'at']);
        text(point.label, 'point.label', 16);
        number(point.value, 'point.value', 0, 1_000_000_000);
        if (!Number.isInteger(point.value)) throw new Error('point.value must be a whole count');
        if (isGrowth && i > 0 && point.value < points[i - 1].value) throw new Error('growth values must not decrease; use trend-chart for declines');
        if (point.label.length > Math.floor(columnWidth / (labelFont * .65)) * 2) throw new Error('point label too long for rect');
        const offset = at(point.at, 'point.at');
        if (offset <= previous || (previous >= 0 && offset - previous + 1e-9 < .5)) throw new Error('point times must increase with at least 0.5s between events');
        previous = offset;
      });
      const maximum = Math.max(1, ...points.map(point => point.value));
      css += `#${id} .ui-note{margin:0;padding:0 24px 20px;color:#d3d6dd;font-size:22px;line-height:1.3;overflow-wrap:break-word}#${id} .ui-metric{padding:0 24px 20px;height:80px;display:flex;align-items:baseline;gap:16px;white-space:nowrap}#${id} .ui-count{font-size:48px;font-weight:750;font-variant-numeric:tabular-nums}#${id} .ui-unit{font-size:22px;color:#d3d6dd}#${id} .ui-chart{display:grid;grid-template-columns:repeat(${points.length},minmax(0,1fr));gap:16px;padding:0 24px 24px}#${id} .ui-column{min-width:0;text-align:center}#${id} .ui-bar-track{height:${chartHeight}px;display:flex;align-items:flex-end;border-bottom:1px solid #828791}#${id} .ui-trend-bar{width:100%;background:${accent};border-radius:7px 7px 0 0;transform-origin:bottom}#${id} .ui-point-label{display:block;font-size:${labelFont}px;line-height:1.25;margin-top:12px;overflow-wrap:break-word}`;
      if (isGrowth) css += `#${id} .ui-column{opacity:0}#${id} .ui-count{font-size:56px}#${id} .ui-metric{height:88px}#${id} .ui-trend-bar{border-radius:10px 10px 0 0}`;
      if (isGrowth && !showValues) css += `#${id} .ui-metric{display:none}`;
      const formatted = Math.round(maximum).toLocaleString('en-US');
      if (showValues && formatted.length * (isGrowth ? 56 : 48) * .65 + unit.length * 22 * .65 + 16 > rect.width - 48) throw new Error('metric and unit too wide for rect');
      body += `<p class="ui-note">${escape(attribution)}</p><div class="ui-metric"><span id="${id}-count" class="ui-count">0</span><span class="ui-unit">${escape(unit)}</span></div><div class="ui-chart">`;
      motion.unshift(`tl.set(${js(`#${id}-count`)}, {textContent:0}, ${start});`);
      points.forEach((point, i) => {
        body += `<div${isGrowth ? ` id="${id}-column-${i}"` : ''} class="ui-column"><div class="ui-bar-track"><div id="${id}-bar-${i}" class="ui-trend-bar" style="height:${point.value / maximum * chartHeight}px"></div></div><span class="ui-point-label">${escape(point.label)}</span></div>`;
        const time = start + point.at;
        if (isGrowth) motion.push(`tl.fromTo(${js(`#${id}-column-${i}`)}, {opacity:0,y:10}, {opacity:1,y:0,duration:0.24,ease:'power3.out'}, ${time});`);
        motion.push(`tl.set(${js(`#${id}-bar-${i}`)}, {scaleY:0}, ${start});`, `tl.to(${js(`#${id}-bar-${i}`)}, {scaleY:1,duration:0.38,ease:'power3.out'}, ${time});`);
        motion.push(`tl.fromTo(${js(`#${id}-count`)}, {textContent:${i ? points[i - 1].value : 0}}, {textContent:${point.value},snap:{textContent:1},duration:0.38,ease:'power2.out',immediateRender:false}, ${time});`);
        events.push({id: `${id}-point-${i}-settle`, time: time + .38});
      });
      body += '</div>';
    } else if (input.kind === 'metric' || input.kind === 'progress') {
      const config = input[input.kind], isMetric = input.kind === 'metric';
      object(config, input.kind, isMetric ? ['mode', 'unit', 'format', 'currency', 'decimals', 'values', 'source'] : ['mode', 'values', 'max', 'label', 'source']);
      const attribution = series(config, input.kind, duration, enterDuration, movement ? exitDuration : null);
      let format;
      if (isMetric) {
        text(config.unit, 'metric.unit', 18);
        if (!['number', 'percent', 'currency'].includes(config.format)) throw new Error('metric.format must be number, percent or currency');
        const decimals = config.decimals ?? (config.format === 'currency' ? 2 : 0);
        number(decimals, 'metric.decimals', 0, 2);
        if (!Number.isInteger(decimals)) throw new Error('metric.decimals must be an integer');
        if (config.format === 'currency') {
          if (!/^[A-Z]{3}$/.test(config.currency ?? '')) throw new Error('metric.currency requires an explicit three-letter code');
          const formatter = new Intl.NumberFormat('en-US', {style: 'currency', currency: config.currency, currencyDisplay: 'code', minimumFractionDigits: decimals, maximumFractionDigits: decimals});
          format = value => formatter.format(value);
        } else {
          if (config.currency !== undefined) throw new Error('currency is only for currency format');
          format = value => value.toLocaleString('en-US', {minimumFractionDigits: decimals, maximumFractionDigits: decimals}) + (config.format === 'percent' ? '%' : '');
        }
      } else {
        const max = config.max ?? 100;
        number(max, 'progress.max', 1, 1_000_000_000);
        if (config.label !== undefined) text(config.label, 'progress.label', 32);
        if (config.values.some(entry => entry.value < 0 || entry.value > max)) throw new Error('progress values must be between 0 and max');
        format = value => `${Math.round(value / max * 100)}%`;
      }
      const noteLines = Math.ceil(attribution.length / Math.floor((rect.width - 48) / (22 * .65)));
      const numberFont = Math.max(36, Math.min(64, Math.floor((rect.width - 48) / (Math.max(...config.values.map(entry => format(entry.value).length)) * .68))));
      if (Math.max(...config.values.map(entry => format(entry.value).length)) * numberFont * .68 > rect.width - 48) throw new Error('formatted metric too wide for rect');
      const unitText = isMetric ? config.unit : (config.label ?? 'Progress');
      const unitLines = Math.ceil(unitText.length / Math.floor((rect.width - 48) / (22 * .65)));
      const requiredHeight = 2 + header + noteLines * 22 * 1.3 + 20 + numberFont * 1.1 + 12 + unitLines * 22 * 1.25 + 20 + (isMetric ? 0 : 40);
      if (rect.height < requiredHeight) throw new Error(`${input.kind} rect too short; requires at least ${Math.ceil(requiredHeight)}px`);
      css += `#${id} .ui-note{margin:0;padding:0 24px 20px;color:#d3d6dd;font-size:22px;line-height:1.3;overflow-wrap:break-word}#${id} .ui-number{margin:0;padding:0 24px 12px;font-size:${numberFont}px;font-weight:750;line-height:1.1;font-variant-numeric:tabular-nums;white-space:nowrap}#${id} .ui-number-unit{padding:0 24px 20px;font-size:22px;color:#d3d6dd}#${id} .ui-progress-track{height:16px;margin:0 24px 24px;background:#474c56;border-radius:8px;overflow:hidden}#${id} .ui-progress-fill{height:100%;background:${accent};transform-origin:left}`;
      body += `<p class="ui-note">${escape(attribution)}</p><div id="${id}-number" class="ui-number">${escape(format(config.values[0].value))}</div><div class="ui-number-unit">${escape(isMetric ? config.unit : (config.label ?? 'Progress'))}</div>`;
      if (!isMetric) body += '<div class="ui-progress-track"><div class="ui-progress-fill"></div></div>';
      motion.push(`tl.set(${js(`#${id}-number`)}, {textContent:${js(format(config.values[0].value))}}, ${start});`);
      if (!isMetric) motion.push(`tl.set(${js(`${selector} .ui-progress-fill`)}, {scaleX:${config.values[0].value / (config.max ?? 100)}}, ${start});`);
      config.values.forEach((entry, i) => {
        const time = start + entry.at;
        if (i === 0) motion.push(`tl.fromTo(${js(`#${id}-number`)}, {opacity:0.7}, {opacity:1,duration:0.2}, ${time});`);
        else textFrames(motion, `#${id}-number`, config.values[i - 1].value, entry.value, format, time);
        if (!isMetric && i > 0) motion.push(`tl.to(${js(`${selector} .ui-progress-fill`)}, {scaleX:${entry.value / (config.max ?? 100)},duration:0.6,ease:'power2.out'}, ${time});`);
        events.push({id: `${id}-value-${i}-settle`, time: time + (i ? .6 : .2)});
      });
    } else if (input.kind === 'checklist') {
      if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 6) throw new Error('rows must contain 1–6 entries; split longer lists');
      const rowHeight = font * 2.5 + 28;
      if (rect.height < header + input.rows.length * rowHeight) throw new Error('checklist rect too short; use fewer rows or a taller rect');
      input.rows.forEach((row, i) => {
        object(row, `rows[${i}]`, ['label', 'status', 'at', 'doneAt']);
        text(row.label, 'row.label', 54);
        if (!['pending', 'active', 'done'].includes(row.status)) throw new Error('row.status must be pending, active or done');
        const eventTime = start + at(row.at, 'row.at');
        const doneTime = row.doneAt === undefined ? null : start + at(row.doneAt, 'row.doneAt');
        if (doneTime !== null && (row.status !== 'active' || doneTime <= eventTime)) throw new Error('doneAt requires an active row and must follow at');
        const labelWidth = rect.width - 48 - 36 - 36 - statusWidth;
        if (row.label.length > Math.floor(labelWidth / (font * .65)) * 2) throw new Error('row label too long for rect; shorten it or widen the module');
        body += `<div id="${id}-row-${i}" class="ui-row" style="height:${rowHeight}px"><span class="ui-check"><svg viewBox="0 0 96 96" aria-hidden="true"><path d="M34 48l10 10 18-20" fill="none" stroke="${accent}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="ui-label">${escape(row.label)}</span><span class="ui-status"><span id="${id}-status-${i}-pending">${escape(statusLabels.pending)}</span><span id="${id}-status-${i}-active" style="opacity:0;position:absolute;right:0">${escape(statusLabels.active)}</span><span id="${id}-status-${i}-done" style="opacity:0;position:absolute;right:0">${escape(statusLabels.done)}</span></span></div>`;
        // Tick path reused from shipped public/icons/check.svg.
        if (row.status !== 'pending') {
          motion.push(`tl.to(${js(`#${id}-status-${i}-pending`)}, {opacity:0,duration:0.01}, ${eventTime});`, `tl.to(${js(`#${id}-status-${i}-${row.status}`)}, {opacity:1,duration:0.16}, ${eventTime});`);
        }
        if (row.status === 'done') motion.push(`tl.to(${js(`#${id}-row-${i} svg`)}, {opacity:1,duration:0.16,ease:'power2.out'}, ${eventTime});`);
        if (row.status === 'active') motion.push(`tl.to(${js(`#${id}-row-${i} .ui-check`)}, {borderColor:${js(accent)},duration:0.16}, ${eventTime});`, `tl.to(${js(`#${id}-row-${i}`)}, {backgroundColor:${js(accent + '22')},duration:0.16}, ${eventTime});`);
        if (row.status !== 'pending') events.push({id: `${id}-row-${i}-state`, time: eventTime + .16});
        if (doneTime !== null) {
          motion.push(`tl.to(${js(`#${id}-row-${i}`)}, {backgroundColor:${js(theme?.surface ?? "#17191d")},duration:0.16}, ${doneTime});`, `tl.to(${js(`#${id}-status-${i}-active`)}, {opacity:0,duration:0.01}, ${doneTime});`, `tl.to(${js(`#${id}-status-${i}-done`)}, {opacity:1,duration:0.16}, ${doneTime});`, `tl.to(${js(`#${id}-row-${i} svg`)}, {opacity:1,duration:0.16,ease:'power2.out'}, ${doneTime});`);
          events.push({id: `${id}-row-${i}-covered`, time: doneTime + .16});
        }
      });
    } else {
      if (!Array.isArray(input.steps) || input.steps.length < 2 || input.steps.length > 6) throw new Error('steps must contain 2–6 entries; split longer rails');
      if (rect.height < header + 160) throw new Error('step-rail rect must leave room for labels');
      motion.unshift(`tl.set(${js(`${selector} .ui-fill`)}, {scaleX:0,transformOrigin:'left center'}, ${start});`);
      if (input.numbered) css += `#${id} .ui-step-number{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:${accent};color:#17191d;font-size:24px;font-weight:750;margin-bottom:12px}`;
      let previous = -1;
      body += `<div class="ui-rail"><div class="ui-fill"></div></div><div class="ui-steps">`;
      input.steps.forEach((step, i) => {
        object(step, `steps[${i}]`, ['label', 'at']);
        text(step.label, 'step.label', 22);
        const labelWidth = (rect.width - 48 - 12 * (input.steps.length - 1)) / input.steps.length;
        if (step.label.length > Math.floor(labelWidth / (Math.max(22, font - 4) * .65)) * 2) throw new Error('step label too long for rect; shorten it or widen the module');
        const offset = at(step.at, 'step.at');
        if (offset <= previous || (previous >= 0 && offset - previous + 1e-9 < .3)) throw new Error('step times must strictly increase with at least 0.3s between events');
        previous = offset;
        body += `<div id="${id}-step-${i}" class="ui-step">${input.numbered ? `<span class="ui-step-number">${i + 1}</span>` : ''}${escape(step.label)}</div>`;
        const time = start + offset;
        motion.push(`tl.to(${js(`#${id}-step-${i}`)}, {opacity:1,duration:0.18}, ${time});`, `tl.to(${js(`#${id}-step-${i}`)}, {color:${js(theme?.accentText ?? accent)},duration:0.18}, ${time});`, `tl.to(${js(`${selector} .ui-fill`)}, {scaleX:${i / (input.steps.length - 1)},duration:0.3,ease:'power2.inOut'}, ${time});`);
        events.push({id: `${id}-step-${i}-settle`, time: time + .3});
      });
      body += '</div>';
    }
  }
  if ((movement || input.treatment || ['date-card', 'status-rack', 'code-snippet', 'excerpt-window', 'focus-flow', 'growth-chart'].includes(input.kind)) && events.some(event => event.time > start + duration - exitDuration + 1e-9)) throw new Error('content must settle before motion exit begins');
  if (theme) {
    const scoped = (selectors, declarations) => selectors.map(name => `${selector}${name ? ` ${name}` : ''}`).join(',') + `{${declarations}}`;
    const fill = input.presentation === 'glass' ? theme.surface + 'DB' : theme.surface;
    css += scoped([''], `background:${fill};color:${theme.foreground};border-color:${theme.border}`);
    css += scoped(['.ui-row', '.ui-rack-row', '.ui-viewer', '.ui-focus-option'], `background:${theme.surface};border-color:${theme.border};color:${theme.foreground}`);
    css += scoped(['.ui-bar'], `background:${input.presentation === 'glass' ? theme.surface + 'E0' : theme.surface};border-color:${theme.border};color:${theme.foreground}`);
    css += scoped(['.ui-body', '.ui-symbol', '.ui-rack-label', '.ui-bar-label', '.ui-title'], `color:${theme.foreground}`);
    css += scoped(['.ui-status', '.ui-focus-note', '.ui-note', '.ui-unit', '.ui-number-unit', '.ui-date-note', '.ui-rack-note', '.ui-code-language', '.ui-excerpt-note', '.ui-token-comment', '.ui-token-string'], `color:${theme.muted}`);
    css += scoped(['.ui-emphasis', '.ui-token-keyword', '.ui-token-number'], `color:${theme.accentText}`);
    css += scoped(['.ui-token-operator', '.ui-step'], `color:${theme.foreground}`);
    css += scoped(['.ui-check', '.ui-bar-track'], `border-color:${theme.border}`);
    css += scoped(['.ui-rail', '.ui-progress-track', '.ui-rack-marker', '.ui-light', '.ui-focus-track'], `background:${theme.border}`);
    // Orange stays an accent fill; dark ink remains legible on its bright band.
    css += scoped(['.ui-month', '.ui-step-number'], 'color:#171612');
    if (input.kind === 'media-window') css += `#${id}-media{background:${theme.surface}!important}`;
    if (input.presentation === 'glass') css += `@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){${scoped([''], `background:${theme.surface}BD`)}}`;
  }
  const background = input.kind === 'media-window' ? 'background:transparent;' : '';
  return {html: `${media}<section id="${id}" ${input.kind === 'media-window' ? chromeTimed : timed} style="${background}">${body}</section>`, css, motion: motion.join('\n'), events, layout: {canvas, rect: {...rect}, ...(movement ? {motion: {enterEnd: start + enterDuration, exitStart: start + duration - exitDuration, end: start + duration}} : {})}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node editorial-ui-modules.mjs module.json');
    const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
    process.stdout.write(`${JSON.stringify(buildEditorialModule(input), null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
