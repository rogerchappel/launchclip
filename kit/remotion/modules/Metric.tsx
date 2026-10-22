// metric and progress. Mirrors the emitter's metric/progress branch: the
// number steps through the model's 19 count-up text states, the first value
// fades from 0.7, and the progress fill eases between value/max scales.
import React from 'react';
import {C, R, S, ModuleShell, chain, fromTo, stepped, transform, useModuleTime, type ModuleProps, type Model} from './shared';

export function metricCss(model: Model): string {
  const {id, accent, content: c} = model;
  return `#${id} .ui-note{margin:0;padding:0 24px 20px;color:${C.muted};font-size:${S.size.small}px;line-height:1.3;overflow-wrap:break-word}#${id} .ui-number{margin:0;padding:0 24px 12px;font-size:${c.numberFont}px;font-weight:750;line-height:1.1;font-variant-numeric:tabular-nums;white-space:nowrap}#${id} .ui-number-unit{padding:0 24px 20px;font-size:${S.size.small}px;color:${C.muted}}#${id} .ui-progress-track{height:16px;margin:0 24px 24px;background:${C.track};border-radius:${R.track}px;overflow:hidden}#${id} .ui-progress-fill{height:100%;background:${accent};transform-origin:left}`;
}

/** Text shown by the number at t (the emitter's tl.set textContent states). */
export function metricText(model: Model, t: number): string {
  const c = model.content;
  const states: Array<{time: number; value: string}> = [];
  for (const value of c.values) if (value.index > 0) for (const frame of value.frames) states.push({time: frame.time, value: frame.text});
  return stepped(t, c.initialText, states);
}

export function progressScale(model: Model, t: number): number {
  const c = model.content;
  return chain(t, c.values[0].scale, c.values.filter((value: any) => value.index > 0)
    .map((value: any) => ({start: value.time, duration: .6, to: value.scale, ease: 'power2.out'})));
}

export const Metric: React.FC<ModuleProps> = ({model}) => {
  const t = useModuleTime(model);
  const {id, content: c} = model;
  const isMetric = c.variant === 'metric';
  const opacity = fromTo(t, .7, 1, c.values[0].time, .2);
  return (
    <ModuleShell model={model} t={t} css={metricCss(model)}>
      <h2 className="ui-title">{model.title}</h2>
      <p className="ui-note">{c.attribution}</p>
      <div id={`${id}-number`} className="ui-number" style={{opacity}}>{metricText(model, t)}</div>
      <div className="ui-number-unit">{c.unitText}</div>
      {isMetric ? null : (
        <div className="ui-progress-track"><div className="ui-progress-fill" style={{transform: transform({scaleX: progressScale(model, t)})}} /></div>
      )}
    </ModuleShell>
  );
};

export const Progress = Metric;
export default Metric;
