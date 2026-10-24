// Catalogue E: product moments around the presenter (docs/SUBJECT_EFFECTS_RFC.md
// §6.1). Contract: docs/KIT_CONTRACTS.md ("Subject layer", "Catalogue E").
//
//   feed-frame     the recording springs into a portrait feed window; the
//                  presenter breaks out over its edges (split)
//   pull-back      the recording shrinks into an app window while real steps
//                  tick off and a progress bar fills (front)
//   backdrop-swap  the room gives way to a brand backdrop, image or video; the
//                  presenter glides down in front of it (behind)
//   app-stage      the product UI fills the top of the frame and the
//                  presenter's head rises over its edge (behind)
//   phone-stage    a phone beside the presenter plays a real recording while
//                  the room pans away from it (front)
//
// Same conventions as catalogue C (createFootageBase, absolute times, `at`
// from the scene start, hits timing events). The view is
// {front, behind?, media?, overlay?}: element trees for each layer part, the
// media node (a <video> HyperFrames hoists to the root; Remotion draws it as
// an <OffthreadVideo>) and an overlay drawn above the media. Every moving
// container's ops are mirrored onto its media with the same transform origin,
// so a hoisted video moves with the panel or phone it sits in.
//
// Framed base. feed-frame and pull-back move the base with model.camera
// (scale below 1, toward a window) and draw a "hole": a box in the base's own
// coordinates, given the same per-frame transform, whose huge box-shadow
// covers everything outside the window. The subject (when mounted) follows
// the base camera, so in feed-frame it breaks out over the hole's edges.

import {springValue} from './motion.mjs';
import {fitText, mixColor, r2, rt, textWidth} from './catalog-b-base.mjs';
import {abs, el, sampleTime, set, transformString, tw} from './catalog-b-view.mjs';
import {PUNCH_SPRING, createFootageBase, headRect} from './catalog-c.mjs';
import {grammarTweens} from './grammar.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const MEDIA_PATH = /^assets\/[a-zA-Z0-9_./ -]+$/;
const VIDEO_FILE = /\.(mp4|webm|mov|m4v)$/i;
const IMAGE_FILE = /\.(png|jpe?g|webp|gif|svg)$/i;

function media(check, value, path, {required = true} = {}) {
  if (value === undefined && !required) return null;
  check.obj(value, path, ['src', 'sourceStart', 'fit'], ['src']);
  const src = value.src;
  if (typeof src !== 'string' || !MEDIA_PATH.test(src) || src.split(/[\\/]/).includes('..')) check.fail(`${path}.src`, `must be a project-local assets/ image or video; got ${JSON.stringify(src)}`);
  const kind = VIDEO_FILE.test(src) ? 'video' : IMAGE_FILE.test(src) ? 'image' : check.fail(`${path}.src`, 'must be an image (.png, .jpg, .webp, .gif, .svg) or a video (.mp4, .webm, .mov, .m4v)');
  const sourceStart = value.sourceStart === undefined ? 0 : check.num(value.sourceStart, `${path}.sourceStart`, 0, 86400);
  if (kind === 'image' && value.sourceStart !== undefined) check.fail(`${path}.sourceStart`, 'applies to a video only');
  const fit = value.fit === undefined ? 'cover' : check.oneOf(value.fit, `${path}.fit`, ['cover', 'contain']);
  return {kind, src, sourceStart, fit};
}

// Spring progress 0 → 1 at `start`, back to 0 from `release` (the punch-in springs).
function springIn(t, {start, release, fps}) {
  if (t < start - 1e-9) return 0;
  const pin = springValue(t, {start, fps, ...PUNCH_SPRING.in});
  const pout = t < release - 1e-9 ? 0 : springValue(t, {start: release, fps, ...PUNCH_SPRING.out});
  return pin * (1 - pout);
}

// One sample per frame over the scene, identity on the last.
function frameSamples(b, fn) {
  const samples = [];
  for (let f = Math.ceil(b.start * b.fps - 1e-6); f <= Math.floor(b.end * b.fps + 1e-6); f++) samples.push({t: rt(f / b.fps), ...fn(f / b.fps)});
  if (!samples.length || samples.at(-1).t < b.end - 1e-6) samples.push({t: b.end, scale: 1, x: 0, y: 0});
  else Object.assign(samples.at(-1), {scale: 1, x: 0, y: 0});
  return samples;
}

/**
 * A base camera that springs the full frame into `target` (a canvas rect with
 * the canvas's aspect) at `start` and back out from `release`. → samples.
 */
function framedCamera(b, target, {start, release}) {
  const {canvas} = b;
  const scale = target.width / canvas.width;
  const dx = target.x + target.width / 2 - canvas.width / 2;
  const dy = target.y + target.height / 2 - canvas.height / 2;
  return frameSamples(b, t => {
    const p = springIn(t, {start, release, fps: b.fps});
    return {scale: Math.round((1 + (scale - 1) * p) * 1e5) / 1e5, x: r2(dx * p) || 0, y: r2(dy * p) || 0};
  });
}

// Where a rect in the base's own coordinates lands under a camera sample.
function underCamera(rect, sample, canvas) {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const s = sample.scale;
  return {x: r2(cx + (rect.x - cx) * s + sample.x), y: r2(cy + (rect.y - cy) * s + sample.y), width: r2(rect.width * s), height: r2(rect.height * s)};
}

// The hole: a box at `crop` (base coordinates) whose box-shadow covers
// everything outside it, moved with the base camera on every sample.
function holeNode(id, crop, canvas, {color, radius}) {
  const spread = Math.max(canvas.width, canvas.height) * 3;
  return el('div', `${id}-hole`, abs(crop.x, crop.y, crop.width, crop.height, {boxSizing: 'border-box', borderRadius: radius, boxShadow: `0 0 0 ${spread}px ${color}`,
    transformOrigin: `${r2(canvas.width / 2 - crop.x)}px ${r2(canvas.height / 2 - crop.y)}px`, opacity: 0}));
}

