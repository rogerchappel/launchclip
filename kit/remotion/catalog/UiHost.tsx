// A ui-scene host (kit/core/ui-runtime.mjs): the same pure painter HyperFrames
// inlines, called with the absolute scene time in a layout effect, so the
// host's HTML is written before the frame is captured.
import React, {useLayoutEffect, useRef} from 'react';
// @ts-ignore plain ESM core module
import {paintUi} from '@launchclip/core/ui-runtime.mjs';

export const UiHost: React.FC<{id: string; spec: unknown; t: number; style?: React.CSSProperties; attrs: Record<string, unknown>}> = ({id, spec, t, style, attrs}) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) paintUi(ref.current, spec, t);
  }, [spec, t]);
  return <div ref={ref} id={id} style={style} {...attrs} />;
};
