// Shared shell for the Remotion editorial modules (registry A).
//
// The HyperFrames emitter (kit/hyperframes/editorial-ui-modules.mjs, copied to
// skills/launchclip-create-video/scripts/) is the visual spec: these modules
// rebuild the same DOM (ids, classes) with the same stylesheet, and replace
// each GSAP tween with a frame-pure value from kit/core/motion.mjs. A still at
// any time t therefore matches the HyperFrames frame at t.
//
// Contract: docs/KIT_CONTRACTS.md, "Editorial core" and "Wave 2".
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {useSceneTime} from '../clock';
// @ts-ignore plain ESM core shared with HyperFrames
import {tween} from '../../core/motion.mjs';
// @ts-ignore plain ESM core shared with HyperFrames
import {EDITORIAL_STYLE, EDITORIAL_SYMBOLS} from '../../core/editorial-core.mjs';

export type Model = any;
export type ModuleProps = {model: Model};

export const S = EDITORIAL_STYLE;
export const C = S.color, R = S.radius, F = S.font, G = S.glass, SH = S.shadow, A = S.accentAlpha;
export const DEFAULT_EASE = 'power1.out';

/** Absolute timeline seconds for the current frame (kit/remotion/clock.tsx). */
export function useModuleTime(model: Model): number {
  return useSceneTime(model.start);
}

// ---------------------------------------------------------------------------
// GSAP tween equivalents (frame-pure)

export type Segment = {start: number; duration: number; to: any; ease?: string};

/** `tl.fromTo(el, from, to, start)` with immediateRender (the default): `from` holds before start. */
export function fromTo(t: number, from: any, to: any, start: number, duration: number, ease = DEFAULT_EASE) {
  if (t < start) return from;
  return tween(t, {from, to, start, duration, ease});
}

/**
 * A run of non-overlapping `tl.to()` tweens on one property, each starting
 * from wherever the previous one ended (how GSAP records `to` start values
 * when the timeline renders forward). `initial` is the pre-tween value.
 */
export function chain(t: number, initial: any, segments: Segment[]) {
  let value = initial;
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  for (const segment of ordered) {
    if (t < segment.start) break;
    value = tween(t, {from: value, to: segment.to, start: segment.start, duration: segment.duration, ease: segment.ease ?? DEFAULT_EASE});
  }
  return value;
}

/** Latest discrete state at or before t (`tl.set` runs), else `initial`. */
export function stepped<T>(t: number, initial: T, states: Array<{time: number; value: T}>): T {
  let value = initial;
  for (const state of states) if (t + 1e-9 >= state.time) value = state.value;
  return value;
}

/** GSAP 2D transform string: translate, rotate, scale (GSAP's order). */
export function transform({x = 0, y = 0, rotation = 0, scale, scaleX, scaleY}: {x?: number; y?: number; rotation?: number; scale?: number; scaleX?: number; scaleY?: number}) {
  const sx = scaleX ?? scale ?? 1, sy = scaleY ?? scale ?? 1;
  const parts: string[] = [];
  if (x || y) parts.push(`translate(${x}px, ${y}px)`);
  if (rotation) parts.push(`rotate(${rotation}deg)`);
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
  return parts.length ? parts.join(' ') : 'none';
}

/** Hex color with optional #RRGGBBAA alpha; interpolation helpers need full 8-digit hex. */
export const TRANSPARENT = '#00000000';

// ---------------------------------------------------------------------------
// Module shell motion (moduleMotion() in the emitter)

export type ShellState = {visible: boolean; opacity: number; x: number; y: number; scale: number};

export function shellState(model: Model, t: number): ShellState {
  const m = model.motion;
  if (t < model.start || t >= model.end - 1e-9) return {visible: false, opacity: 0, x: 0, y: 0, scale: 1};
  const from = {opacity: m.enterFrom.opacity, x: m.enterFrom.x, y: m.enterFrom.y, scale: m.enterFrom.scale};
  const settled = {opacity: 1, x: 0, y: 0, scale: 1};
  let state = fromTo(t, from, settled, m.enterStart, m.enterDuration, m.enterEase);
  if (t >= m.exitStart) {
    const to = {opacity: m.exitTo.opacity, x: m.exitTo.x, y: m.exitTo.y, scale: m.exitTo.scale};
    state = tween(t, {from: state, to, start: m.exitStart, duration: m.exitDuration, ease: m.exitEase});
  }
  return {visible: true, ...state};
}