function holeOps(ops, id, samples, {start, fadeIn, release, releaseDuration}) {
  set(ops, `${id}-hole`, start, {opacity: 0, x: 0, y: 0, scaleX: 1, scaleY: 1});
  for (const s of samples) set(ops, `${id}-hole`, Math.max(start, sampleTime(s.t)), {x: s.x, y: s.y, scaleX: s.scale, scaleY: s.scale});
  tw(ops, `${id}-hole`, start, fadeIn, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-hole`, release, releaseDuration, 'power1.in', {opacity: 1}, {opacity: 0});
}

// Mirror a container's transform ops onto its hoisted media.
function mirror(ops, from, to) {
  for (const op of [...ops]) if (op.target === from) ops.push({...op, target: to, props: op.props ? {...op.props} : undefined, from: op.from ? {...op.from} : undefined, to: op.to ? {...op.to} : undefined});
}

function mediaNode(id, rect, m, {origin, radius = 0}) {
  const style = abs(rect.x, rect.y, rect.width, rect.height, {objectFit: m.fit, borderRadius: radius, background: '#000000', opacity: 0,
    transformOrigin: `${r2(origin.x - rect.x)}px ${r2(origin.y - rect.y)}px`});
  return m.kind === 'video' ? el('video', `${id}-media`, style, [], {src: m.src, muted: '', playsinline: ''}) : el('img', `${id}-media`, style, [], {src: m.src, alt: ''});
}

function checkWindow(b, rect, label) {
  const {safe} = b;
  if (rect.x < -1e-6 || rect.y < -1e-6 || rect.x + rect.width > b.canvas.width + 1e-6 || rect.y + rect.height > b.canvas.height + 1e-6) b.check.fail('params', `${label} falls outside the frame`);
  return rect.y >= safe.y - 1e-6;
}

// ---------------------------------------------------------------------------
// feed-frame (split): the recording springs into a portrait feed window; the
// presenter breaks out over its top and sides. Generic chrome only: no
// platform branding, and counts only when the user supplies them.

const ICONS = {
  heart: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.5 1.2 5.3 3.2 1.8-2 3.2-3.2 5.3-3.2 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z',
  comment: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  share: 'M14 4l7 7-7 7v-4c-5 0-8.5 1.5-11 5 1-5 4-10 11-11V4z'
};

function resolveFeedFrame(params, ctx) {
  const b = createFootageBase('feed-frame', params, ctx, {allowed: ['handle', 'caption', 'counts', 'follow', 'scale', 'at', 'release'], hidesCaptions: true, minDuration: CATALOG_E_TIMING['feed-frame'].minDuration});
  const {check, u, canvas, colors, end, duration, portrait} = b;
  const p = b.params;
  const handle = p.handle === undefined ? null : check.str(p.handle, 'params.handle', 24);
  if (handle && !/^@?[\w.]+$/.test(handle)) check.fail('params.handle', 'must be one handle (letters, digits, dots, underscores)');
  const caption = p.caption === undefined ? null : check.str(p.caption, 'params.caption', 60);
  let counts = null;
  if (p.counts !== undefined) {
    check.obj(p.counts, 'params.counts', ['likes', 'comments', 'shares']);
    counts = Object.fromEntries(['likes', 'comments', 'shares'].map(key => [key, p.counts[key] === undefined ? null : check.str(p.counts[key], `params.counts.${key}`, 8)]));
  }
  const follow = p.follow === undefined ? Boolean(handle) : check.bool(p.follow, 'params.follow');
  if (follow && !handle) check.fail('params.follow', 'needs params.handle (the follow pill sits beside it)');
  const scale = p.scale === undefined ? (portrait ? 0.72 : 0.62) : check.num(p.scale, 'params.scale', 0.55, 0.85);
  const release = p.release === undefined ? 0.5 : check.num(p.release, 'params.release', 0.3, 1);
  const springAt = b.timeOf('frame', p.at, 'params.at', 0, {min: 0, max: duration - release - CATALOG_E_TIMING['feed-frame'].hold});
  const releaseAt = rt(end - release);
  // The window: the scaled frame, a little above centre; the hole crops it at
  // eye level and at the sides so the presenter breaks out over the edges.
  const target = {x: r2((canvas.width - canvas.width * scale) / 2), y: r2((canvas.height - canvas.height * scale) / 2 - u(40)), width: r2(canvas.width * scale), height: r2(canvas.height * scale)};
  const head = headRect(ctx, canvas, portrait);
  const eyes = head.y + head.height * 0.45;
  const crop = {x: r2(canvas.width * 0.07), y: r2(Math.min(canvas.height * 0.5, Math.max(canvas.height * 0.06, eyes))), width: r2(canvas.width * 0.86), height: 0};
  crop.height = r2(canvas.height - crop.y);
  const samples = framedCamera(b, target, {start: springAt, release: releaseAt});
  const settled = {scale, x: r2(target.x + target.width / 2 - canvas.width / 2), y: r2(target.y + target.height / 2 - canvas.height / 2)};
  const win = underCamera(crop, settled, canvas);
  checkWindow(b, win, 'the feed window');
  const settleAt = rt(springAt + 0.55);
  const chromeAt = rt(settleAt + 0.1);
  // Chrome: an icon column on the right, the handle row and caption at the bottom left, a progress bar.
  const iconSize = r2(u(54)), countSize = r2(Math.max(b.min.meta, u(28)));
  const pad = u(26);
  const iconKeys = ['heart', 'comment', 'share'];
  const icons = iconKeys.map((key, i) => {
    const label = counts ? counts[key === 'heart' ? 'likes' : key === 'comment' ? 'comments' : 'shares'] : null;
    const y = r2(win.y + win.height * 0.42 + i * (iconSize + (label ? countSize * 1.3 : 0) + u(26)));
    return {key, path: ICONS[key], x: r2(win.x + win.width - pad - iconSize), y, label};
  });
  const nameSize = r2(Math.max(b.min.key * 0.75, u(34))), captionSize = r2(Math.max(b.min.meta, u(30)));
  const avatar = r2(u(64));
  const rowY = r2(win.y + win.height - pad - u(20) - (caption ? captionSize * 1.35 + u(10) : 0) - avatar);
  const nameW = handle ? textWidth(handle.startsWith('@') ? handle : `@${handle}`, nameSize, 'body') : 0;
  const followW = follow ? textWidth('Follow', captionSize, 'body') + u(36) : 0;
  const maxCaption = win.width - pad * 2 - iconSize - u(20);
  if (caption && textWidth(caption, captionSize, 'body') > maxCaption) check.fail('params.caption', `does not fit the feed window on one line (${Math.round(textWidth(caption, captionSize, 'body'))} px in ${Math.round(maxCaption)} px); shorten it`);
  if (pad + avatar + u(16) + nameW + u(16) + followW > win.width - iconSize - pad * 2) check.fail('params.handle', 'is too long for the feed window');
  const ink = '#ffffff';
  b.requireContrast('chrome/shade', ink, '#000000', 'feed chrome on its shade');
  b.events.push({id: `${b.id}-frame`, name: 'frame', time: springAt, endTime: settleAt, role: 'emphasis', cue: 'whoosh'});
  b.events.push({id: `${b.id}-chrome`, name: 'chrome', time: chromeAt, endTime: rt(chromeAt + 0.4), role: 'detail', cue: 'pop-soft'});
  b.events.push({id: `${b.id}-release`, name: 'release', time: releaseAt, endTime: end, role: 'release'});
  b.model.camera = {target: 'base', scale, punchAt: springAt, releaseAt, samples, frame: true};
  b.model.layer = 'split';
  b.model.parts = {behind: ['hole'], front: ['chrome']};
  const content = {handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`) : null, caption, counts, follow, scale, release, springAt, settleAt, chromeAt, releaseAt, crop, window: win,
    backdrop: mixColor(colors.bg, '#000000', 0.7), radius: r2(u(36) / scale), icons, iconSize, countSize, nameSize, captionSize, avatar, rowY, pad, ink,
    accent: colors.primary, avatarFill: mixColor(colors.primary, colors.bg, 0.8), progressY: r2(win.y + win.height - u(8)), shade: '#00000059', samples};
  return b.finish(content, {rect: win, role: 'media', minTextPx: null,
    motion: {enterEnd: settleAt, exitStart: releaseAt, exitTo: {opacity: 1}}});
}

