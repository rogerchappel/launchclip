// Shared helpers for the batch B editorial components (media-window,
// code-snippet, excerpt-window, focus-flow, date-card, status-rack,
// audience-grid). They reproduce the HyperFrames emitter's section shell
// (skills/launchclip-create-video/scripts/editorial-ui-modules.mjs): the
// enter/exit tweens, the solid/panel/glass surface, the custom theme overrides,
// the window bar and the symbols. Kept small so it can merge into shared.tsx.
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
// @ts-ignore plain ESM core, bundled by Remotion
import { EDITORIAL_STYLE, EDITORIAL_SYMBOLS } from "../../core/editorial-core.mjs";
// @ts-ignore plain ESM core, bundled by Remotion
import { tween } from "../../core/motion.mjs";

export type Model = any;
export const S = EDITORIAL_STYLE;
export const C = S.color;
export const R = S.radius;
export const F = S.font;
export const G = S.glass;
export const A = S.accentAlpha;

/** Absolute host time: the parent Sequence starts at model.start. */
export function useModuleTime(model: Model): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return model.start + frame / fps;
}

/** `#id *{box-sizing:border-box}` from the emitter, applied per element. */
export const BOX: React.CSSProperties = { boxSizing: "border-box" };

/** Inside the module's clip window [start, end). */
export const visible = (model: Model, t: number) => t >= model.start - 1e-9 && t < model.end - 1e-9;

type Transform = { x?: number; y?: number; scale?: number; rotation?: number };

/**
 * GSAP's transform order: translate, rotate, scale. GSAP's force3D:"auto"
 * writes translate3d() while a tween is mid-flight (0 < ratio < 1), which
 * moves the element onto a composited layer, and plain translate() at rest;
 * pass `moving` to match its rasterisation.
 */
export function transform({ x = 0, y = 0, scale = 1, rotation = 0 }: Transform, moving = false): string {
  const translate = moving ? `translate3d(${x}px, ${y}px, 0px)` : `translate(${x}px, ${y}px)`;
  return `${translate}${rotation ? ` rotate(${rotation}deg)` : ""}${scale !== 1 ? ` scale(${scale})` : ""}`;
}

/** GSAP scaleX-only transform (origin set by the caller). */
export const scaleX = (value: number, moving = false) => `${moving ? "translate3d(0px, 0px, 0px) " : ""}scaleX(${value})`;

/** True while t is strictly inside any of the [time, time + duration] windows. */
export const inFlight = (t: number, windows: Array<{ time: number; duration: number }>) =>
  windows.some(({ time, duration }) => t > time && t < time + duration);

export type Step = { time: number; duration: number; ease?: string; to: Record<string, any> };

/**
 * A run of GSAP `tl.to()` calls on one target: each tween starts from the
 * value the previous ones left at its start time. `initial` is the CSS value
 * (or a `fromTo` start). Steps must not overlap in time (the emitter's
 * validation guarantees that for every kind here).
 */
export function chain(t: number, initial: Record<string, any>, steps: Step[]): Record<string, any> {
  let value = { ...initial };
  for (const step of [...steps].sort((a, b) => a.time - b.time)) {
    if (t <= step.time) break;
    const from: Record<string, any> = {};
    for (const key of Object.keys(step.to)) from[key] = value[key];
    value = { ...value, ...tween(t, { from, to: step.to, start: step.time, duration: step.duration, ease: step.ease ?? "power1.out" }) };
  }
  return value;
}

/**
 * The module enter/exit (moduleMotion() in the emitter): a fromTo from
 * motion.enterFrom over enterDuration, then a to() towards motion.exitTo at
 * exitStart. Without spec.motion GSAP's default centre pivot is irrelevant
 * (only y moves); with it the pivot is `origin`.
 */
export function moduleMotion(model: Model, t: number, origin?: string): React.CSSProperties {
  const m = model.motion;
  const rest = { opacity: 1, x: 0, y: 0, scale: 1 };
  const steps = [
    { time: m.enterStart, duration: m.enterDuration, ease: m.enterEase, to: rest },
    { time: m.exitStart, duration: m.exitDuration, ease: m.exitEase, to: { ...m.exitTo } }
  ];
  const value = chain(t, { ...m.enterFrom }, steps);
  return {
    opacity: value.opacity,
    transform: transform(value, inFlight(t, steps)),
    ...(m.supplied ? { transformOrigin: origin ?? m.transformOrigin } : {})
  };
}

