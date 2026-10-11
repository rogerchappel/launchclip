#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const KINDS = ['media-window', 'checklist', 'step-rail', 'callout'];
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

// Skill-local authoring helper, not a production API. The host owns its paused
// GSAP timeline and places these fragments directly inside its composition root.
export function buildEditorialModule(input) {
  object(input, 'module', ['id', 'kind', 'aspect', 'start', 'duration', 'rect', 'title', 'accent', 'rows', 'steps', 'media', 'body', 'track', 'statusLabels']);
  if (!/^[a-z][a-z0-9-]{0,59}$/.test(input.id ?? '')) throw new Error('id must be a unique lowercase DOM-safe identifier');
  if (!KINDS.includes(input.kind)) throw new Error(`kind must be ${KINDS.join(', ')}`);
  if (!['16:9', '9:16'].includes(input.aspect)) throw new Error('aspect must be 16:9 or 9:16');
  const canvas = input.aspect === '16:9' ? {width: 1920, height: 1080} : {width: 1080, height: 1920};
  const start = number(input.start, 'start', 0, 86400);
  const duration = number(input.duration, 'duration', 1, 3600);
  const rect = input.rect ?? (input.aspect === '16:9' ? {x: 80, y: 480, width: 680, height: 500} : {x: 90, y: 960, width: 900, height: 740});
  object(rect, 'rect', ['x', 'y', 'width', 'height']);
  number(rect.width, 'rect.width', 420, canvas.width);
  number(rect.height, 'rect.height', 160, canvas.height);
  number(rect.x, 'rect.x', 0, canvas.width - rect.width);
  number(rect.y, 'rect.y', 0, canvas.height - rect.height);
  text(input.title, 'title', 54);
  const accent = input.accent ?? '#FF6A00';
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new Error('accent must be a six-digit hex color');
  const allowed = {'media-window': ['media'], checklist: ['rows'], 'step-rail': ['steps'], callout: ['body']}[input.kind];
  for (const key of ['media', 'rows', 'steps', 'body']) if (input[key] !== undefined && !allowed.includes(key)) throw new Error(`${input.kind} does not accept ${key}`);
  const statusLabels = {pending: 'Pending', active: 'Active', done: 'Done', ...(input.statusLabels ?? {})};
  if (input.statusLabels !== undefined) {
    if (input.kind !== 'checklist') throw new Error('statusLabels is only for checklist');
    object(input.statusLabels, 'statusLabels', ['pending', 'active', 'done']);
    for (const label of Object.values(statusLabels)) text(label, 'status label', 14);
  }
  const id = input.id, selector = `#${id}`, font = Math.max(24, Math.min(36, Math.round(rect.width / 22)));
  const statusWidth = Math.max(100, Math.ceil(Math.max(...Object.values(statusLabels).map(label => label.length)) * (font - 6) * .65));
  const pad = 24, titleLines = Math.ceil(input.title.length / Math.max(1, Math.floor((rect.width - 48) / ((font + 4) * .65))));
  const header = pad * 2 + titleLines * (font + 4) * 1.15, exit = start + duration - .22;
  const track = input.track ?? 2;
  number(track, 'track', 1, 98);
  if (!Number.isInteger(track)) throw new Error('track must be an integer');
  const timed = `class="clip" data-start="${start}" data-duration="${duration}" data-track-index="${track}"`;
  const chromeTimed = timed.replace(`data-track-index="${track}"`, `data-track-index="${track + 1}" data-layout-allow-occlusion="true"`);
  const placement = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
  const events = [{id: `${id}-enter`, time: start + .28}];
  const motion = [`tl.fromTo(${js(selector)}, {opacity:0,y:18}, {opacity:1,y:0,duration:0.28,ease:'power3.out'}, ${start});`, `tl.to(${js(selector)}, {opacity:0,y:-8,duration:0.22,ease:'power2.in'}, ${exit});`];
  const at = (value, label) => number(value, label, .28, duration - .45);
  const css = `#${id}{position:absolute;${placement};box-sizing:border-box;overflow:hidden;background:#17191d;color:#f7f7f8;border:1px solid #535761;border-radius:18px;box-shadow:0 16px 48px #0005;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:${font}px;line-height:1.25}#${id} *{box-sizing:border-box}#${id} .ui-title{margin:0;padding:${pad}px;font-size:${font + 4}px;font-weight:700;line-height:1.15}#${id} .ui-row{display:flex;align-items:center;gap:18px;padding:14px ${pad}px;border-top:1px solid #383c45}#${id} .ui-label{flex:1;min-width:0;overflow-wrap:break-word}#${id} .ui-check{width:36px;height:36px;flex:none;border:2px solid #828791;border-radius:7px;display:grid;place-items:center}#${id} .ui-check svg{width:32px;height:32px;opacity:0}#${id} .ui-status{font-size:${font - 6}px;color:#b8bbc3;width:${statusWidth}px;flex:none;text-align:right;position:relative}#${id} .ui-bar{position:absolute;top:0;left:0;right:0;height:48px;display:flex;align-items:center;gap:10px;padding:0 16px;background:#24272e;border-bottom:1px solid #535761}#${id} .ui-dot{width:12px;height:12px;border-radius:50%}#${id} .ui-bar-label{margin-left:12px;font-size:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#${id} .ui-content{padding:${pad}px}#${id} .ui-rail{position:relative;margin:20px ${pad}px 0;height:8px;background:#474c56;border-radius:4px}#${id} .ui-fill{height:100%;background:${accent};transform:scaleX(0);transform-origin:left;border-radius:4px}#${id} .ui-steps{display:flex;justify-content:space-between;padding:22px ${pad}px;gap:12px}#${id} .ui-step{flex:1;min-width:0;font-size:${Math.max(22, font - 4)}px;overflow-wrap:break-word;opacity:.4}#${id} .ui-body{padding:0 ${pad}px ${pad}px;margin:0;color:#d3d6dd;overflow-wrap:break-word}`;
  let body = '', media = '';
  if (input.kind === 'media-window') {
    localMedia(input.media);
    const source = input.media;
    const content = `position:absolute;left:${rect.x}px;top:${rect.y + 48}px;width:${rect.width}px;height:${rect.height - 48}px;object-fit:contain;background:#111;border-radius:0 0 18px 18px`;
    // Direct root child: HyperFrames controls the video clock. Chrome never
    // restarts the source or owns narration. Pattern follows the assembler's
    // root-media-window-bar/dot markup, not an external React UI library.
    media = source.kind === 'video' ? `<video id="${id}-media" ${timed} data-media-start="${source.sourceStart ?? 0}" src="${escape(source.src)}" muted playsinline style="${content}"></video>` : `<img id="${id}-media" ${timed} src="${escape(source.src)}" alt="${escape(input.title)}" style="${content}" />`;
    body = `<div class="ui-bar"><span class="ui-dot" style="background:#ff6258"></span><span class="ui-dot" style="background:#ffc04a"></span><span class="ui-dot" style="background:#40c957"></span><span class="ui-bar-label">${escape(input.title)}</span></div>`;
    motion.push(`tl.fromTo(${js(`#${id}-media`)}, {opacity:0,y:18}, {opacity:1,y:0,duration:0.28,ease:'power3.out'}, ${start});`, `tl.to(${js(`#${id}-media`)}, {opacity:0,y:-8,duration:0.22,ease:'power2.in'}, ${exit});`);
  } else {
    body = `<h2 class="ui-title">${escape(input.title)}</h2>`;
    if (input.kind === 'callout') {
      text(input.body, 'body', 160);
      const lines = Math.ceil(input.body.length / Math.max(18, Math.floor((rect.width - pad * 2) / (font * .58))));
      if (rect.height < header + lines * font * 1.25 + pad) throw new Error('callout rect too short for body');
      body += `<p class="ui-body">${escape(input.body)}</p>`;
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
          motion.push(`tl.to(${js(`#${id}-row-${i}`)}, {backgroundColor:"#17191d",duration:0.16}, ${doneTime});`, `tl.to(${js(`#${id}-status-${i}-active`)}, {opacity:0,duration:0.01}, ${doneTime});`, `tl.to(${js(`#${id}-status-${i}-done`)}, {opacity:1,duration:0.16}, ${doneTime});`, `tl.to(${js(`#${id}-row-${i} svg`)}, {opacity:1,duration:0.16,ease:'power2.out'}, ${doneTime});`);
          events.push({id: `${id}-row-${i}-covered`, time: doneTime + .16});
        }
      });
    } else {
      if (!Array.isArray(input.steps) || input.steps.length < 2 || input.steps.length > 6) throw new Error('steps must contain 2–6 entries; split longer rails');
      if (rect.height < header + 160) throw new Error('step-rail rect must leave room for labels');
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
        body += `<div id="${id}-step-${i}" class="ui-step">${escape(step.label)}</div>`;
        const time = start + offset;
        motion.push(`tl.to(${js(`#${id}-step-${i}`)}, {opacity:1,duration:0.18}, ${time});`, `tl.to(${js(`#${id}-step-${i}`)}, {color:${js(accent)},duration:0.18}, ${time});`, `tl.to(${js(`${selector} .ui-fill`)}, {scaleX:${i / (input.steps.length - 1)},duration:0.3,ease:'power2.inOut'}, ${time});`);
        events.push({id: `${id}-step-${i}-settle`, time: time + .3});
      });
      body += '</div>';
    }
  }
  const background = input.kind === 'media-window' ? 'background:transparent;' : '';
  return {html: `${media}<section id="${id}" ${input.kind === 'media-window' ? chromeTimed : timed} style="${background}">${body}</section>`, css, motion: motion.join('\n'), events, layout: {canvas, rect: {...rect}}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node editorial-ui-modules.mjs module.json');
    const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
    process.stdout.write(`${JSON.stringify(buildEditorialModule(input), null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