function feedFrameView(model) {
  const {id, fonts, canvas} = model;
  const c = model.content, W = c.window;
  const behind = el('div', `${id}-behind`, abs(0, 0, canvas.width, canvas.height, {overflow: 'hidden'}), [holeNode(id, c.crop, canvas, {color: c.backdrop, radius: c.radius})]);
  const icon = (i) => {
    const item = c.icons[i];
    const kids = [el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, [el('path', null, null, [], {d: item.path, fill: c.ink})], {width: c.iconSize, height: c.iconSize, viewBox: '0 0 24 24'})];
    if (item.label) kids.push(el('div', null, abs(-c.iconSize, c.iconSize + 4 * model.unit, c.iconSize * 3, undefined, {textAlign: 'center', fontFamily: fonts.body, fontWeight: 700, fontSize: c.countSize, color: c.ink, textShadow: '0 2px 6px #00000099'}), [item.label]));
    return el('div', `${id}-icon-${i}`, abs(item.x, item.y, c.iconSize, c.iconSize, {filter: 'drop-shadow(0 2px 6px #00000099)'}), kids);
  };
  const chrome = [
    el('div', `${id}-shade`, abs(W.x, W.y + W.height * 0.62, W.width, W.height * 0.38, {background: `linear-gradient(180deg, #00000000, ${c.shade})`})),
    ...c.icons.map((_, i) => icon(i))
  ];
  if (c.handle) {
    const x0 = W.x + c.pad;
    chrome.push(el('div', `${id}-avatar`, abs(x0, c.rowY, c.avatar, c.avatar, {borderRadius: '50%', background: c.avatarFill, border: `${3 * model.unit}px solid ${c.ink}`})));
    chrome.push(el('div', `${id}-handle`, abs(x0 + c.avatar + 16 * model.unit, c.rowY + (c.avatar - c.nameSize * 1.2) / 2, undefined, undefined, {whiteSpace: 'nowrap', fontFamily: fonts.body, fontWeight: 700, fontSize: c.nameSize, lineHeight: '1.2', color: c.ink, textShadow: '0 2px 6px #00000099'}), [c.handle]));
    if (c.follow) {
      const fx = x0 + c.avatar + 32 * model.unit + textWidth(c.handle, c.nameSize, 'body');
      chrome.push(el('div', `${id}-follow`, abs(fx, c.rowY + (c.avatar - c.captionSize * 1.9) / 2, undefined, c.captionSize * 1.9, {boxSizing: 'border-box', padding: `0 ${18 * model.unit}px`, display: 'flex', alignItems: 'center', borderRadius: 10 * model.unit,
        border: `${2 * model.unit}px solid ${c.ink}`, fontFamily: fonts.body, fontWeight: 700, fontSize: c.captionSize, color: c.ink, whiteSpace: 'nowrap'}), ['Follow']));
    }
  }
  if (c.caption) chrome.push(el('div', `${id}-caption`, abs(W.x + c.pad, c.rowY + c.avatar + 10 * model.unit, W.width - c.pad * 2 - c.iconSize, undefined, {whiteSpace: 'nowrap', fontFamily: fonts.body, fontWeight: 500, fontSize: c.captionSize, lineHeight: '1.35', color: c.ink, textShadow: '0 2px 6px #00000099'}), [c.caption]));
  chrome.push(el('div', `${id}-track`, abs(W.x, c.progressY, W.width, 4 * model.unit, {background: '#ffffff40'})));
  chrome.push(el('div', `${id}-bar`, abs(W.x, c.progressY, W.width, 4 * model.unit, {background: c.ink, transformOrigin: '0 50%', transform: transformString({scaleX: 0.02})})));
  const front = el('div', `${id}-chrome`, abs(0, 0, canvas.width, canvas.height, {opacity: 0}), chrome);
  return {behind, front};
}

function feedFrameTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  holeOps(ops, id, c.samples, {start, fadeIn: 0.3, release: c.releaseAt, releaseDuration: c.release});
  set(ops, `${id}-chrome`, start, {opacity: 0});
  tw(ops, `${id}-chrome`, c.chromeAt, 0.35, 'power2.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-chrome`, rt(c.releaseAt - 0.25), 0.25, 'power1.in', {opacity: 1}, {opacity: 0});
  set(ops, `${id}-bar`, start, {scaleX: 0.02});
  tw(ops, `${id}-bar`, c.chromeAt, Math.max(0.1, rt(c.releaseAt - c.chromeAt)), 'none', {scaleX: 0.02}, {scaleX: 1});
}

// ---------------------------------------------------------------------------
// pull-back (front): the recording shrinks into an app window; real steps tick
// off beside it and a progress bar counts to 100%.

