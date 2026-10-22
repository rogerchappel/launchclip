#!/usr/bin/env node
import {gsapText} from '../core/motion.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolveEditorialModule, EDITORIAL_KINDS, EDITORIAL_SYMBOLS, EDITORIAL_STYLE} from '../core/editorial-core.mjs';

// HyperFrames emitter for the editorial modules. Validation, defaults,
// geometry, timing, events and theme come from the renderer-neutral core
// (kit/core/editorial-core.mjs); this file only turns that resolved model into
// HTML, CSS and paused-GSAP timeline calls.
//
// Canonical copy: kit/hyperframes/editorial-ui-modules.mjs. The create-video
// skills ship generated copies (scripts/sync-skills.mjs) that import
// ./editorial-core.mjs instead.

const S = EDITORIAL_STYLE, C = S.color, R = S.radius, F = S.font, G = S.glass, SH = S.shadow, A = S.accentAlpha;
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const js = value => JSON.stringify(value).replace(/</g, '\\u003c');
const symbol = name => `<svg viewBox="${S.symbol.viewBox}" fill="none" stroke="currentColor" stroke-width="${S.symbol.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${EDITORIAL_SYMBOLS[name]}</svg>`;
const blur = `backdrop-filter:blur(${G.blur}px);-webkit-backdrop-filter:blur(${G.blur}px)`;
const windowBar = (label, dots) => `<div class="ui-bar">${dots.map(dot => `<span class="ui-dot" style="background:${dot}"></span>`).join('')}<span class="ui-bar-label">${escape(label)}</span></div>`;

function moduleMotion(target, model, origin) {
  const selector = js(target), m = model.motion;
  if (!m.supplied) return [`tl.fromTo(${selector}, {opacity:0,y:18}, {opacity:1,y:0,duration:${m.enterDuration},ease:'${m.enterEase}'}, ${m.enterStart});`, `tl.to(${selector}, {opacity:0,y:-8,duration:${m.exitDuration},ease:'${m.exitEase}'}, ${m.exitStart});`];
  // Root media and chrome share the chrome's top-left pivot, despite their
  // distinct root DOM boxes. The media box begins 48px below that pivot.
  const from = {...m.enterFrom, transformOrigin: origin};
  return [`tl.set(${selector}, ${js(from)}, ${m.enterStart});`, `tl.fromTo(${selector}, ${js(from)}, ${js({opacity: 1, x: 0, y: 0, scale: 1, duration: m.enterDuration, ease: m.enterEase, immediateRender: false})}, ${m.enterStart});`,
    `tl.to(${selector}, ${js({...m.exitTo, duration: m.exitDuration, ease: m.exitEase})}, ${m.exitStart});`];
}

/** CSS declarations for the density wrapper (shared with the Remotion shells). */
export function densityCss(density) {
  return `position:absolute;left:0;top:0;width:${density.layout.width}px;height:${density.layout.height}px;transform:scale(${density.scale});transform-origin:0 0`;
}

// Skill-local authoring helper, not a production API. The host owns its paused
// GSAP timeline and places these fragments directly inside its composition root.
export function buildEditorialModule(input) {
  return emitEditorialModule(resolveEditorialModule(input));
}