/** Resolved colours for the roles the emitter's CSS (and theme overrides) set. */
export function palette(model: Model) {
  const { theme, customTheme: custom, accent } = model;
  const glass = model.presentation === "glass";
  const media = model.kind === "media-window";
  return {
    custom,
    glass,
    foreground: custom ? theme.foreground : C.foreground,
    muted: custom ? theme.muted : C.muted,
    accentText: custom ? theme.accentText : accent,
    rowSurface: custom ? theme.surface : C.bar,
    rowBorder: custom ? theme.border : C.border,
    track: custom ? theme.border : C.track,
    bar: {
      background: custom ? (glass ? theme.surface + G.themeBarAlpha : theme.surface) : glass && media ? G.barFill : C.bar,
      borderColor: custom ? theme.border : C.border,
      color: custom ? theme.foreground : undefined,
      blur: glass && media
    }
  };
}

const backdrop = (on: boolean): React.CSSProperties =>
  on ? { backdropFilter: `blur(${G.blur}px)`, WebkitBackdropFilter: `blur(${G.blur}px)` } : {};

/** The section's own box: #id{…} plus panel, glass and custom theme rules. */
export function surfaceStyle(model: Model): React.CSSProperties {
  const { rect, accent, theme, chrome } = model;
  const glass = model.presentation === "glass";
  const style: React.CSSProperties = {
    position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height,
    boxSizing: "border-box", overflow: "hidden", background: C.surface, color: C.foreground,
    border: `1px solid ${C.border}`, borderRadius: R.panel, boxShadow: S.shadow.panel,
    fontFamily: F.sans, fontSize: chrome.font, lineHeight: S.size.lineHeight
  };
  if (model.surface === "panel" && model.kind !== "callout") {
    Object.assign(style, { background: C.panel, borderColor: C.panelBorder, borderRadius: R.editorial,
      boxShadow: `${S.shadow.panelGlow} ${accent}${S.shadow.panelGlowAlpha},${S.shadow.drop}` });
  }
  // Chrome supports backdrop-filter, so the @supports fill applies.
  if (glass && model.kind !== "media-window") Object.assign(style, { background: G.supportedFill, borderColor: G.border }, backdrop(true));
  if (model.customTheme) {
    Object.assign(style, { background: glass ? theme.surface + G.themeSupportedAlpha : theme.surface, color: theme.foreground, borderColor: theme.border });
  }
  if (model.kind === "media-window") style.background = "transparent";
  return style;
}

/** <section> at the module rect, carrying the module enter/exit. */
export const Section: React.FC<{ model: Model; t: number; children?: React.ReactNode; style?: React.CSSProperties }> = ({ model, t, children, style }) => (
  <section id={model.id} style={{ ...surfaceStyle(model), ...moduleMotion(model, t), ...style }}>
    {children}
  </section>
);

/** h2.ui-title */
export const Title: React.FC<{ model: Model; style?: React.CSSProperties }> = ({ model, style }) => {
  const p = palette(model);
  return (
    <h2 style={{ margin: 0, padding: model.chrome.pad, fontSize: model.chrome.titleFont, fontWeight: 700,
      lineHeight: S.size.titleLineHeight, boxSizing: "border-box", ...(p.custom ? { color: p.foreground } : {}), ...style }}>
      {model.title}
    </h2>
  );
};

/** .ui-bar with the three window dots and a label. */
export const WindowBar: React.FC<{ model: Model; bar: { label: string; dots: string[] } }> = ({ model, bar }) => {
  const p = palette(model).bar;
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: S.space.bar, display: "flex", alignItems: "center", gap: 10,
      padding: "0 16px", boxSizing: "border-box", background: p.background, borderBottom: `1px solid ${p.borderColor}`,
      ...(p.color ? { color: p.color } : {}), ...backdrop(p.blur) }}>
      {bar.dots.map((dot, i) => <span key={i} style={{ width: 12, height: 12, borderRadius: "50%", background: dot, boxSizing: "border-box" }} />)}
      <span style={{ marginLeft: 12, fontSize: S.size.small, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxSizing: "border-box" }}>{bar.label}</span>
    </div>
  );
};

/** One of EDITORIAL_SYMBOLS as an inline SVG. */
export const SymbolIcon: React.FC<{ name: string; size: number }> = ({ name, size }) => (
  <svg viewBox={S.symbol.viewBox} width={size} height={size} fill="none" stroke="currentColor" strokeWidth={S.symbol.strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", width: size, height: size }}
    dangerouslySetInnerHTML={{ __html: EDITORIAL_SYMBOLS[name] }} />
);
