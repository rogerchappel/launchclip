// step-rail. Mirrors the emitter's step-rail branch: each step brightens to
// the active colour over 0.18s and the rail fill eases (power2.inOut, 0.3s)
// to that step's fraction.
import React from 'react';
import {C, S, ModuleShell, chain, transform, useModuleTime, type ModuleProps, type Model} from './shared';

export function stepRailCss(model: Model): string {
  const {id, accent, content: c} = model;
  return c.numbered ? `#${id} .ui-step-number{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:${accent};color:${C.stepInk};font-size:${S.size.stepNumber}px;font-weight:750;margin-bottom:12px}` : '';
}

export function railFill(model: Model, t: number): number {
  return chain(t, 0, model.content.steps.map((step: any) => ({start: step.time, duration: .3, to: step.fill, ease: 'power2.inOut'})));
}

export const StepRail: React.FC<ModuleProps> = ({model}) => {
  const t = useModuleTime(model);
  const {id, content: c} = model;
  const baseColor = model.customTheme ? model.theme.foreground : C.foreground;
  return (
    <ModuleShell model={model} t={t} css={stepRailCss(model)}>
      <h2 className="ui-title">{model.title}</h2>
      <div className="ui-rail"><div className="ui-fill" style={{transform: transform({scaleX: railFill(model, t)}), transformOrigin: 'left center'}} /></div>
      <div className="ui-steps">
        {c.steps.map((step: any) => {
          const opacity = chain(t, .65, [{start: step.time, duration: .18, to: 1}]);
          const color = chain(t, baseColor, [{start: step.time, duration: .18, to: c.activeColor}]);
          return (
            <div key={step.index} id={`${id}-step-${step.index}`} className="ui-step" style={{opacity, color}}>
              {c.numbered ? <span className="ui-step-number">{step.number}</span> : null}
              {step.label}
            </div>
          );
        })}
      </div>
    </ModuleShell>
  );
};

export default StepRail;