// Emitter for an already resolved model (resolveEditorialModule, or
// resolveModule from kit/core/modules.mjs, which adds brand defaults).
export function emitEditorialModule(model) {
  const {id, kind, rect, start, duration, accent, title, theme, track, content: c} = model;
  const {font, pad, statusWidth} = model.chrome;
  const selector = `#${id}`, glass = model.presentation === 'glass';
  const timed = `class="clip" data-start="${start}" data-duration="${duration}" data-track-index="${track}"`;
  const chromeTimed = timed.replace(`data-track-index="${track}"`, `data-track-index="${track + 1}" data-layout-allow-occlusion="true"`);
  const placement = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
  const motion = moduleMotion(selector, model, model.motion.transformOrigin);
  motion.push(`tl.set(${js(selector)}, {opacity:0}, ${model.end});`);
  let css = `#${id}{position:absolute;${placement};box-sizing:border-box;overflow:hidden;background:${C.surface};color:${C.foreground};border:1px solid ${C.border};border-radius:${R.panel}px;box-shadow:${SH.panel};font-family:${F.sans};font-size:${font}px;line-height:${S.size.lineHeight}}#${id} *{box-sizing:border-box}#${id} .ui-title{margin:0;padding:${pad}px;font-size:${font + 4}px;font-weight:700;line-height:${S.size.titleLineHeight}}#${id} .ui-row{display:flex;align-items:center;gap:${S.space.rowGap}px;padding:14px ${pad}px;border-top:1px solid ${C.divider}}#${id} .ui-label{flex:1;min-width:0;overflow-wrap:break-word}#${id} .ui-check{width:36px;height:36px;flex:none;border:2px solid ${C.checkBorder};border-radius:${R.check}px;display:grid;place-items:center}#${id} .ui-check svg{width:32px;height:32px;opacity:0}#${id} .ui-status{font-size:${font - 6}px;color:${C.status};width:${statusWidth}px;flex:none;text-align:right;position:relative}#${id} .ui-bar{position:absolute;top:0;left:0;right:0;height:${S.space.bar}px;display:flex;align-items:center;gap:10px;padding:0 16px;background:${C.bar};border-bottom:1px solid ${C.border}}#${id} .ui-dot{width:12px;height:12px;border-radius:50%}#${id} .ui-bar-label{margin-left:12px;font-size:${S.size.small}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#${id} .ui-content{padding:${pad}px}#${id} .ui-rail{position:relative;margin:20px ${pad}px 0;height:8px;background:${C.track};border-radius:${R.rail}px}#${id} .ui-fill{height:100%;background:${accent};transform-origin:left;border-radius:${R.rail}px}#${id} .ui-steps{display:flex;justify-content:space-between;padding:22px ${pad}px;gap:12px}#${id} .ui-step{flex:1;min-width:0;font-size:${Math.max(22, font - 4)}px;overflow-wrap:break-word;opacity:.65}#${id} .ui-body{padding:0 ${pad}px ${pad}px;margin:0;color:${C.muted};overflow-wrap:break-word}`;
  let body = '', media = '';
  if (model.surface === 'panel' && kind !== 'callout') css += `#${id}{background:${C.panel};border-color:${C.panelBorder};border-radius:${R.editorial}px;box-shadow:${SH.panelGlow} ${accent}${SH.panelGlowAlpha},${SH.drop}}`;
  if (glass) {
    // Opaque tint is the readability fallback when native video compositing
    // does not reproduce backdrop blur. Keep framed media itself sharp.
    css += kind === 'media-window' ? `#${id} .ui-bar{background:${G.barFill};${blur}}` : `#${id}{background:${G.fill};border-color:${G.border};${blur}}@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){#${id}{background:${G.supportedFill}}}`;
  }
  if (kind === 'media-window') {
    motion.push(`tl.set(${js(`#${id}-media`)}, {opacity:0}, ${model.end});`);
    const box = c.mediaRect;
    const style = `position:absolute;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;object-fit:contain;background:${C.media};border-radius:0 0 ${c.mediaRadius}px ${c.mediaRadius}px`;
    // Direct root child: HyperFrames controls the video clock. Chrome never
    // restarts the source or owns narration. Pattern follows the assembler's
    // root-media-window-bar/dot markup, not an external React UI library.
    media = c.media.kind === 'video' ? `<video id="${id}-media" ${timed} data-media-start="${c.media.sourceStart}" src="${escape(c.media.src)}" muted playsinline style="${style}"></video>` : `<img id="${id}-media" ${timed} src="${escape(c.media.src)}" alt="${escape(c.media.alt)}" style="${style}" />`;
    body = windowBar(c.bar.label, c.bar.dots);
    motion.push(...moduleMotion(`#${id}-media`, model, c.mediaTransformOrigin));
  } else {
    body = `<h2 class="ui-title">${escape(title)}</h2>`;
    if (kind === 'callout' && c.variant === 'plain') {
      body += `<p class="ui-body">${escape(c.body)}</p>`;
    } else if (kind === 'callout') {
      const markup = c.segments ? c.segments.map(segment => `<span class="${[segment.highlight ? 'ui-emphasis' : '', segment.underline ? 'ui-underlined' : ''].filter(Boolean).join(' ')}">${escape(segment.text)}${segment.underline ? `<span id="${id}-underline-${segment.index}" class="ui-underline" aria-hidden="true"></span>` : ''}</span>`).join('') : escape(c.body);
      const family = c.monospace ? F.mono : 'inherit', inset = c.inset;
      css += `#${id}{background:${C.panel};border-color:${C.panelBorder};border-radius:${R.editorial}px}#${id} .ui-callout-heading{display:flex;align-items:center;gap:12px;padding:${inset}px}#${id} .ui-title{padding:0;font-size:${font + 2}px;line-height:1.2;min-width:0;overflow-wrap:break-word;font-family:${family}}#${id} .ui-body{padding:0 ${inset}px ${inset}px;font-family:${family};line-height:1.3;color:${C.calloutBody}}#${id} .ui-emphasis{color:${accent};font-weight:700}#${id} .ui-underlined{position:relative;display:inline-block;white-space:nowrap}#${id} .ui-underline{position:absolute;left:0;right:0;bottom:-2px;height:2px;background:${accent};transform-origin:left center;display:block}#${id} .ui-symbol{width:${c.iconSize}px;height:${c.iconSize}px;flex:none;color:${C.foreground}}#${id} .ui-symbol svg{width:${c.iconSize}px;height:${c.iconSize}px;display:block}#${id} .ui-corner{position:absolute;width:18px;height:18px;pointer-events:none;border-color:${accent};border-style:solid;border-width:0;opacity:0}#${id} .ui-corner-tl{left:7px;top:7px;border-left-width:2px;border-top-width:2px}#${id} .ui-corner-tr{right:7px;top:7px;border-right-width:2px;border-top-width:2px}#${id} .ui-corner-bl{left:7px;bottom:7px;border-left-width:2px;border-bottom-width:2px}#${id} .ui-corner-br{right:7px;bottom:7px;border-right-width:2px;border-bottom-width:2px}`;
      // Font shorthand keeps the local monospace treatment intact through
      // the renderer's font-family normalization, as with code/date widgets.
      if (c.monospace) css += `#${id} .ui-title{font:700 ${font + 2}px/1.2 ${F.mono}}#${id} .ui-body{font:${font}px/1.3 ${F.mono}}`;
      body = `<div class="ui-callout-heading">${c.icon ? `<span id="${id}-symbol" class="ui-symbol" aria-hidden="true">${symbol(c.icon)}</span>` : ''}<h2 id="${id}-heading" class="ui-title">${escape(title)}</h2></div><p id="${id}-copy" class="ui-body">${markup}</p>`;
      motion.push(`tl.fromTo(${js(`#${id}-heading`)}, {opacity:0,y:6}, {opacity:1,y:0,duration:0.28,ease:'power3.out'}, ${c.time});`);
      for (const segment of c.segments ?? []) {
        if (!segment.underline) continue;
        motion.push(`tl.set(${js(`#${id}-underline-${segment.index}`)}, {scaleX:0}, ${start});`, `tl.to(${js(`#${id}-underline-${segment.index}`)}, {scaleX:1,duration:0.28,ease:'power3.out'}, ${segment.underline.time});`);
      }
      motion.push(`tl.fromTo(${js(`#${id}-copy`)}, {opacity:0,y:8}, {opacity:1,y:0,duration:0.3,ease:'power3.out'}, ${c.copyTime});`);
      if (c.icon) motion.push(`tl.fromTo(${js(`#${id}-symbol`)}, {opacity:0,scale:0.86,rotation:-6}, {opacity:1,scale:1,rotation:0,duration:0.34,ease:'power3.out'}, ${c.time});`);
      if (c.glow) {
        css += `#${id}{box-shadow:${SH.treatedGlow} ${accent}${SH.treatedGlowAlpha},${SH.drop}}#${id} .ui-accent-edge{position:absolute;inset:0;border:1px solid ${accent};border-radius:${R.editorial}px;opacity:0;pointer-events:none}`;
        body += `<div id="${id}-edge" class="ui-accent-edge" aria-hidden="true"></div>`;
        motion.push(`tl.fromTo(${js(`#${id}-edge`)}, {opacity:0}, {opacity:0.6,duration:0.4,ease:'power2.out'}, ${c.time});`);
      }
      if (c.corners.length) css += `#${id}{overflow:visible}#${id} .ui-corner-tl{left:-8px;top:-8px}#${id} .ui-corner-tr{right:-8px;top:-8px}#${id} .ui-corner-bl{left:-8px;bottom:-8px}#${id} .ui-corner-br{right:-8px;bottom:-8px}`;
      for (const {corner, time, from} of c.corners) {
        body += `<span id="${id}-corner-${corner}" class="ui-corner ui-corner-${corner}" aria-hidden="true"></span>`;
        motion.push(`tl.fromTo(${js(`#${id}-corner-${corner}`)}, {opacity:0,x:${from.x},y:${from.y}}, {opacity:1,x:0,y:0,duration:0.28,ease:'power3.out'}, ${time});`);
      }
    } else if (kind === 'excerpt-window') {
      const sweep = c.highlightMotion, focus = c.focus;
      const lines = c.lines.map(line => `<div class="ui-excerpt-line">${line.segments.map(segment => {
        if (segment.highlight && sweep) return `<span class="ui-excerpt-highlight ui-excerpt-sweep"><span class="ui-highlight-fill" aria-hidden="true"></span><span class="ui-highlight-text">${escape(segment.text)}</span></span>`;
        return `<span${segment.highlight ? ' class="ui-excerpt-highlight"' : ''}>${escape(segment.text)}</span>`;
      }).join('')}</div>`).join('');
      css += `#${id} .ui-excerpt-note{position:absolute;top:${c.noteRect.y}px;left:0;right:0;padding:16px 24px 0;font-size:${S.size.small}px;line-height:1.3;color:${C.muted}}#${id} .ui-excerpt-viewport{position:absolute;left:${c.viewport.x}px;right:24px;top:${c.viewport.y}px;bottom:24px;overflow:hidden}#${id} .ui-excerpt-content{width:${c.textWidth}px;height:${c.textHeight}px;font:${c.textFont}px/1.5 ${F.mono};transform-origin:top left}#${id} .ui-excerpt-line{height:${c.lineHeight}px;white-space:pre}#${id} .ui-excerpt-highlight{background:transparent;border-radius:${R.highlight}px}`;
      body = `${windowBar(c.bar.label, c.bar.dots)}<div class="ui-excerpt-note">${escape(c.note)}</div><div class="ui-excerpt-viewport"><div id="${id}-excerpt" class="ui-excerpt-content">${lines}</div></div>`;
      if (sweep) {
        css += `#${id} .ui-excerpt-sweep{position:relative;display:inline-block}#${id} .ui-highlight-fill{position:absolute;inset:0;background:${c.highlight.color};border-radius:${R.highlight}px;transform-origin:left center}#${id} .ui-highlight-text{position:relative}`;
        motion.push(`tl.set(${js(`#${id} .ui-highlight-fill`)}, {scaleX:0}, ${start});`, `tl.to(${js(`#${id} .ui-highlight-fill`)}, {scaleX:1,duration:${c.highlight.duration},ease:'power2.inOut'}, ${c.highlight.time});`);
      }
      motion.push(`tl.set(${js(`#${id}-excerpt`)}, {x:0,y:0,scale:1}, ${start});`, `tl.to(${js(`#${id}-excerpt`)}, {x:${focus.x},y:${focus.y},scale:${focus.scale},duration:${focus.duration},ease:'power3.inOut'}, ${focus.time});`);
      if (!sweep) motion.push(`tl.to(${js(`#${id} .ui-excerpt-highlight`)}, {backgroundColor:${js(c.highlight.color)},duration:${c.highlight.duration},ease:'power2.out'}, ${c.highlight.time});`);
    } else if (kind === 'date-card') {
      css += `#${id} .ui-month{height:${c.bandHeight}px;background:${accent};color:${C.monthInk};display:grid;place-items:center;font:700 22px/1.2 ${F.mono};letter-spacing:2px}#${id} .ui-day{font:800 ${S.size.day}px/1.1 ${F.display};text-align:center;height:${c.dayHeight}px;padding-top:8px}#${id} .ui-title{text-align:center;padding:12px 20px}#${id} .ui-date-note{text-align:center;font:22px/1.3 ${F.mono};margin:0;padding:0 20px 12px;color:${C.muted}}`;
      body = `<div class="ui-month">${c.monthLabel}</div><div id="${id}-day" class="ui-day">${c.day}</div><h2 class="ui-title">${escape(title)}</h2>${c.caption ? `<p class="ui-date-note">${escape(c.caption)}</p>` : ''}`;
      motion.push(`tl.fromTo(${js(`#${id}-day`)}, {opacity:0,y:14,scale:0.94}, {opacity:1,y:0,scale:1,duration:0.32,ease:'power3.out'}, ${c.time});`);
    } else if (kind === 'status-rack') {
      css += `#${id} .ui-rack-note{font-size:${S.size.small}px;line-height:1.3;color:${C.muted};margin:0;padding:0 24px 20px}#${id} .ui-rack{display:grid;gap:8px;padding:0 24px 24px}#${id} .ui-rack-row{height:44px;border:1px solid ${C.rackBorder};border-radius:${R.rack}px;background:${C.panel};display:flex;align-items:center;gap:12px;padding:0 12px;font:22px/1.25 ${F.mono};opacity:0}#${id} .ui-rack-marker{width:22px;height:5px;background:${C.rackMarker};flex:none;border-radius:${R.marker}px}#${id} .ui-rack-label{flex:1;min-width:0}#${id} .ui-lights{display:flex;gap:8px}#${id} .ui-light{width:18px;height:18px;background:${C.light};border-radius:50%;flex:none}`;
      body += `<p class="ui-rack-note">${escape(c.note)}</p><div class="ui-rack">`;
      for (const row of c.rows) {
        const i = row.index;
        body += `<div id="${id}-rack-${i}" class="ui-rack-row"><span class="ui-rack-marker" aria-hidden="true"></span><span class="ui-rack-label">${escape(row.label)}</span><span class="ui-lights" aria-label="supplied status indicators">${[0, 1, 2].map(j => `<span id="${id}-light-${i}-${j}" class="ui-light"></span>`).join('')}</span></div>`;
        for (const state of row.states) {
          if (state.index === 0) motion.push(`tl.fromTo(${js(`#${id}-rack-${i}`)}, {opacity:0,x:-10}, {opacity:1,x:0,duration:0.22,ease:'power3.out'}, ${state.time});`);
          for (const change of state.changes) motion.push(`tl.to(${js(`#${id}-light-${i}-${change.light}`)}, {backgroundColor:${js(change.color)},duration:0.18,ease:'power2.out'}, ${state.time});`);
        }
      }
      body += '</div>';
    } else if (kind === 'code-snippet') {
      css += `#${id} .ui-code-language{font:22px/1.3 ${F.mono};margin:0;padding:0 24px 16px;color:${C.codeLanguage}}#${id} .ui-code{margin:0;padding:0 24px 24px;font:${c.codeFont}px/1.5 ${F.mono}}#${id} .ui-code-line{display:block;height:${c.lineHeight}px;white-space:pre;opacity:0}#${id} .ui-token-keyword{color:${C.token.keyword}}#${id} .ui-token-string{color:${C.token.string}}#${id} .ui-token-number{color:${accent}}#${id} .ui-token-comment{color:${C.token.comment}}#${id} .ui-token-operator{color:${C.token.operator}}`;
      body += `<p class="ui-code-language">${escape(c.label)}</p><pre class="ui-code">`;
      for (const line of c.lines) {
        const i = line.index;
        let character = 0;
        const tokens = line.tokens.map(token => `<span class="ui-token-${token.type}">${c.typing ? token.chars.map(char => `<span id="${id}-char-${i}-${character++}" class="ui-code-character" style="opacity:0">${escape(char)}</span>`).join('') : escape(token.text)}</span>`).join('');
        body += `<span id="${id}-code-${i}" class="ui-code-line">${tokens}</span>`;
        motion.push(`tl.fromTo(${js(`#${id}-code-${i}`)}, {opacity:0,x:12}, {opacity:1,x:0,duration:0.24,ease:'power3.out'}, ${line.time});`);
        if (c.typing) line.charTimes.forEach((time, j) => motion.push(`tl.to(${js(`#${id}-char-${i}-${j}`)}, {opacity:1,duration:0.001,ease:'none'}, ${time});`));
      }
      body += '</pre>';
    } else if (kind === 'audience-grid') {
      css += `#${id} .ui-note{margin:0;padding:0 24px 20px;color:${C.muted};font-size:${S.size.small}px;line-height:1.3}#${id} .ui-audience{display:grid;grid-template-columns:repeat(${c.columns},minmax(0,1fr));gap:${c.gap}px;padding:0 24px 24px}#${id} .ui-viewer{height:${c.cellHeight}px;padding:16px;border:2px solid ${C.border};border-radius:${R.viewer}px;background:${C.bar};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0}#${id} .ui-avatar{font-size:${S.size.avatar}px;line-height:1.1}#${id} .ui-viewer-label{font-size:${c.labelFont}px;text-align:center;overflow-wrap:break-word}`;
      body += `<p class="ui-note">${escape(c.note)}</p><div class="ui-audience">`;
      for (const tile of c.tiles) {
        body += `<div id="${id}-viewer-${tile.index}" class="ui-viewer"><span class="ui-avatar" aria-hidden="true">${escape(tile.emoji)}</span><span class="ui-viewer-label">${escape(tile.label)}</span></div>`;
        motion.push(`tl.fromTo(${js(`#${id}-viewer-${tile.index}`)}, {opacity:0,y:8}, {opacity:1,y:0,borderColor:${js(accent)},duration:0.24,ease:'power3.out'}, ${tile.time});`);
      }
      body += '</div>';
    } else if (kind === 'focus-flow') {
      css += `#${id} .ui-focus-note{font-size:${S.size.small}px;line-height:1.3;margin:0;padding:0 24px 20px;color:${C.muted}}#${id} .ui-focus-stage{position:relative;height:${c.stageHeight}px;margin:0 24px}#${id} .ui-focus-option{position:absolute;left:0;top:0;width:${c.optionWidth}px;height:${c.rowHeight}px;padding:0 16px;display:flex;align-items:center;justify-content:center;gap:12px;border:1px solid ${C.border};border-radius:${R.focus}px;background:${C.bar};font-size:${c.optionFont}px;line-height:1.25;text-align:center;opacity:0}#${id} .ui-focus-option>span:last-child{min-width:0;overflow-wrap:break-word}#${id} .ui-focus-icon{width:34px;height:34px;flex:none}#${id} .ui-focus-icon svg{width:34px;height:34px;display:block}#${id} .ui-focus-progress{margin:18px 24px 24px;opacity:0}#${id} .ui-focus-progress-label{font-size:${S.size.small}px;line-height:1.3;margin-bottom:12px}#${id} .ui-focus-track{height:12px;border-radius:${R.focusTrack}px;background:${C.track};overflow:hidden}#${id} .ui-focus-fill{height:100%;background:${accent};transform-origin:left center}`;
      body += `<p class="ui-focus-note">${escape(c.note)}</p><div class="ui-focus-stage">`;
      for (const option of c.options) {
        const key = `${id}-option-${option.index}`;
        body += `<div id="${key}" class="ui-focus-option">${option.selected && c.icon ? `<span class="ui-focus-icon" aria-hidden="true">${symbol(c.icon)}</span>` : ''}<span>${escape(option.label)}</span></div>`;
        motion.push(`tl.fromTo(${js(`#${key}`)}, {opacity:0,x:${option.initial.x},y:${option.initial.y + 8}}, {opacity:1,x:${option.initial.x},y:${option.initial.y},duration:0.24,ease:'power3.out'}, ${option.arriveTime});`);
        if (option.selected) motion.push(`tl.to(${js(`#${key}`)}, {x:${c.target.x},y:${c.target.y},scale:${c.chosenScale},borderColor:${js(accent)},backgroundColor:${js(accent + A.wash)},duration:0.42,ease:'power3.inOut'}, ${c.chosenMoveTime});`);
        else motion.push(`tl.to(${js(`#${key}`)}, {opacity:0,duration:0.16,ease:'power2.out'}, ${c.chooseTime});`, `tl.to(${js(`#${key}`)}, {x:${c.target.x},y:${c.target.y},scale:0.94,duration:0.38,ease:'power3.inOut'}, ${c.chooseTime});`);
      }
      body += `</div><div id="${id}-focus-progress" class="ui-focus-progress"><div class="ui-focus-progress-label">${escape(c.progressLabel)}</div><div class="ui-focus-track"><div id="${id}-focus-fill" class="ui-focus-fill"></div></div></div>`;
      motion.push(`tl.set(${js(`#${id}-focus-fill`)}, {scaleX:0}, ${start});`, `tl.to(${js(`#${id}-focus-progress`)}, {opacity:1,duration:0.2}, ${c.progressTime});`, `tl.to(${js(`#${id}-focus-fill`)}, {scaleX:1,duration:${c.progressDuration},ease:'power2.inOut'}, ${c.progressTime});`);
    } else if (kind === 'trend-chart' || kind === 'growth-chart') {
      const isGrowth = c.variant === 'growth';
      css += `#${id} .ui-note{margin:0;padding:0 24px 20px;color:${C.muted};font-size:${S.size.small}px;line-height:1.3;overflow-wrap:break-word}#${id} .ui-metric{padding:0 24px 20px;height:80px;display:flex;align-items:baseline;gap:16px;white-space:nowrap}#${id} .ui-count{font-size:${S.size.count}px;font-weight:750;font-variant-numeric:tabular-nums}#${id} .ui-unit{font-size:${S.size.small}px;color:${C.muted}}#${id} .ui-chart{display:grid;grid-template-columns:repeat(${c.points.length},minmax(0,1fr));gap:${c.gap}px;padding:0 24px 24px}#${id} .ui-column{min-width:0;text-align:center}#${id} .ui-bar-track{height:${c.chartHeight}px;display:flex;align-items:flex-end;border-bottom:1px solid ${C.axis}}#${id} .ui-trend-bar{width:100%;background:${accent};border-radius:${R.bar}px ${R.bar}px 0 0;transform-origin:bottom}#${id} .ui-point-label{display:block;font-size:${c.labelFont}px;line-height:1.25;margin-top:12px;overflow-wrap:break-word}`;
      if (isGrowth) css += `#${id} .ui-column{opacity:0}#${id} .ui-count{font-size:${S.size.growthCount}px}#${id} .ui-metric{height:88px}#${id} .ui-trend-bar{border-radius:${R.growthBar}px ${R.growthBar}px 0 0}`;
      if (isGrowth && !c.showValues) css += `#${id} .ui-metric{display:none}`;
      body += `<p class="ui-note">${escape(c.attribution)}</p><div class="ui-metric"><span id="${id}-count" class="ui-count">0</span><span class="ui-unit">${escape(c.unit)}</span></div><div class="ui-chart">`;
      motion.unshift(`tl.set(${js(`#${id}-count`)}, {textContent:0}, ${start});`);
      for (const point of c.points) {
        const i = point.index;
        body += `<div${isGrowth ? ` id="${id}-column-${i}"` : ''} class="ui-column"><div class="ui-bar-track"><div id="${id}-bar-${i}" class="ui-trend-bar" style="height:${point.barHeight}px"></div></div><span class="ui-point-label">${escape(point.label)}</span></div>`;
        if (isGrowth) motion.push(`tl.fromTo(${js(`#${id}-column-${i}`)}, {opacity:0,y:10}, {opacity:1,y:0,duration:0.24,ease:'power3.out'}, ${point.time});`);
        motion.push(`tl.set(${js(`#${id}-bar-${i}`)}, {scaleY:0}, ${start});`, `tl.to(${js(`#${id}-bar-${i}`)}, {scaleY:1,duration:0.38,ease:'power3.out'}, ${point.time});`);
        motion.push(`tl.fromTo(${js(`#${id}-count`)}, {textContent:${point.from}}, {textContent:${point.value},snap:{textContent:1},duration:0.38,ease:'power2.out',immediateRender:false}, ${point.time});`);
      }
      body += '</div>';
    } else if (kind === 'metric' || kind === 'progress') {
      const isMetric = c.variant === 'metric';
      css += `#${id} .ui-note{margin:0;padding:0 24px 20px;color:${C.muted};font-size:${S.size.small}px;line-height:1.3;overflow-wrap:break-word}#${id} .ui-number{margin:0;padding:0 24px 12px;font-size:${c.numberFont}px;font-weight:750;line-height:1.1;font-variant-numeric:tabular-nums;white-space:nowrap}#${id} .ui-number-unit{padding:0 24px 20px;font-size:${S.size.small}px;color:${C.muted}}#${id} .ui-progress-track{height:16px;margin:0 24px 24px;background:${C.track};border-radius:${R.track}px;overflow:hidden}#${id} .ui-progress-fill{height:100%;background:${accent};transform-origin:left}`;
      body += `<p class="ui-note">${escape(c.attribution)}</p><div id="${id}-number" class="ui-number">${escape(c.initialText)}</div><div class="ui-number-unit">${escape(c.unitText)}</div>`;
      if (!isMetric) body += '<div class="ui-progress-track"><div class="ui-progress-fill"></div></div>';
      motion.push(`tl.set(${js(`#${id}-number`)}, {textContent:${js(gsapText(c.initialText))}}, ${start});`);
      if (!isMetric) motion.push(`tl.set(${js(`${selector} .ui-progress-fill`)}, {scaleX:${c.values[0].scale}}, ${start});`);
      for (const value of c.values) {
        // Text changes are finite timeline states, not callbacks or wall-clock
        // work. They restore even when a renderer seeks backwards.
        if (value.index === 0) motion.push(`tl.fromTo(${js(`#${id}-number`)}, {opacity:0.7}, {opacity:1,duration:0.2}, ${value.time});`);
        else for (const frame of value.frames) motion.push(`tl.set(${js(`#${id}-number`)}, {textContent:${js(gsapText(frame.text))}}, ${frame.time});`);
        if (!isMetric && value.index > 0) motion.push(`tl.to(${js(`${selector} .ui-progress-fill`)}, {scaleX:${value.scale},duration:0.6,ease:'power2.out'}, ${value.time});`);
      }
    } else if (kind === 'checklist') {
      const labels = c.statusLabels;
      for (const row of c.rows) {
        const i = row.index;
        // Tick path reused from shipped public/icons/check.svg.
        body += `<div id="${id}-row-${i}" class="ui-row" style="height:${c.rowHeight}px"><span class="ui-check"><svg viewBox="${c.check.viewBox}" aria-hidden="true"><path d="${c.check.path}" fill="none" stroke="${accent}" stroke-width="${c.check.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="ui-label">${escape(row.label)}</span><span class="ui-status"><span id="${id}-status-${i}-pending"${row.status === 'pending' ? '' : ' style="opacity:0"'}>${escape(labels.pending)}</span><span id="${id}-status-${i}-active" style="opacity:0;position:absolute;right:0">${escape(labels.active)}</span><span id="${id}-status-${i}-done" style="opacity:0;position:absolute;right:0">${escape(labels.done)}</span></span></div>`;
        // A row that turns active or done at its time shows no status label
        // before it: the pending label would read as a state it never has.
        if (row.status !== 'pending') motion.push(`tl.to(${js(`#${id}-status-${i}-${row.status}`)}, {opacity:1,duration:0.16}, ${row.time});`);
        if (row.status === 'done') motion.push(`tl.to(${js(`#${id}-row-${i} svg`)}, {opacity:1,duration:0.16,ease:'power2.out'}, ${row.time});`);
        if (row.status === 'active') motion.push(`tl.to(${js(`#${id}-row-${i} .ui-check`)}, {borderColor:${js(accent)},duration:0.16}, ${row.time});`, `tl.to(${js(`#${id}-row-${i}`)}, {backgroundColor:${js(accent + A.wash)},duration:0.16}, ${row.time});`);
        if (row.doneTime !== null) motion.push(`tl.to(${js(`#${id}-row-${i}`)}, {backgroundColor:${js(c.doneBackground)},duration:0.16}, ${row.doneTime});`, `tl.to(${js(`#${id}-status-${i}-active`)}, {opacity:0,duration:0.01}, ${row.doneTime});`, `tl.to(${js(`#${id}-status-${i}-done`)}, {opacity:1,duration:0.16}, ${row.doneTime});`, `tl.to(${js(`#${id}-row-${i} svg`)}, {opacity:1,duration:0.16,ease:'power2.out'}, ${row.doneTime});`);
      }
    } else {
      motion.unshift(`tl.set(${js(`${selector} .ui-fill`)}, {scaleX:0,transformOrigin:'left center'}, ${start});`);
      if (c.numbered) css += `#${id} .ui-step-number{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:${accent};color:${C.stepInk};font-size:${S.size.stepNumber}px;font-weight:750;margin-bottom:12px}`;
      body += `<div class="ui-rail"><div class="ui-fill"></div></div><div class="ui-steps">`;
      for (const step of c.steps) {
        body += `<div id="${id}-step-${step.index}" class="ui-step">${c.numbered ? `<span class="ui-step-number">${step.number}</span>` : ''}${escape(step.label)}</div>`;
        motion.push(`tl.to(${js(`#${id}-step-${step.index}`)}, {opacity:1,duration:0.18}, ${step.time});`, `tl.to(${js(`#${id}-step-${step.index}`)}, {color:${js(c.activeColor)},duration:0.18}, ${step.time});`, `tl.to(${js(`${selector} .ui-fill`)}, {scaleX:${step.fill},duration:0.3,ease:'power2.inOut'}, ${step.time});`);
      }
      body += '</div>';
    }
  }
  if (model.customTheme) {
    const scoped = (selectors, declarations) => selectors.map(name => `${selector}${name ? ` ${name}` : ''}`).join(',') + `{${declarations}}`;
    const fill = glass ? theme.surface + G.themeFillAlpha : theme.surface;
    css += scoped([''], `background:${fill};color:${theme.foreground};border-color:${theme.border}`);
    css += scoped(['.ui-row', '.ui-rack-row', '.ui-viewer', '.ui-focus-option'], `background:${theme.surface};border-color:${theme.border};color:${theme.foreground}`);
    css += scoped(['.ui-bar'], `background:${glass ? theme.surface + G.themeBarAlpha : theme.surface};border-color:${theme.border};color:${theme.foreground}`);
    css += scoped(['.ui-body', '.ui-symbol', '.ui-rack-label', '.ui-bar-label', '.ui-title'], `color:${theme.foreground}`);
    css += scoped(['.ui-status', '.ui-focus-note', '.ui-note', '.ui-unit', '.ui-number-unit', '.ui-date-note', '.ui-rack-note', '.ui-code-language', '.ui-excerpt-note', '.ui-token-comment', '.ui-token-string'], `color:${theme.muted}`);
    css += scoped(['.ui-emphasis', '.ui-token-keyword', '.ui-token-number'], `color:${theme.accentText}`);
    css += scoped(['.ui-token-operator', '.ui-step'], `color:${theme.foreground}`);
    css += scoped(['.ui-check', '.ui-bar-track'], `border-color:${theme.border}`);
    css += scoped(['.ui-rail', '.ui-progress-track', '.ui-rack-marker', '.ui-light', '.ui-focus-track'], `background:${theme.border}`);
    // Orange stays an accent fill; dark ink remains legible on its bright band.
    css += scoped(['.ui-month', '.ui-step-number'], `color:${C.themedInk}`);
    if (kind === 'media-window') css += `#${id}-media{background:${theme.surface}!important}`;
    if (glass) css += `@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){${scoped([''], `background:${theme.surface}${G.themeSupportedAlpha}`)}}`;
  }
  const density = model.density;
  if (density && density.scale !== 1 && kind !== 'media-window') {
    // Density: the kind markup lays out in the layout box and is scaled into
    // the rect from its top-left corner (the section keeps the canvas rect,
    // border, radius, shadow and module motion).
    css += `#${id}>.ui-density{${densityCss(density)}}`;
    body = `<div class="ui-density">${body}</div>`;
  }
  const background = kind === 'media-window' ? 'background:transparent;' : '';
  return {html: `${media}<section id="${id}" ${kind === 'media-window' ? chromeTimed : timed} style="${background}">${body}</section>`, css, motion: motion.join('\n'), events: model.events, layout: model.layout};
}

// Emitter table for the story compiler (docs/KIT_CONTRACTS.md, "Emitters").
export const EMITTERS = Object.freeze(Object.fromEntries(EDITORIAL_KINDS.map(kind => [kind, emitEditorialModule])));

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node editorial-ui-modules.mjs module.json');
    const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
    process.stdout.write(`${JSON.stringify(buildEditorialModule(input), null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
