#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const KINDS = ['media-window', 'checklist', 'step-rail', 'callout', 'audience-grid', 'trend-chart', 'metric', 'progress'];
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

function series(config, label, duration) {
  if (!['illustration', 'data'].includes(config.mode)) throw new Error(`${label}.mode must be illustration or data`);
  if (config.mode === 'data') text(config.source, `${label}.source for real data`, 80);
  else if (config.source !== undefined) throw new Error('illustration cannot claim a real data source');
  if (!Array.isArray(config.values) || config.values.length < 1 || config.values.length > 8) throw new Error(`${label}.values must contain 1–8 entries`);
  let previous = -1;
  config.values.forEach((entry, i) => {
    object(entry, `${label}.values[${i}]`, ['value', 'at']);
    number(entry.value, 'value', -1_000_000_000, 1_000_000_000);
    number(entry.at, 'at', .28, duration - .8);
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

// Skill-local authoring helper, not a production API. The host owns its paused
// GSAP timeline and places these fragments directly inside its composition root.
export function buildEditorialModule(input) {
  object(input, 'module', ['id', 'kind', 'aspect', 'start', 'duration', 'rect', 'title', 'accent', 'rows', 'steps', 'media', 'body', 'track', 'statusLabels', 'audience', 'chart', 'metric', 'progress', 'presentation', 'numbered']);
  if (!/^[a-z][a-z0-9-]{0,59}$/.test(input.id ?? '')) throw new Error('id must be a unique lowercase DOM-safe identifier');
  if (!KINDS.includes(input.kind)) throw new Error(`kind must be ${KINDS.join(', ')}`);
  if (input.presentation !== undefined && !['solid', 'glass'].includes(input.presentation)) throw new Error('presentation must be solid or glass');
  if (input.numbered !== undefined && (input.kind !== 'step-rail' || typeof input.numbered !== 'boolean')) throw new Error('numbered is a boolean for step-rail only');
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
  const allowed = {'media-window': ['media'], checklist: ['rows'], 'step-rail': ['steps'], callout: ['body'], 'audience-grid': ['audience'], 'trend-chart': ['chart'], metric: ['metric'], progress: ['progress']}[input.kind];
  for (const key of ['media', 'rows', 'steps', 'body', 'audience', 'chart', 'metric', 'progress']) if (input[key] !== undefined && !allowed.includes(key)) throw new Error(`${input.kind} does not accept ${key}`);
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
  motion.push(`tl.set(${js(selector)}, {opacity:0}, ${start + duration});`);
  const at = (value, label) => number(value, label, .28, duration - .45);
  let css = `#${id}{position:absolute;${placement};box-sizing:border-box;overflow:hidden;background:#17191d;color:#f7f7f8;border:1px solid #535761;border-radius:18px;box-shadow:0 16px 48px #0005;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:${font}px;line-height:1.25}#${id} *{box-sizing:border-box}#${id} .ui-title{margin:0;padding:${pad}px;font-size:${font + 4}px;font-weight:700;line-height:1.15}#${id} .ui-row{display:flex;align-items:center;gap:18px;padding:14px ${pad}px;border-top:1px solid #383c45}#${id} .ui-label{flex:1;min-width:0;overflow-wrap:break-word}#${id} .ui-check{width:36px;height:36px;flex:none;border:2px solid #828791;border-radius:7px;display:grid;place-items:center}#${id} .ui-check svg{width:32px;height:32px;opacity:0}#${id} .ui-status{font-size:${font - 6}px;color:#b8bbc3;width:${statusWidth}px;flex:none;text-align:right;position:relative}#${id} .ui-bar{position:absolute;top:0;left:0;right:0;height:48px;display:flex;align-items:center;gap:10px;padding:0 16px;background:#24272e;border-bottom:1px solid #535761}#${id} .ui-dot{width:12px;height:12px;border-radius:50%}#${id} .ui-bar-label{margin-left:12px;font-size:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#${id} .ui-content{padding:${pad}px}#${id} .ui-rail{position:relative;margin:20px ${pad}px 0;height:8px;background:#474c56;border-radius:4px}#${id} .ui-fill{height:100%;background:${accent};transform-origin:left;border-radius:4px}#${id} .ui-steps{display:flex;justify-content:space-between;padding:22px ${pad}px;gap:12px}#${id} .ui-step{flex:1;min-width:0;font-size:${Math.max(22, font - 4)}px;overflow-wrap:break-word;opacity:.65}#${id} .ui-body{padding:0 ${pad}px ${pad}px;margin:0;color:#d3d6dd;overflow-wrap:break-word}`;
  let body = '', media = '';
  if (input.presentation === 'glass') {
    // Opaque tint is the readability fallback when native video compositing
    // does not reproduce backdrop blur. Keep framed media itself sharp.
    css += input.kind === 'media-window' ? `#${id} .ui-bar{background:rgba(28,31,39,.88);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}` : `#${id}{background:rgba(23,25,29,.86);border-color:#ffffff50;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}`;
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
    motion.push(`tl.fromTo(${js(`#${id}-media`)}, {opacity:0,y:18}, {opacity:1,y:0,duration:0.28,ease:'power3.out'}, ${start});`, `tl.to(${js(`#${id}-media`)}, {opacity:0,y:-8,duration:0.22,ease:'power2.in'}, ${exit});`);
  } else {
    body = `<h2 class="ui-title">${escape(input.title)}</h2>`;
    if (input.kind === 'callout') {
      text(input.body, 'body', 160);
      const lines = Math.ceil(input.body.length / Math.max(18, Math.floor((rect.width - pad * 2) / (font * .58))));
      if (rect.height < header + lines * font * 1.25 + pad) throw new Error('callout rect too short for body');
      body += `<p class="ui-body">${escape(input.body)}</p>`;
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
    } else if (input.kind === 'trend-chart') {
      object(input.chart, 'chart', ['mode', 'points', 'unit', 'source']);
      const {mode, points} = input.chart;
      if (!['illustration', 'data'].includes(mode)) throw new Error('chart.mode must be illustration or data');
      if (!Array.isArray(points) || points.length < 2 || points.length > 8) throw new Error('chart.points must contain 2–8 entries');
      const unit = text(input.chart.unit, 'chart.unit', 18);
      if (mode === 'data') text(input.chart.source, 'chart.source for real data', 80);
      else if (input.chart.source !== undefined) throw new Error('illustration cannot claim a real data source');
      const attribution = mode === 'illustration' ? 'Illustration · example values' : `Source: ${input.chart.source}`;
      const columnWidth = (rect.width - 48 - 16 * (points.length - 1)) / points.length;
      const chartHeight = 180, labelFont = 22;
      const attributionLines = Math.ceil(attribution.length / Math.floor((rect.width - 48) / (22 * .65)));
      if (columnWidth < 40 || rect.height < header + attributionLines * 29 + 24 + 80 + chartHeight + 80) throw new Error('trend chart does not fit rect; use fewer points or a larger rect');
      let previous = -1;
      points.forEach((point, i) => {
        object(point, `chart.points[${i}]`, ['label', 'value', 'at']);
        text(point.label, 'point.label', 16);
        number(point.value, 'point.value', 0, 1_000_000_000);
        if (!Number.isInteger(point.value)) throw new Error('point.value must be a whole count');
        if (point.label.length > Math.floor(columnWidth / (labelFont * .65)) * 2) throw new Error('point label too long for rect');
        const offset = at(point.at, 'point.at');
        if (offset <= previous || (previous >= 0 && offset - previous + 1e-9 < .5)) throw new Error('point times must increase with at least 0.5s between events');
        previous = offset;
      });
      const maximum = Math.max(1, ...points.map(point => point.value));
      css += `#${id} .ui-note{margin:0;padding:0 24px 20px;color:#d3d6dd;font-size:22px;line-height:1.3;overflow-wrap:break-word}#${id} .ui-metric{padding:0 24px 20px;height:80px;display:flex;align-items:baseline;gap:16px;white-space:nowrap}#${id} .ui-count{font-size:48px;font-weight:750;font-variant-numeric:tabular-nums}#${id} .ui-unit{font-size:22px;color:#d3d6dd}#${id} .ui-chart{display:grid;grid-template-columns:repeat(${points.length},minmax(0,1fr));gap:16px;padding:0 24px 24px}#${id} .ui-column{min-width:0;text-align:center}#${id} .ui-bar-track{height:${chartHeight}px;display:flex;align-items:flex-end;border-bottom:1px solid #828791}#${id} .ui-trend-bar{width:100%;background:${accent};border-radius:7px 7px 0 0;transform-origin:bottom}#${id} .ui-point-label{display:block;font-size:${labelFont}px;line-height:1.25;margin-top:12px;overflow-wrap:break-word}`;
      const formatted = Math.round(maximum).toLocaleString('en-US');
      if (formatted.length * 48 * .65 + unit.length * 22 * .65 + 16 > rect.width - 48) throw new Error('metric and unit too wide for rect');
      body += `<p class="ui-note">${escape(attribution)}</p><div class="ui-metric"><span id="${id}-count" class="ui-count">0</span><span class="ui-unit">${escape(unit)}</span></div><div class="ui-chart">`;
      motion.unshift(`tl.set(${js(`#${id}-count`)}, {textContent:0}, ${start});`);
      points.forEach((point, i) => {
        body += `<div class="ui-column"><div class="ui-bar-track"><div id="${id}-bar-${i}" class="ui-trend-bar" style="height:${point.value / maximum * chartHeight}px"></div></div><span class="ui-point-label">${escape(point.label)}</span></div>`;
        const time = start + point.at;
        motion.push(`tl.set(${js(`#${id}-bar-${i}`)}, {scaleY:0}, ${start});`, `tl.to(${js(`#${id}-bar-${i}`)}, {scaleY:1,duration:0.38,ease:'power3.out'}, ${time});`);
        motion.push(`tl.fromTo(${js(`#${id}-count`)}, {textContent:${i ? points[i - 1].value : 0}}, {textContent:${point.value},snap:{textContent:1},duration:0.38,ease:'power2.out',immediateRender:false}, ${time});`);
        events.push({id: `${id}-point-${i}-settle`, time: time + .38});
      });
      body += '</div>';
    } else if (input.kind === 'metric' || input.kind === 'progress') {
      const config = input[input.kind], isMetric = input.kind === 'metric';
      object(config, input.kind, isMetric ? ['mode', 'unit', 'format', 'currency', 'decimals', 'values', 'source'] : ['mode', 'values', 'max', 'label', 'source']);
      const attribution = series(config, input.kind, duration);
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
        if (config.format === 'percent' && config.values.some(entry => entry.value < 0 || entry.value > 100)) throw new Error('percent values must be between 0 and 100');
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
        if (!isMetric && i > 0) motion.push(`tl.to(${js(`${selector} .ui-progress-fill`)}, {scaleX:${entry.value / (config.max ?? 100)},duration:0.6,ease:'power2.inOut'}, ${time});`);
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
          motion.push(`tl.to(${js(`#${id}-row-${i}`)}, {backgroundColor:"#17191d",duration:0.16}, ${doneTime});`, `tl.to(${js(`#${id}-status-${i}-active`)}, {opacity:0,duration:0.01}, ${doneTime});`, `tl.to(${js(`#${id}-status-${i}-done`)}, {opacity:1,duration:0.16}, ${doneTime});`, `tl.to(${js(`#${id}-row-${i} svg`)}, {opacity:1,duration:0.16,ease:'power2.out'}, ${doneTime});`);
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
