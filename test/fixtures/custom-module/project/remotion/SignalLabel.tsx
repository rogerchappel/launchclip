// The Remotion form of SignalLabel (hyperframes/signal-label.html draws the
// same card). Frame-pure: everything comes from the frame and the props.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
// @ts-ignore plain ESM core shared with HyperFrames
import {brandFontStacks} from '@launchclip/core/fonts.mjs';
// @ts-ignore plain ESM core shared with HyperFrames
import {tween} from '@launchclip/core/motion.mjs';

type Props = {scene: any; params: any; brand: any; format: any; model: any};

export const SignalLabel: React.FC<Props> = ({params, brand, model}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = model.start + frame / fps;
  const colors = brand?.colors ?? {};
  const enter = {start: model.start + 0.2, duration: 0.5, ease: 'power3.out'};
  const opacity = tween(t, {from: 0, to: 1, ...enter});
  const y = tween(t, {from: 60, to: 0, ...enter});
  const grow = tween(t, {from: 0, to: 1, start: model.start, duration: model.duration, ease: 'none'});
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', left: 80, top: 600, width: 920, height: 360, borderRadius: 32, background: colors.paper, opacity, transform: `translateY(${y}px)`}}>
        <p style={{position: 'absolute', left: 48, top: 56, margin: 0, fontFamily: brandFontStacks(brand).display, fontSize: 96, lineHeight: 1.1, color: colors.ink, whiteSpace: 'nowrap'}}>{params.text}</p>
        <div style={{position: 'absolute', left: 48, top: 280, width: 824, height: 24, borderRadius: 12, background: colors.primary, transformOrigin: '0 50%', transform: `scaleX(${grow})`}} />
      </div>
    </AbsoluteFill>
  );
};

export default SignalLabel;
