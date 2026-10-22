// audience-grid: viewer tiles rise in at their times and take the accent
// border.
import React from "react";
// @ts-ignore plain ESM core, bundled by Remotion
import { tween } from "../../core/motion.mjs";
import { BOX, Model, R, S, Section, Title, inFlight, palette, transform, useModuleTime, visible } from "./shell-b";

export const AudienceGrid: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  if (!visible(model, t)) return null;
  const c = model.content, p = palette(model);
  return (
    <Section model={model} t={t}>
      <Title model={model} />
      <p style={{ ...BOX, margin: 0, padding: "0 24px 20px", color: p.muted, fontSize: S.size.small, lineHeight: 1.3 }}>{c.note}</p>
      <div style={{ ...BOX, display: "grid", gridTemplateColumns: `repeat(${c.columns},minmax(0,1fr))`, gap: c.gap, padding: "0 24px 24px" }}>
        {c.tiles.map((tile: any) => {
          // tl.fromTo(tile, {opacity:0,y:8}, {opacity:1,y:0,borderColor:accent,duration:0.24,ease:'power3.out'}, time)
          const v = tween(t, { from: { opacity: 0, y: 8, borderColor: p.rowBorder }, to: { opacity: 1, y: 0, borderColor: model.accent.toLowerCase() },
            start: tile.time, duration: c.durations.tile, ease: "power3.out" });
          return (
            <div key={tile.index} style={{ ...BOX, height: c.cellHeight, padding: 16, border: `2px solid ${v.borderColor}`, borderRadius: R.viewer,
              background: p.rowSurface, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
              ...(p.custom ? { color: p.foreground } : {}), opacity: v.opacity, transform: transform({ y: v.y }, inFlight(t, [{ time: tile.time, duration: c.durations.tile }])) }}>
              <span style={{ ...BOX, fontSize: S.size.avatar, lineHeight: 1.1 }}>{tile.emoji}</span>
              <span style={{ ...BOX, fontSize: c.labelFont, textAlign: "center", overflowWrap: "break-word" }}>{tile.label}</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
};