function resolvePullBack(params, ctx) {
  const b = createFootageBase('pull-back', params, ctx, {allowed: ['title', 'steps', 'label', 'scale', 'at', 'release'], required: ['steps'], hidesCaptions: true, minDuration: CATALOG_E_TIMING['pull-back'].minDuration});
  const {check, u, canvas, safe, colors, theme, end, duration, portrait} = b;
  const p = b.params;
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 32);
  check.arr(p.steps, 'params.steps', 1, 4);
  const steps = p.steps.map((step, i) => check.str(step, `params.steps[${i}]`, 28));
  const label = p.label === undefined ? 'Rendering' : check.str(p.label, 'params.label', 20);
  const scaleIn = p.scale === undefined ? null : check.num(p.scale, 'params.scale', 0.3, 0.75);
  const release = p.release === undefined ? 0.6 : check.num(p.release, 'params.release', 0.3, 1.2);
  const springAt = b.timeOf('pull', p.at, 'params.at', 0, {min: 0, max: duration - release - CATALOG_E_TIMING['pull-back'].work});
  const releaseAt = rt(end - release);
  const bar = r2(u(56));
  const stepSize = r2(Math.max(b.min.key, u(44))), rowH = r2(stepSize * 1.6);
  const progressH = r2(u(14)), pctSize = r2(Math.max(b.min.key, u(56)));
  const panelH = r2(steps.length * rowH + u(24) + progressH + u(16) + pctSize * 1.1);
  // Portrait: window at the top, the panel under it, the window as large as
  // the safe zone allows (or params.scale). Landscape: window left, panel right.
  const fitScale = portrait ? (safe.height - bar - u(36) - panelH) / canvas.height : (safe.height - bar) / canvas.height;
  const scale = scaleIn ?? Math.floor(Math.min(portrait ? 0.6 : 0.55, fitScale) * 100) / 100;
  if (scale < 0.3 - 1e-6) check.fail('params.steps', `leave room for a window only ${Math.round(scale * 100)}% of the frame; use fewer steps`);
  const winW = r2(canvas.width * scale), winH = r2(canvas.height * scale);
  const target = portrait
    ? {x: r2((canvas.width - winW) / 2), y: r2(safe.y + bar), width: winW, height: winH}
    : {x: r2(safe.x), y: r2(safe.y + bar + Math.max(0, (safe.height - bar - winH) / 2)), width: winW, height: winH};
  const panel = portrait
    ? {x: target.x, y: r2(target.y + winH + u(36)), width: winW, height: 0}
    : {x: r2(target.x + winW + u(48)), y: target.y, width: r2(safe.x + safe.width - target.x - winW - u(48)), height: winH};
  if (portrait) panel.height = panelH;
  if (panel.height < panelH - 1e-6 || panel.y + panelH > safe.y + safe.height + 1e-6) check.fail('params.steps', `need ${Math.round(panelH)} px under the window and the safe zone leaves ${Math.round(Math.max(0, (portrait ? safe.y + safe.height - panel.y : panel.height)))} px; use fewer steps or a smaller params.scale`);
  for (const [i, step] of steps.entries()) if (textWidth(step, stepSize, 'body') > panel.width - u(70)) check.fail(`params.steps[${i}]`, 'is too long for the panel; shorten it');
  const samples = framedCamera(b, target, {start: springAt, release: releaseAt});
  const settleAt = rt(springAt + 0.6);
  const doneAt = rt(releaseAt - 0.35);
  const tick = steps.length > 1 ? (doneAt - settleAt - 0.2) / steps.length : (doneAt - settleAt - 0.2);
  if (tick < 0.3 - 1e-6) check.fail('params.steps', `leave ${r2(tick)} s per step; lengthen the scene or use fewer steps`);
  const stepTimes = steps.map((_, i) => rt(settleAt + 0.2 + tick * (i + 1) - 0.05));
  const panelInk = colors.paper, muted = theme.muted, ok = colors.primary;
  b.requireContrast('steps/panel', panelInk, colors.bg, 'params.steps on the panel');
  b.events.push({id: `${b.id}-pull`, name: 'pull', time: springAt, endTime: settleAt, role: 'emphasis', cue: 'whoosh'});
  steps.forEach((_, i) => b.events.push({id: `${b.id}-step-${i}`, name: `step-${i}`, time: stepTimes[i], endTime: rt(stepTimes[i] + 0.3), role: 'beat', cue: 'tick'}));
  b.events.push({id: `${b.id}-done`, name: 'done', time: doneAt, endTime: rt(doneAt + 0.3), role: 'payoff', cue: 'success'});
  b.model.camera = {target: 'base', scale, punchAt: springAt, releaseAt, samples, frame: true};
  const crop = {x: 0, y: 0, width: canvas.width, height: canvas.height};
  const content = {title, steps, label, scale, release, springAt, settleAt, doneAt, releaseAt, stepTimes, crop, window: target, panel: {...panel, height: panelH}, bar,
    backdrop: colors.bg, frameColor: theme.border, radius: r2(u(22) / scale), stepSize, rowH, progressH, pctSize, panelInk, muted, ok, samples};
  const rect = {x: Math.min(target.x, panel.x), y: r2(target.y - bar), width: r2(Math.max(target.x + target.width, panel.x + panel.width) - Math.min(target.x, panel.x)), height: r2(Math.max(target.y + target.height, panel.y + panelH) - target.y + bar)};
  return b.finish(content, {rect, role: 'text', minTextPx: stepSize,
    motion: {enterEnd: settleAt, exitStart: releaseAt, exitTo: {opacity: 1}}});
}

