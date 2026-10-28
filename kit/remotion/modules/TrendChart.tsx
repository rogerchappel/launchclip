// trend-chart and growth-chart. Mirrors the emitter's chart branch: each bar
// grows from the baseline over 0.38s (power3.out) while the shared count
// snaps from the previous point's value (power2.out); growth columns fade up.
import React from 'react';
import {C, R, S, ModuleShell, fromTo, transform, useModuleTime, type ModuleProps, type Model} from './shared';
// @ts-ignore plain ESM core shared with HyperFrames
import {tween} from '@launchclip/core/motion.mjs';

export function chartCss(model: Model): string {
  const {id, accent, content: c} = model;
  const isGrowth = c.variant === 'growth';
  let css = `#${id} .ui-note{margin:0;padding:0 24px 20px;color:${C.muted};font-size:${S.size.small}px;line-height:1.3;overflow-wrap:break-word}#${id} .ui-metric{padding:0 24px 20px;height:80px;display:flex;align-items:baseline;gap:16px;white-space:nowrap}#${id} .ui-count{font-size:${S.size.count}px;font-weight:750;font-variant-numeric:tabular-nums}#${id} .ui-unit{font-size:${S.size.small}px;color:${C.muted}}#${id} .ui-chart{display:grid;grid-template-columns:repeat(${c.points.length},minmax(0,1fr));gap:${c.gap}px;padding:0 24px 24px}#${id} .ui-column{min-width:0;text-align:center}#${id} .ui-bar-track{height:${c.chartHeight}px;display:flex;align-items:flex-end;border-bottom:1px solid ${C.axis}}#${id} .ui-trend-bar{width:100%;background:${accent};border-radius:${R.bar}px ${R.bar}px 0 0;transform-origin:bottom}#${id} .ui-point-label{display:block;font-size:${c.labelFont}px;line-height:1.25;margin-top:12px;overflow-wrap:break-word}`;
  if (isGrowth) css += `#${id} .ui-column{opacity:0}#${id} .ui-count{font-size:${S.size.growthCount}px}#${id} .ui-metric{height:88px}#${id} .ui-trend-bar{border-radius:${R.growthBar}px ${R.growthBar}px 0 0}`;
  if (isGrowth && !c.showValues) css += `#${id} .ui-metric{display:none}`;
  return css;
}

/** The count's text at t: GSAP textContent tweens snapped to whole numbers. */
export function chartCount(model: Model, t: number): string {
  let value = 0;
  for (const point of model.content.points) {
    if (t < point.time) break;
    value = Math.round(tween(t, {from: point.from, to: point.value, start: point.time, duration: .38, ease: 'power2.out'}));
  }
  return String(value);
}

export const Chart: React.FC<ModuleProps> = ({model}) => {
  const t = useModuleTime(model);
  const {id, content: c} = model;
  const isGrowth = c.variant === 'growth';
  return (
    <ModuleShell model={model} t={t} css={chartCss(model)}>
      <h2 className="ui-title">{model.title}</h2>
      <p className="ui-note">{c.attribution}</p>
      <div className="ui-metric"><span id={`${id}-count`} className="ui-count">{chartCount(model, t)}</span><span className="ui-unit">{c.unit}</span></div>
      <div className="ui-chart">
        {c.points.map((point: any) => {
          const column = isGrowth ? fromTo(t, {opacity: 0, y: 10}, {opacity: 1, y: 0}, point.time, .24, 'power3.out') : null;
          const scaleY = fromTo(t, 0, 1, point.time, .38, 'power3.out');
          return (
            <div key={point.index} id={isGrowth ? `${id}-column-${point.index}` : undefined} className="ui-column"
              style={column ? {opacity: column.opacity, transform: transform({y: column.y})} : undefined}>
              <div className="ui-bar-track"><div id={`${id}-bar-${point.index}`} className="ui-trend-bar" style={{height: `${point.barHeight}px`, transform: transform({scaleY})}} /></div>
              <span className="ui-point-label">{point.label}</span>
            </div>
          );
        })}
      </div>
    </ModuleShell>
  );
};

export const TrendChart = Chart;
export default Chart;
