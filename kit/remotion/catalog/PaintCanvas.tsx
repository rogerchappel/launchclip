// A catalogue canvas painted from a paint plan (kit/core/particles.mjs): the
// same pure painter HyperFrames inlines, called with the absolute scene time
// in a layout effect, so the canvas is drawn before the frame is captured.
import React, {useLayoutEffect, useRef} from 'react';
// @ts-ignore plain ESM core module
import {paintParticles} from '@launchclip/core/particles.mjs';

export const PaintCanvas: React.FC<{id: string; plan: unknown; t: number; style?: React.CSSProperties; attrs: Record<string, unknown>}> = ({id, plan, t, style, attrs}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) paintParticles(ctx, plan, t);
  }, [plan, t]);
  return <canvas ref={ref} id={id} style={style} {...attrs} />;
};