function pullBackView(model) {
  const {id, fonts, canvas} = model;
  const c = model.content, Wn = c.window, P = c.panel, u = model.unit;
  const kids = [holeNode(id, c.crop, canvas, {color: c.backdrop, radius: c.radius})];
  const chrome = [
    el('div', `${id}-titlebar`, abs(Wn.x, Wn.y - c.bar, Wn.width, c.bar, {boxSizing: 'border-box', borderRadius: `${14 * u}px ${14 * u}px 0 0`, background: mixColor(c.panelInk, c.backdrop, 0.12), display: 'flex', alignItems: 'center', padding: `0 ${18 * u}px`, gap: 10 * u}), [
      ...['#ff5f57', '#febc2e', '#28c840'].map(color => el('div', null, {width: 16 * u, height: 16 * u, borderRadius: '50%', background: color, flex: 'none'})),
      ...(c.title ? [el('div', null, {marginLeft: 14 * u, whiteSpace: 'nowrap', fontFamily: fonts.meta, fontSize: Math.max(c.stepSize * 0.7, 26 * u), color: c.muted}, [c.title])] : [])
    ]),
    el('div', `${id}-border`, abs(Wn.x, Wn.y, Wn.width, Wn.height, {boxSizing: 'border-box', border: `${3 * u}px solid ${c.frameColor}`, borderRadius: `0 0 ${14 * u}px ${14 * u}px`}))
  ];
  const rows = c.steps.map((step, i) => el('div', `${id}-row-${i}`, abs(P.x, P.y + i * c.rowH, P.width, c.rowH, {display: 'flex', alignItems: 'center', gap: 18 * u, opacity: 0.45}), [
    el('div', `${id}-check-${i}`, {width: c.stepSize, height: c.stepSize, borderRadius: '50%', boxSizing: 'border-box', border: `${3 * u}px solid ${c.muted}`, background: 'transparent', flex: 'none'}),
    el('div', null, {whiteSpace: 'nowrap', fontFamily: fonts.body, fontWeight: 600, fontSize: c.stepSize, color: c.panelInk}, [step])
  ]));
  const barY = P.y + c.steps.length * c.rowH + 24 * u;
  const meter = [
    el('div', `${id}-track`, abs(P.x, barY, P.width, c.progressH, {borderRadius: c.progressH, background: mixColor(c.panelInk, c.backdrop, 0.16)})),
    el('div', `${id}-fill`, abs(P.x, barY, P.width, c.progressH, {borderRadius: c.progressH, background: c.ok, transformOrigin: '0 50%', transform: transformString({scaleX: 0})})),
    el('div', `${id}-label`, abs(P.x, barY + c.progressH + 16 * u, undefined, undefined, {whiteSpace: 'nowrap', fontFamily: fonts.meta, fontSize: Math.max(c.stepSize * 0.7, 26 * u), color: c.muted, letterSpacing: '0.08em'}), [c.label.toUpperCase()]),
    el('div', `${id}-pct`, abs(P.x + P.width - c.pctSize * 3, barY + c.progressH + 6 * u, c.pctSize * 3, undefined, {textAlign: 'right', whiteSpace: 'nowrap', fontFamily: fonts.display, fontSize: c.pctSize, lineHeight: '1.1', color: c.panelInk}), ['0%'])
  ];
  const front = el('div', `${id}-front`, abs(0, 0, canvas.width, canvas.height, {overflow: 'hidden'}), [...kids, el('div', `${id}-chrome`, abs(0, 0, canvas.width, canvas.height, {opacity: 0}), [...chrome, ...rows, ...meter])]);
  return {front};
}

function pullBackTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  holeOps(ops, id, c.samples, {start, fadeIn: 0.3, release: c.releaseAt, releaseDuration: c.release});
  set(ops, `${id}-chrome`, start, {opacity: 0});
  tw(ops, `${id}-chrome`, rt(c.settleAt - 0.2), 0.35, 'power2.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-chrome`, c.releaseAt, Math.min(0.3, c.release), 'power1.in', {opacity: 1}, {opacity: 0});
  c.stepTimes.forEach((time, i) => {
    set(ops, `${id}-row-${i}`, start, {opacity: 0.45});
    tw(ops, `${id}-row-${i}`, time, 0.25, 'power2.out', {opacity: 0.45}, {opacity: 1});
  });
  set(ops, `${id}-fill`, start, {scaleX: 0});
  tw(ops, `${id}-fill`, c.settleAt, rt(c.doneAt - c.settleAt), 'power1.inOut', {scaleX: 0}, {scaleX: 1});
  const frames = Math.max(1, Math.round((c.doneAt - c.settleAt) * model.fps));
  for (let f = 0; f <= frames; f++) {
    const p = f / frames;
    const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    set(ops, `${id}-pct`, rt(c.settleAt + f / model.fps), {text: `${Math.round(eased * 100)}%`});
  }
  set(ops, `${id}-pct`, start, {text: '0%'});
}

// ---------------------------------------------------------------------------
// backdrop-swap (behind): the room gives way to a backdrop; the presenter
// glides down and smaller in front of it.

function resolveBackdropSwap(params, ctx) {
  const b = createFootageBase('backdrop-swap', params, ctx, {allowed: ['backdrop', 'title', 'scale', 'at', 'release'], minDuration: CATALOG_E_TIMING['backdrop-swap'].minDuration});
  const {check, u, canvas, safe, colors, end, duration, portrait} = b;
  const p = b.params;
  const backdrop = p.backdrop === undefined ? null : media(check, p.backdrop, 'params.backdrop');
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 32);
  const scale = p.scale === undefined ? 0.78 : check.num(p.scale, 'params.scale', 0.6, 0.95);
  const release = p.release === undefined ? 0.5 : check.num(p.release, 'params.release', 0.3, 1);
  const swapAt = b.timeOf('swap', p.at, 'params.at', 0, {min: 0, max: duration - release - CATALOG_E_TIMING['backdrop-swap'].hold});
  const releaseAt = rt(end - release);
  const head = headRect(ctx, canvas, portrait);
  const body = ctx.subject?.body ?? {x: head.x - head.width, y: head.y, width: head.width * 3, height: canvas.height - head.y};
  // The presenter shrinks about the canvas centre, then moves so their
  // centre line is mid-frame and the frame's bottom edge stays put.
  const personX = body.x + body.width / 2;
  const fadeIn = 0.35, moveAt = rt(swapAt + 0.15);
  const settled = {x: r2(-scale * (personX - canvas.width / 2)), y: r2((canvas.height / 2) * (1 - scale))};
  const subjectSamples = frameSamples(b, t => {
    const q = springIn(t, {start: moveAt, release: releaseAt, fps: b.fps});
    return {scale: Math.round((1 + (scale - 1) * q) * 1e5) / 1e5, x: r2(settled.x * q) || 0, y: r2(settled.y * q) || 0};
  });
  let titleBlock = null;
  if (title) {
    const fit = fitText(check, 'params.title', title, {family: 'display', width: safe.width * 0.9, preferred: u(portrait ? 120 : 96), min: b.min.key, maxLines: 2});
    const headTop = canvas.height / 2 + (head.y - canvas.height / 2) * scale + settled.y;
    const height = r2(fit.lines * fit.size * 1.05);
    const y = r2(Math.max(safe.y, Math.min(headTop - height + fit.size * 0.35, safe.y + u(40))));
    titleBlock = {text: title, size: fit.size, lines: fit.lines, rect: {x: r2(safe.x + safe.width * 0.05), y, width: r2(safe.width * 0.9), height}};
    b.requireContrast('title/backdrop', colors.paper, colors.bg, 'params.title on the backdrop');
  }
  b.events.push({id: `${b.id}-swap`, name: 'swap', time: swapAt, endTime: rt(swapAt + fadeIn), role: 'emphasis', cue: 'whoosh'});
  b.events.push({id: `${b.id}-release`, name: 'release', time: releaseAt, endTime: end, role: 'release'});
  b.model.layer = 'behind';
  b.model.subjectCamera = {samples: subjectSamples};
  const gradient = `radial-gradient(120% 90% at 50% 20%, ${mixColor(colors.primary, colors.bg, 0.35)} 0%, ${colors.bg} 70%)`;
  const content = {backdrop, gradient, title: titleBlock, scale, release, swapAt, moveAt, fadeIn, releaseAt, ink: colors.paper, shadow: `0 ${u(8)}px ${u(30)}px #00000080`};
  return b.finish(content, {rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, role: 'decor', minTextPx: titleBlock?.size ?? null,
    motion: {enterEnd: rt(moveAt + 0.6), exitStart: releaseAt, exitTo: {opacity: 1}}});
}

