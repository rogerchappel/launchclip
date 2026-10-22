// callout (plain and treated). Mirrors the emitter's callout branch.
import React from 'react';
import {C, F, R, SH, ModuleShell, Symbol, fromTo, transform, useModuleTime, type ModuleProps, type Model} from './shared';

function treatedCss(model: Model): string {
  const {id, accent, content: c} = model;
  const {font} = model.chrome;
  const family = c.monospace ? F.mono : 'inherit', inset = c.inset;
  let css = `#${id}{background:${C.panel};border-color:${C.panelBorder};border-radius:${R.editorial}px}#${id} .ui-callout-heading{display:flex;align-items:center;gap:12px;padding:${inset}px}#${id} .ui-title{padding:0;font-size:${font + 2}px;line-height:1.2;min-width:0;overflow-wrap:break-word;font-family:${family}}#${id} .ui-body{padding:0 ${inset}px ${inset}px;font-family:${family};line-height:1.3;color:${C.calloutBody}}#${id} .ui-emphasis{color:${accent};font-weight:700}#${id} .ui-underlined{position:relative;display:inline-block;white-space:nowrap}#${id} .ui-underline{position:absolute;left:0;right:0;bottom:-2px;height:2px;background:${accent};transform-origin:left center;display:block}#${id} .ui-symbol{width:${c.iconSize}px;height:${c.iconSize}px;flex:none;color:${C.foreground}}#${id} .ui-symbol svg{width:${c.iconSize}px;height:${c.iconSize}px;display:block}#${id} .ui-corner{position:absolute;width:18px;height:18px;pointer-events:none;border-color:${accent};border-style:solid;border-width:0;opacity:0}#${id} .ui-corner-tl{left:7px;top:7px;border-left-width:2px;border-top-width:2px}#${id} .ui-corner-tr{right:7px;top:7px;border-right-width:2px;border-top-width:2px}#${id} .ui-corner-bl{left:7px;bottom:7px;border-left-width:2px;border-bottom-width:2px}#${id} .ui-corner-br{right:7px;bottom:7px;border-right-width:2px;border-bottom-width:2px}`;
  if (c.monospace) css += `#${id} .ui-title{font:700 ${font + 2}px/1.2 ${F.mono}}#${id} .ui-body{font:${font}px/1.3 ${F.mono}}`;
  if (c.glow) css += `#${id}{box-shadow:${SH.treatedGlow} ${accent}${SH.treatedGlowAlpha},${SH.drop}}#${id} .ui-accent-edge{position:absolute;inset:0;border:1px solid ${accent};border-radius:${R.editorial}px;opacity:0;pointer-events:none}`;
  if (c.corners.length) css += `#${id}{overflow:visible}#${id} .ui-corner-tl{left:-8px;top:-8px}#${id} .ui-corner-tr{right:-8px;top:-8px}#${id} .ui-corner-bl{left:-8px;bottom:-8px}#${id} .ui-corner-br{right:-8px;bottom:-8px}`;
  return css;
}

const Treated: React.FC<{model: Model; t: number}> = ({model, t}) => {
  const {id, content: c} = model;
  const heading = fromTo(t, {opacity: 0, y: 6}, {opacity: 1, y: 0}, c.time, .28, 'power3.out');
  const copy = fromTo(t, {opacity: 0, y: 8}, {opacity: 1, y: 0}, c.copyTime, .3, 'power3.out');
  const icon = fromTo(t, {opacity: 0, scale: .86, rotation: -6}, {opacity: 1, scale: 1, rotation: 0}, c.time, .34, 'power3.out');
  const edge = fromTo(t, 0, .6, c.time, .4, 'power2.out');
  const underline = (time: number) => (t < model.start ? 1 : fromTo(t, 0, 1, time, .28, 'power3.out'));
  return (
    <ModuleShell model={model} t={t} css={treatedCss(model)}>
      <div className="ui-callout-heading">
        {c.icon ? (
          <span id={`${id}-symbol`} className="ui-symbol" aria-hidden="true" style={{opacity: icon.opacity, transform: transform({rotation: icon.rotation, scale: icon.scale})}}>
            <Symbol name={c.icon} />
          </span>
        ) : null}
        <h2 id={`${id}-heading`} className="ui-title" style={{opacity: heading.opacity, transform: transform({y: heading.y})}}>{model.title}</h2>
      </div>
      <p id={`${id}-copy`} className="ui-body" style={{opacity: copy.opacity, transform: transform({y: copy.y})}}>
        {c.segments
          ? c.segments.map((segment: any) => (
            <span key={segment.index} className={[segment.highlight ? 'ui-emphasis' : '', segment.underline ? 'ui-underlined' : ''].filter(Boolean).join(' ') || undefined}>
              {segment.text}
              {segment.underline ? (
                <span id={`${id}-underline-${segment.index}`} className="ui-underline" aria-hidden="true"
                  style={{transform: transform({scaleX: underline(segment.underline.time)})}} />
              ) : null}
            </span>
          ))
          : c.body}
      </p>
      {c.glow ? <div id={`${id}-edge`} className="ui-accent-edge" aria-hidden="true" style={{opacity: edge}} /> : null}
      {c.corners.map(({corner, time, from}: any) => {
        const value = fromTo(t, {opacity: 0, x: from.x, y: from.y}, {opacity: 1, x: 0, y: 0}, time, .28, 'power3.out');
        return <span key={corner} id={`${id}-corner-${corner}`} className={`ui-corner ui-corner-${corner}`} aria-hidden="true" style={{opacity: value.opacity, transform: transform({x: value.x, y: value.y})}} />;
      })}
    </ModuleShell>
  );
};

export const Callout: React.FC<ModuleProps> = ({model}) => {
  const t = useModuleTime(model);
  if (model.content.variant === 'treated') return <Treated model={model} t={t} />;
  return (
    <ModuleShell model={model} t={t}>
      <h2 className="ui-title">{model.title}</h2>
      <p className="ui-body">{model.content.body}</p>
    </ModuleShell>
  );
};

export default Callout;