// ---------------------------------------------------------------------------
// Stylesheet (the emitter's base, surface, glass and custom-theme CSS)

const blur = `backdrop-filter:blur(${G.blur}px);-webkit-backdrop-filter:blur(${G.blur}px)`;

export function baseCss(model: Model): string {
  const {id, kind, accent} = model;
  const {font, pad, statusWidth} = model.chrome;
  const glass = model.presentation === 'glass';
  let css = `#${id}{position:absolute;left:${model.rect.x}px;top:${model.rect.y}px;width:${model.rect.width}px;height:${model.rect.height}px;box-sizing:border-box;overflow:hidden;background:${C.surface};color:${C.foreground};border:1px solid ${C.border};border-radius:${R.panel}px;box-shadow:${SH.panel};font-family:${F.sans};font-size:${font}px;line-height:${S.size.lineHeight}}#${id} *{box-sizing:border-box}#${id} .ui-title{margin:0;padding:${pad}px;font-size:${font + 4}px;font-weight:700;line-height:${S.size.titleLineHeight}}#${id} .ui-row{display:flex;align-items:center;gap:${S.space.rowGap}px;padding:14px ${pad}px;border-top:1px solid ${C.divider}}#${id} .ui-label{flex:1;min-width:0;overflow-wrap:break-word}#${id} .ui-check{width:36px;height:36px;flex:none;border:2px solid ${C.checkBorder};border-radius:${R.check}px;display:grid;place-items:center}#${id} .ui-check svg{width:32px;height:32px;opacity:0}#${id} .ui-status{font-size:${font - 6}px;color:${C.status};width:${statusWidth}px;flex:none;text-align:right;position:relative}#${id} .ui-bar{position:absolute;top:0;left:0;right:0;height:${S.space.bar}px;display:flex;align-items:center;gap:10px;padding:0 16px;background:${C.bar};border-bottom:1px solid ${C.border}}#${id} .ui-dot{width:12px;height:12px;border-radius:50%}#${id} .ui-bar-label{margin-left:12px;font-size:${S.size.small}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#${id} .ui-content{padding:${pad}px}#${id} .ui-rail{position:relative;margin:20px ${pad}px 0;height:8px;background:${C.track};border-radius:${R.rail}px}#${id} .ui-fill{height:100%;background:${accent};transform-origin:left;border-radius:${R.rail}px}#${id} .ui-steps{display:flex;justify-content:space-between;padding:22px ${pad}px;gap:12px}#${id} .ui-step{flex:1;min-width:0;font-size:${Math.max(22, font - 4)}px;overflow-wrap:break-word;opacity:.65}#${id} .ui-body{padding:0 ${pad}px ${pad}px;margin:0;color:${C.muted};overflow-wrap:break-word}`;
  if (model.surface === 'panel' && kind !== 'callout') css += `#${id}{background:${C.panel};border-color:${C.panelBorder};border-radius:${R.editorial}px;box-shadow:${SH.panelGlow} ${accent}${SH.panelGlowAlpha},${SH.drop}}`;
  if (glass) css += kind === 'media-window' ? `#${id} .ui-bar{background:${G.barFill};${blur}}` : `#${id}{background:${G.fill};border-color:${G.border};${blur}}@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){#${id}{background:${G.supportedFill}}}`;
  return css;
}