function backdropSwapView(model) {
  const {id, fonts, canvas} = model;
  const c = model.content;
  const kids = [el('div', `${id}-plate`, abs(0, 0, canvas.width, canvas.height, {background: c.gradient}))];
  if (c.title) {
    const R = c.title.rect;
    kids.push(el('div', `${id}-title`, abs(R.x, R.y, R.width, R.height, {textAlign: 'center', fontFamily: fonts.display, fontSize: c.title.size, lineHeight: '1.05', color: c.ink, textShadow: c.shadow, opacity: 0}), [c.title.text]));
  }
  const behind = el('div', `${id}-backdrop`, abs(0, 0, canvas.width, canvas.height, {opacity: 0}), kids);
  const view = {behind};
  if (c.backdrop) view.media = mediaNode(id, {x: 0, y: 0, width: canvas.width, height: canvas.height}, c.backdrop, {origin: {x: canvas.width / 2, y: canvas.height / 2}});
  if (c.backdrop && c.title) {
    // The title rides above the media, so it moves to the overlay.
    view.behind = el('div', `${id}-backdrop`, abs(0, 0, canvas.width, canvas.height, {opacity: 0}), [kids[0]]);
    view.overlay = el('div', `${id}-overlay`, abs(0, 0, canvas.width, canvas.height, {pointerEvents: 'none'}), [kids[1]]);
  }
  return view;
}

function backdropSwapTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  for (const target of [`${id}-backdrop`, ...(c.backdrop ? [`${id}-media`] : [])]) {
    set(ops, target, start, {opacity: 0});
    tw(ops, target, c.swapAt, c.fadeIn, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, target, rt(c.releaseAt + c.release * 0.5), rt(c.release * 0.5), 'power1.in', {opacity: 1}, {opacity: 0});
  }
  if (c.title) {
    set(ops, `${id}-title`, start, {opacity: 0, y: 30 * model.unit});
    tw(ops, `${id}-title`, rt(c.moveAt + 0.3), 0.5, 'power3.out', {opacity: 0, y: 30 * model.unit}, {opacity: 1, y: 0});
    tw(ops, `${id}-title`, c.releaseAt, Math.min(0.25, c.release), 'power1.in', {opacity: 1, y: 0}, {opacity: 0, y: 0});
  }
}

// ---------------------------------------------------------------------------
// app-stage (behind): the product UI fills the top of the frame; the
// presenter's head rises over its bottom edge.

function resolveAppStage(params, ctx) {
  const b = createFootageBase('app-stage', params, ctx, {allowed: ['media', 'title', 'at'], required: ['media'], minDuration: CATALOG_E_TIMING['app-stage'].minDuration});
  const {check, u, canvas, safe, colors, end, duration, portrait} = b;
  const p = b.params;
  const m = media(check, p.media, 'params.media');
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 32);
  const t0 = b.timeOf('stage', p.at, 'params.at', 0, {min: 0, max: duration - CATALOG_E_TIMING['app-stage'].leadOut});
  const head = headRect(ctx, canvas, portrait);
  const bar = r2(u(52));
  // The window spans the safe width from the top of the safe zone to 70% of
  // the way down the head, so the head covers its lower edge.
  const top = safe.y;
  const bottom = r2(head.y + head.height * 0.7);
  const height = r2(bottom - top);
  if (height < u(420) - 1e-6) check.fail('params', `needs headroom: the presenter's head at ${Math.round(head.y)} px leaves ${Math.max(0, Math.round(height))} px for the app window, and it needs ${Math.round(u(420))} px. Use it on a medium or wide shot, or use phone-stage`);
  const win = {x: safe.x, y: top, width: safe.width, height};
  const screen = {x: win.x, y: r2(win.y + bar), width: win.width, height: r2(win.height - bar)};
  const settleAt = rt(t0 + 0.6);
  const exitStart = rt(end - 0.4);
  b.events.push({id: `${b.id}-stage`, name: 'stage', time: t0, endTime: settleAt, role: 'emphasis', cue: 'whoosh'});
  b.model.layer = 'behind';
  const slide = r2(-(win.y + win.height + u(40)));
  const origin = {x: r2(win.x + win.width / 2), y: r2(win.y + win.height / 2)};
  const content = {media: m, title, window: win, screen, bar, slide, origin, t0, settleAt, exitStart, chrome: mixColor(colors.paper, colors.bg, 0.92), ink: colors.bg, muted: mixColor(colors.bg, colors.paper, 0.55),
    radius: r2(u(24)), shadow: `0 ${u(24)}px ${u(60)}px #00000080`};
  return b.finish(content, {rect: win, role: 'media', minTextPx: null,
    motion: {enterEnd: settleAt, exitStart, exitTo: {opacity: 1}}});
}

function appStageView(model) {
  const {id, fonts, canvas} = model;
  const c = model.content, Wn = c.window, u = model.unit;
  const panel = el('div', `${id}-panel`, abs(Wn.x, Wn.y, Wn.width, Wn.height, {boxSizing: 'border-box', borderRadius: c.radius, background: c.chrome, boxShadow: c.shadow, overflow: 'hidden',
    transformOrigin: `${r2(c.origin.x - Wn.x)}px ${r2(c.origin.y - Wn.y)}px`, transform: transformString({y: c.slide})}), [
    el('div', null, abs(0, 0, Wn.width, c.bar, {display: 'flex', alignItems: 'center', gap: 10 * u, padding: `0 ${20 * u}px`, boxSizing: 'border-box'}), [
      ...['#ff5f57', '#febc2e', '#28c840'].map(color => el('div', null, {width: 16 * u, height: 16 * u, borderRadius: '50%', background: color, flex: 'none'})),
      ...(c.title ? [el('div', null, {marginLeft: 14 * u, whiteSpace: 'nowrap', fontFamily: fonts.body, fontWeight: 600, fontSize: Math.max(28 * u, 26), color: c.muted}, [c.title])] : [])
    ])
  ]);
  const behind = el('div', `${id}-stage`, abs(0, 0, canvas.width, canvas.height), [panel]);
  return {behind, media: mediaNode(id, c.screen, c.media, {origin: c.origin})};
}

function appStageTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  set(ops, `${id}-panel`, start, {y: c.slide});
  tw(ops, `${id}-panel`, c.t0, 0.6, 'power3.out', {y: c.slide}, {y: 0});
  tw(ops, `${id}-panel`, c.exitStart, 0.4, 'power2.in', {y: 0}, {y: c.slide});
  mirror(ops, `${id}-panel`, `${id}-media`);
  set(ops, `${id}-media`, start, {opacity: 1});
}

// ---------------------------------------------------------------------------
// phone-stage (front): a phone beside the presenter plays a real recording
// (a demo-autopilot flow or any screen capture) while the room pans away.

function resolvePhoneStage(params, ctx) {
  const b = createFootageBase('phone-stage', params, ctx, {allowed: ['media', 'side', 'at', 'pan'], required: ['media'], minDuration: CATALOG_E_TIMING['phone-stage'].minDuration});
  const {check, u, canvas, safe, end, duration, portrait} = b;
  const p = b.params;
  const m = media(check, p.media, 'params.media');
  const sideIn = p.side === undefined ? 'auto' : check.oneOf(p.side, 'params.side', ['auto', 'left', 'right']);
  const pan = p.pan === undefined ? true : check.bool(p.pan, 'params.pan');
  const t0 = b.timeOf('phone', p.at, 'params.at', 0, {min: 0, max: duration - CATALOG_E_TIMING['phone-stage'].leadOut});
  const head = headRect(ctx, canvas, portrait);
  const headCx = head.x + head.width / 2;
  const side = sideIn === 'auto' ? (headCx > canvas.width / 2 ? 'left' : 'right') : sideIn;
  const gap = u(36);
  const room = side === 'left' ? head.x - gap - safe.x : safe.x + safe.width - (head.x + head.width + gap);
  const panShift = pan ? u(100) : 0;
  const width = r2(Math.min(portrait ? u(400) : u(330), room + panShift));
  if (width < u(240) - 1e-6) check.fail('params.side', `leaves ${Math.max(0, Math.round(room + panShift))} px beside the presenter's head and a phone needs ${Math.round(u(240))} px; pick the other side or use app-stage`);
  const height = r2(width * 2.05);
  const x = r2(side === 'left' ? Math.max(safe.x, head.x - gap + panShift - width) : Math.min(safe.x + safe.width - width, head.x + head.width + gap - panShift));
  const yCentre = Math.min(Math.max(head.y + head.height * 0.8, safe.y + height / 2), safe.y + safe.height - height / 2);
  const y = r2(yCentre - height / 2);
  if (y < safe.y - 1e-6 || height > safe.height + 1e-6) check.fail('params', 'the phone does not fit the safe zone at this framing');
  const phone = {x, y, width, height};
  const bezel = r2(width * 0.045);
  const screen = {x: r2(x + bezel), y: r2(y + bezel), width: r2(width - bezel * 2), height: r2(height - bezel * 2)};
  const settleAt = rt(t0 + 0.6);
  const exitStart = rt(end - 0.4);
  const origin = {x: r2(x + width / 2), y: r2(y + height / 2)};
  const enter = r2((side === 'left' ? -1 : 1) * (width + u(120)));
  const tilt = side === 'left' ? -4 : 4;
  // The room pans away from the phone (a base camera; scale keeps it covered).
  if (pan) {
    const s = 1.2, shift = (side === 'left' ? 1 : -1) * Math.min(panShift, (s - 1) * canvas.width / 2 - 2);
    b.model.camera = {target: 'base', scale: s, punchAt: t0, releaseAt: exitStart, samples: frameSamples(b, t => {
      const q = springIn(t, {start: t0, release: exitStart, fps: b.fps});
      return {scale: Math.round((1 + (s - 1) * q) * 1e5) / 1e5, x: r2(shift * q) || 0, y: 0};
    })};
  }
  b.events.push({id: `${b.id}-phone`, name: 'phone', time: t0, endTime: settleAt, role: 'emphasis', cue: 'whoosh'});
  const content = {media: m, side, phone, screen, bezel, origin, enter, tilt, t0, settleAt, exitStart, float: r2(u(10)), body: '#1c1c1f', rim: '#5b5b60', island: r2(width * 0.3),
    radius: r2(width * 0.16), screenRadius: r2(width * 0.12), shadow: `0 ${u(30)}px ${u(70)}px #000000a6`};
  return b.finish(content, {rect: phone, role: 'media', minTextPx: null,
    motion: {enterEnd: settleAt, exitStart, exitTo: {opacity: 1}}});
}

function phoneStageView(model) {
  const {id, canvas} = model;
  const c = model.content, P = c.phone, S = c.screen;
  const origin = `${r2(c.origin.x - P.x)}px ${r2(c.origin.y - P.y)}px`;
  const front = el('div', `${id}-stage`, abs(0, 0, canvas.width, canvas.height), [
    el('div', `${id}-phone`, abs(P.x, P.y, P.width, P.height, {boxSizing: 'border-box', borderRadius: c.radius, background: c.body, border: `${r2(c.bezel * 0.25)}px solid ${c.rim}`, boxShadow: c.shadow,
      transformOrigin: origin, transform: transformString({x: c.enter, rotation: c.tilt})}))
  ]);
  const overlay = el('div', `${id}-overlay`, abs(0, 0, canvas.width, canvas.height, {pointerEvents: 'none'}), [
    el('div', `${id}-island`, abs(c.origin.x - c.island / 2, S.y + c.bezel * 0.8, c.island, r2(c.island * 0.3), {borderRadius: c.island, background: '#000000',
      transformOrigin: `${r2(c.island / 2)}px ${r2(c.origin.y - S.y - c.bezel * 0.8)}px`, transform: transformString({x: c.enter, rotation: c.tilt})}))
  ]);
  return {front, media: mediaNode(id, S, c.media, {origin: c.origin, radius: c.screenRadius}), overlay};
}

function phoneStageTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  const target = `${id}-phone`;
  set(ops, target, start, {x: c.enter, y: 0, rotation: c.tilt});
  tw(ops, target, c.t0, 0.6, 'back.out(1.2)', {x: c.enter, rotation: c.tilt * 2}, {x: 0, rotation: c.tilt});
  // A slow float while it holds.
  let t = c.settleAt, up = true;
  while (t + 1.4 < c.exitStart) {
    tw(ops, target, rt(t), 1.4, 'sine.inOut', {y: up ? 0 : -c.float}, {y: up ? -c.float : 0});
    t += 1.4;
    up = !up;
  }
  tw(ops, target, c.exitStart, 0.4, 'power2.in', {x: 0}, {x: c.enter});
  mirror(ops, target, `${id}-media`);
  mirror(ops, target, `${id}-island`);
  set(ops, `${id}-media`, start, {opacity: 1});
}

