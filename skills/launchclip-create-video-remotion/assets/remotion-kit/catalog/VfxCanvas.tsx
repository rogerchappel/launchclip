// The VFX layer (kit/core/vfx): a story's effect cues on two art-sized
// canvases scaled up nearest-neighbour over the whole frame, the colour layer
// and the light layer added with plus-lighter, painted in a layout effect
// with the absolute story time by the same function HyperFrames inlines. A
// hit's words are brand-font text over them, styled by vfxWordAt as there.
import React, {useLayoutEffect, useRef} from 'react';
// @ts-ignore plain ESM core module
import {paintVfx, vfxWordAt, vfxWordBox} from '../../core/vfx/paint.mjs';

export const VfxCanvas: React.FC<{plan: any; t: number; zIndex: number}> = ({plan, t, zIndex}) => {
  const color = useRef<HTMLCanvasElement>(null), light = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = color.current?.getContext('2d'), l = light.current?.getContext('2d');
    if (c && l) paintVfx(c, l, plan, t);
  }, [plan, t]);
  const style = (blend?: 'plus-lighter'): React.CSSProperties => ({position: 'absolute', left: 0, top: 0, width: plan.aw * plan.grid, height: plan.ah * plan.grid, imageRendering: 'pixelated', pointerEvents: 'none', zIndex, ...(blend ? {mixBlendMode: blend} : {})});
  return (
    <>
      <canvas ref={color} width={plan.aw} height={plan.ah} data-launchclip-vfx="color" style={style()} />
      <canvas ref={light} width={plan.aw} height={plan.ah} data-launchclip-vfx="light" style={style('plus-lighter')} />
      {(plan.words ?? []).map((word: any, i: number) => (
        <div key={i} data-launchclip-vfx="word" aria-hidden="true" style={{...vfxWordBox(word, plan.grid), ...vfxWordAt(word, t, plan.grid), zIndex}}>{word.text}</div>
      ))}
    </>
  );
};
