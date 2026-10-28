// excerpt-window: a text excerpt in a window frame. At focus.time the text
// block zooms onto the focus line, while highlighted segments either sweep a
// fill in from the left or fade their background in.
import React from "react";
// @ts-ignore plain ESM core, bundled by Remotion
import { tween } from "@launchclip/core/motion.mjs";
import { BOX, F, Model, R, S, Section, WindowBar, inFlight, palette, scaleX, transform, useModuleTime, visible } from "./shell-b";

export const ExcerptWindow: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  if (!visible(model, t)) return null;
  const c = model.content, p = palette(model), focus = c.focus, highlight = c.highlight, sweep = c.highlightMotion;
  // tl.to(content, {x,y,scale,duration:0.5,ease:'power3.inOut'}, focus.time) after a set to {x:0,y:0,scale:1}
  const zoom = tween(t, { from: { x: 0, y: 0, scale: 1 }, to: { x: focus.x, y: focus.y, scale: focus.scale }, start: focus.time, duration: focus.duration, ease: "power3.inOut" });
  // sweep: tl.to(fill, {scaleX:1,duration,ease:'power2.inOut'}, time)
  const sweepScale = tween(t, { from: 0, to: 1, start: highlight.time, duration: highlight.duration, ease: "power2.inOut" });
  // fade: tl.to(highlight, {backgroundColor,duration,ease:'power2.out'}, time), from transparent (rgba(0,0,0,0))
  const fadeColour = tween(t, { from: "#00000000", to: highlight.color.toLowerCase(), start: highlight.time, duration: highlight.duration, ease: "power2.out" });
  return (
    <Section model={model} t={t}>
      <WindowBar model={model} bar={c.bar} />
      <div style={{ ...BOX, position: "absolute", top: c.noteRect.y, left: 0, right: 0, padding: "16px 24px 0", fontSize: S.size.small, lineHeight: 1.3, color: p.muted }}>{c.note}</div>
      <div style={{ ...BOX, position: "absolute", left: c.viewport.x, right: 24, top: c.viewport.y, bottom: 24, overflow: "hidden" }}>
        <div style={{ ...BOX, width: c.textWidth, height: c.textHeight, font: `${c.textFont}px/1.5 ${F.mono}`, transformOrigin: "top left", transform: transform(zoom, inFlight(t, [focus])) }}>
          {c.lines.map((line: any, i: number) => (
            <div key={i} style={{ ...BOX, height: c.lineHeight, whiteSpace: "pre" }}>
              {line.segments.map((segment: any, k: number) => {
                if (segment.highlight && sweep) {
                  return (
                    <span key={k} style={{ ...BOX, background: "transparent", borderRadius: R.highlight, position: "relative", display: "inline-block" }}>
                      <span style={{ ...BOX, position: "absolute", inset: 0, background: highlight.color, borderRadius: R.highlight, transformOrigin: "left center", transform: scaleX(sweepScale, inFlight(t, [highlight])) }} />
                      <span style={{ ...BOX, position: "relative" }}>{segment.text}</span>
                    </span>
                  );
                }
                return segment.highlight
                  ? <span key={k} style={{ ...BOX, background: fadeColour, borderRadius: R.highlight }}>{segment.text}</span>
                  : <span key={k} style={BOX}>{segment.text}</span>;
              })}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
};