// ---------------------------------------------------------------------------
// Registry

export const CATALOG_E_TIMING = Object.freeze({
  'feed-frame': Object.freeze({minDuration: 2, hold: 1}),
  'pull-back': Object.freeze({minDuration: 3, work: 1.6}),
  'backdrop-swap': Object.freeze({minDuration: 2, hold: 0.8}),
  'app-stage': Object.freeze({minDuration: 2, leadOut: 1.2}),
  'phone-stage': Object.freeze({minDuration: 2, leadOut: 1.2})
});
const TIMING_E = {
  'feed-frame': {minDuration: 2, leadIn: 0, leadOut: null, gaps: [], rules: ['at ≤ scene − release − 1 s (release 0.3–1 s, default 0.5)']},
  'pull-back': {minDuration: 3, leadIn: 0, leadOut: null, gaps: [], rules: ['at ≤ scene − release − 1.6 s (release 0.3–1.2 s, default 0.6); at least 0.3 s per step']},
  'backdrop-swap': {minDuration: 2, leadIn: 0, leadOut: null, gaps: [], rules: ['at ≤ scene − release − 0.8 s (release 0.3–1 s, default 0.5)']},
  'app-stage': {minDuration: 2, leadIn: 0, leadOut: 1.2, gaps: [], rules: []},
  'phone-stage': {minDuration: 2, leadIn: 0, leadOut: 1.2, gaps: [], rules: []}
};

const mediaParam = '{src: assets/ image or video (a demo-autopilot flow: assets/demo/<flow>.mp4), sourceStart?: seconds (video), fit?: cover|contain}';
const DEFINITIONS = [
  {id: 'feed-frame', describe: 'Footage-led: the recording springs into a portrait feed window on a dark backdrop and the presenter breaks out over its top and sides, with generic feed chrome (icons, the user\'s handle, a caption, a progress bar). For "this exact video", posting or going viral. Counts appear only when given. Hides captions.',
    params: {handle: '@handle ≤ 24 (optional; shows the avatar row)', caption: 'one line ≤ 60 (optional)', counts: '{likes?, comments?, shares?} strings ≤ 8 the user supplied (optional; never invent them)', follow: 'boolean (default true with a handle)', scale: 'window size 0.55–0.85 of the frame', release: 'seconds to spring back (0.3–1)', at},
    events: ['frame', 'chrome', 'release'], needs: ['subject'], layer: 'split', aspects: ['9:16'], mood: ['bold', 'launch', 'playful'],
    resolve: resolveFeedFrame, view: feedFrameView, timeline: feedFrameTimeline},
  {id: 'pull-back', describe: 'Footage-led: the recording shrinks into an app window while real steps tick off beside it and a progress bar counts to 100%. For "and this video was made by…", a process finishing, or a product reveal. Hides captions.',
    params: {steps: '1–4 real steps ≤ 28 chars each (required)', title: 'window title ≤ 32 (e.g. a file or product name)', label: 'progress label ≤ 20 (default "Rendering")', scale: 'window size 0.4–0.75', release: 'seconds to spring back (0.3–1.2)', at},
    events: ['pull', 'step-<i>', 'done'], aspects: ['9:16', '16:9'], mood: ['launch', 'editorial'],
    resolve: resolvePullBack, view: pullBackView, timeline: pullBackTimeline},
  {id: 'backdrop-swap', describe: 'Footage-led, behind the presenter: the room dissolves into a backdrop (brand gradient, or a supplied product screenshot or video) and the presenter glides down in front of it; an optional title sits above their head. For the turn from the problem to the product.',
    params: {backdrop: `${mediaParam} (default: a brand gradient)`, title: '≤ 32 (optional)', scale: 'presenter size 0.6–0.95 (default 0.78)', release: 'seconds to glide back (0.3–1)', at},
    events: ['swap', 'release'], needs: ['subject'], layer: 'behind', aspects: ['9:16', '16:9'], mood: ['launch', 'premium', 'bold'],
    resolve: resolveBackdropSwap, view: backdropSwapView, timeline: backdropSwapTimeline},
  {id: 'app-stage', describe: 'Footage-led, behind the presenter: the product UI (a screenshot or recording) slides down to fill the top of the frame and the presenter\'s head rises over its bottom edge. Needs headroom; for showing the app while talking about it.',
    params: {media: `${mediaParam} (required)`, title: 'app or page title ≤ 32 (optional)', at},
    events: ['stage'], needs: ['subject'], layer: 'behind', aspects: ['9:16', '16:9'], mood: ['launch', 'editorial'],
    resolve: resolveAppStage, view: appStageView, timeline: appStageTimeline},
  {id: 'phone-stage', describe: 'Footage-led: a phone springs in beside the presenter\'s head and plays a real screen recording or screenshot (a demo-autopilot flow fits), floating gently while the room pans away from it. For showing the app on a phone while explaining it.',
    params: {media: `${mediaParam} (required)`, side: 'auto|left|right (default: the side with more room)', pan: 'boolean: pan the room away (default true)', at},
    events: ['phone'], aspects: ['9:16', '16:9'], mood: ['launch', 'playful'],
    resolve: resolvePhoneStage, view: phoneStageView, timeline: phoneStageTimeline}
];

export const MODULES = Object.fromEntries(DEFINITIONS.map(def => [def.id, {describe: def.describe, params: def.params, events: def.events, timing: TIMING_E[def.id], resolve: def.resolve,
  ...(def.needs ? {needs: def.needs} : {}), ...(def.layer ? {layer: def.layer} : {}), ...(def.aspects ? {aspects: def.aspects} : {}), ...(def.mood ? {mood: def.mood} : {})}]));
const BY_ID = Object.fromEntries(DEFINITIONS.map(def => [def.id, def]));

function definition(model) {
  const def = model && BY_ID[model.module];
  if (!def) throw new Error(`catalogue E: unknown module ${model?.module}`);
  return def;
}

/** {front, behind?, media?, overlay?}: the element trees each layer part draws, at scene start. */
export function catalogEView(model) {
  const view = definition(model).view(model);
  return {front: view.front ?? null, behind: view.behind ?? null, media: view.media ?? null, overlay: view.overlay ?? null};
}

/** Renderer-neutral animation ops for a catalogue E model (all parts, media included). */
export function catalogETimeline(model) {
  const ops = [];
  definition(model).timeline(model, ops);
  if (model.grammar) grammarTweens(ops, model.grammar, {roles: ['emphasis']});
  return ops;
}

