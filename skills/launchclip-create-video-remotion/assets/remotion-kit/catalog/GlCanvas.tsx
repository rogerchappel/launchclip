// A GL generator background (kit/core/gl-backgrounds.mjs): one WebGL2 canvas
// over the layer's box, painted in a layout effect with the absolute time by
// the same painter HyperFrames inlines.
import React, {useLayoutEffect, useRef} from 'react';
// @ts-ignore plain ESM core module
import {paintGl} from '../../core/gl-backgrounds.mjs';

export const GlCanvas: React.FC<{plan: any; t: number}> = ({plan, t}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (ref.current) paintGl(ref.current, plan, t);
  }, [plan, t]);
  return <canvas ref={ref} width={plan.w} height={plan.h} data-launchclip-gl={plan.kind} style={{position: 'absolute', left: 0, top: 0, width: '100%', height: '100%'}} />;
};
