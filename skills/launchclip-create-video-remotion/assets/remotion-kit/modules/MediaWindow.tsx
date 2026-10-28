// media-window: a local image or video under a window chrome bar. As in the
// HyperFrames emitter, the media and the chrome are separate boxes that share
// the chrome's top-left pivot (the media starts 48px below it), so they move
// as one window.
import React from "react";
import { Img, OffthreadVideo, useVideoConfig } from "remotion";
import { assetUrl } from "../media";
import { C, Model, Section, WindowBar, moduleMotion, palette, useModuleTime, visible } from "./shell-b";

export const MediaWindow: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  const { fps } = useVideoConfig();
  if (!visible(model, t)) return null;
  const c = model.content, box = c.mediaRect, p = palette(model);
  const style: React.CSSProperties = {
    position: "absolute", left: box.x, top: box.y, width: box.width, height: box.height, boxSizing: "border-box", objectFit: "contain",
    background: p.custom ? model.theme.surface : C.media, borderRadius: `0 0 ${c.mediaRadius}px ${c.mediaRadius}px`,
    ...moduleMotion(model, t, c.mediaTransformOrigin)
  };
  const src = assetUrl(c.media.src);
  return (
    <>
      {c.media.kind === "video"
        ? <OffthreadVideo src={src} muted trimBefore={Math.round(c.media.sourceStart * fps)} style={style} />
        : <Img src={src} alt={c.media.alt} style={style} />}
      <Section model={model} t={t}>
        <WindowBar model={model} bar={c.bar} />
      </Section>
    </>
  );
};
