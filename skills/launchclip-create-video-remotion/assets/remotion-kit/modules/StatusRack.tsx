// status-rack: rows slide in at their first state; each state recolours the
// three indicator lights that changed.
import React from "react";
// @ts-ignore plain ESM core, bundled by Remotion
import { tween } from "../../core/motion.mjs";
import { BOX, C, F, Model, R, S, Section, Title, chain, inFlight, palette, transform, useModuleTime, visible } from "./shell-b";

export const StatusRack: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  if (!visible(model, t)) return null;
  const c = model.content, p = palette(model), theme = model.theme, d = c.durations;
  const lightOff = p.custom ? theme.border : C.light;
  return (
    <Section model={model} t={t}>
      <Title model={model} />
      <p style={{ ...BOX, fontSize: S.size.small, lineHeight: 1.3, color: p.muted, margin: 0, padding: "0 24px 20px" }}>{c.note}</p>
      <div style={{ ...BOX, display: "grid", gap: 8, padding: "0 24px 24px" }}>
        {c.rows.map((row: any) => {
          // tl.fromTo(row, {opacity:0,x:-10}, {opacity:1,x:0,duration:0.22,ease:'power3.out'}, states[0].time)
          const enter = tween(t, { from: { opacity: 0, x: -10 }, to: { opacity: 1, x: 0 }, start: row.states[0].time, duration: d.row, ease: "power3.out" });
          return (
            <div key={row.index} style={{ ...BOX, height: 44, border: `1px solid ${p.custom ? theme.border : C.rackBorder}`, borderRadius: R.rack,
              background: p.custom ? theme.surface : C.panel, display: "flex", alignItems: "center", gap: 12, padding: "0 12px", font: `22px/1.25 ${F.mono}`,
              ...(p.custom ? { color: theme.foreground } : {}), opacity: enter.opacity, transform: transform({ x: enter.x }, inFlight(t, [{ time: row.states[0].time, duration: d.row }])) }}>
              <span style={{ ...BOX, width: 22, height: 5, background: p.custom ? theme.border : C.rackMarker, flex: "none", borderRadius: R.marker }} />
              <span style={{ ...BOX, flex: 1, minWidth: 0, ...(p.custom ? { color: theme.foreground } : {}) }}>{row.label}</span>
              <span style={{ ...BOX, display: "flex", gap: 8 }}>
                {[0, 1, 2].map((j) => {
                  // tl.to(light, {backgroundColor, duration:0.18, ease:'power2.out'}, state.time) per change
                  const steps = row.states.flatMap((state: any) => state.changes.filter((change: any) => change.light === j)
                    .map((change: any) => ({ time: state.time, duration: d.light, ease: "power2.out", to: { background: change.color } })));
                  const { background } = chain(t, { background: lightOff }, steps);
                  return <span key={j} style={{ ...BOX, width: 18, height: 18, background, borderRadius: "50%", flex: "none" }} />;
                })}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
};