/** Custom-theme overrides; appended after the kind CSS, as in the emitter. */
export function themeCss(model: Model): string {
  if (!model.customTheme) return '';
  const {id, kind, theme} = model;
  const glass = model.presentation === 'glass';
  const selector = `#${id}`;
  const scoped = (selectors: string[], declarations: string) => selectors.map(name => `${selector}${name ? ` ${name}` : ''}`).join(',') + `{${declarations}}`;
  const fill = glass ? theme.surface + G.themeFillAlpha : theme.surface;
  let css = scoped([''], `background:${fill};color:${theme.foreground};border-color:${theme.border}`);
  css += scoped(['.ui-row', '.ui-rack-row', '.ui-viewer', '.ui-focus-option'], `background:${theme.surface};border-color:${theme.border};color:${theme.foreground}`);
  css += scoped(['.ui-bar'], `background:${glass ? theme.surface + G.themeBarAlpha : theme.surface};border-color:${theme.border};color:${theme.foreground}`);
  css += scoped(['.ui-body', '.ui-symbol', '.ui-rack-label', '.ui-bar-label', '.ui-title'], `color:${theme.foreground}`);
  css += scoped(['.ui-status', '.ui-focus-note', '.ui-note', '.ui-unit', '.ui-number-unit', '.ui-date-note', '.ui-rack-note', '.ui-code-language', '.ui-excerpt-note', '.ui-token-comment', '.ui-token-string'], `color:${theme.muted}`);
  css += scoped(['.ui-emphasis', '.ui-token-keyword', '.ui-token-number'], `color:${theme.accentText}`);
  css += scoped(['.ui-token-operator', '.ui-step'], `color:${theme.foreground}`);
  css += scoped(['.ui-check', '.ui-bar-track'], `border-color:${theme.border}`);
  css += scoped(['.ui-rail', '.ui-progress-track', '.ui-rack-marker', '.ui-light', '.ui-focus-track'], `background:${theme.border}`);
  css += scoped(['.ui-month', '.ui-step-number'], `color:${C.themedInk}`);
  if (kind === 'media-window') css += `#${id}-media{background:${theme.surface}!important}`;
  if (glass) css += `@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){${scoped([''], `background:${theme.surface}${G.themeSupportedAlpha}`)}}`;
  return css;
}

// ---------------------------------------------------------------------------
// Pieces

/** Six-digit or eight-digit hex for an element's resolved start color. */
export const hexAlpha = (color: string, alpha: string) => `${color}${alpha}`;

export const Symbol: React.FC<{name: string; style?: React.CSSProperties}> = ({name}) => (
  <svg viewBox={S.symbol.viewBox} fill="none" stroke="currentColor" strokeWidth={S.symbol.strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    dangerouslySetInnerHTML={{__html: EDITORIAL_SYMBOLS[name]}} />
);

export const Title: React.FC<{model: Model}> = ({model}) => <h2 className="ui-title">{model.title}</h2>;

/**
 * Density wrapper (the emitter's `.ui-density`): when model.density.scale is
 * not 1, children lay out in the layout box and scale into the rect from its
 * top-left corner. At scale 1 the children render directly, as before.
 */
export const Density: React.FC<{model: Model; children?: React.ReactNode}> = ({model, children}) => {
  const d = model.density;
  if (!d || d.scale === 1 || model.kind === 'media-window') return <>{children}</>;
  return (
    <div className="ui-density" style={{position: 'absolute', left: 0, top: 0, width: d.layout.width, height: d.layout.height, transform: `scale(${d.scale})`, transformOrigin: '0 0'}}>
      {children}
    </div>
  );
};

/**
 * Full-canvas layer holding the module section at absolute canvas coordinates.
 * `css` is the kind-specific stylesheet (appended between base and theme CSS).
 */
export const ModuleShell: React.FC<{model: Model; t: number; css?: string; children: React.ReactNode}> = ({model, t, css = '', children}) => {
  const shell = shellState(model, t);
  if (!shell.visible) return null;
  const style: React.CSSProperties = {opacity: shell.opacity, transform: transform({x: shell.x, y: shell.y, scale: shell.scale})};
  if (model.motion.supplied) style.transformOrigin = model.motion.transformOrigin;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <style>{baseCss(model) + css + themeCss(model)}</style>
      <section id={model.id} style={style}><Density model={model}>{children}</Density></section>
    </AbsoluteFill>
  );
};
