// date-card: accent month band, a large day that rises in at `time`, the
// title and an optional caption.
import React from "react";
// @ts-ignore plain ESM core, bundled by Remotion
import { tween } from "../../core/motion.mjs";
import { BOX, C, F, Model, S, Section, Title, inFlight, palette, transform, useModuleTime, visible } from "./shell-b";

export const DateCard: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  if (!visible(model, t)) return null;
  const c = model.content, p = palette(model);
  // tl.fromTo(day, {opacity:0,y:14,scale:0.94}, {opacity:1,y:0,scale:1,duration:0.32,ease:'power3.out'}, time)
  const day = tween(t, { from: { opacity: 0, y: 14, scale: 0.94 }, to: { opacity: 1, y: 0, scale: 1 }, start: c.time, duration: c.durations.day, ease: "power3.out" });
  return (
    <Section model={model} t={t}>
      <div style={{ ...BOX, height: c.bandHeight, background: model.accent, color: p.custom ? C.themedInk : C.monthInk, display: "grid", placeItems: "center",
        font: `700 22px/1.2 ${F.mono}`, letterSpacing: 2 }}>{c.monthLabel}</div>
      <div style={{ ...BOX, font: `800 ${S.size.day}px/1.1 ${F.display}`, textAlign: "center", height: c.dayHeight, paddingTop: 8,
        opacity: day.opacity, transform: transform(day, inFlight(t, [{ time: c.time, duration: c.durations.day }])) }}>{c.day}</div>
      <Title model={model} style={{ textAlign: "center", padding: "12px 20px" }} />
      {c.caption ? <p style={{ ...BOX, textAlign: "center", font: `22px/1.3 ${F.mono}`, margin: 0, padding: "0 20px 12px", color: p.muted }}>{c.caption}</p> : null}
    </Section>
  );
};
