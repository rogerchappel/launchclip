// focus-flow: options arrive in a staggered row or column, distractors fade
// while the chosen option travels to the centre, then a progress bar fills.
import React from "react";
// @ts-ignore plain ESM core, bundled by Remotion
import { tween } from "../../core/motion.mjs";
import { A, BOX, Model, R, S, Section, SymbolIcon, Title, chain, inFlight, palette, scaleX, transform, useModuleTime, visible } from "./shell-b";

export const FocusFlow: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  if (!visible(model, t)) return null;
  const c = model.content, p = palette(model), d = c.durations, accent = model.accent.toLowerCase();
  // tl.to(progress, {opacity:1,duration:0.2}, progressTime): GSAP's default ease.
  const progress = tween(t, { from: 0, to: 1, start: c.progressTime, duration: d.progressFade, ease: "power1.out" });
  const fill = tween(t, { from: 0, to: 1, start: c.progressTime, duration: c.progressDuration, ease: "power2.inOut" });
  return (
    <Section model={model} t={t}>
      <Title model={model} />
      <p style={{ ...BOX, fontSize: S.size.small, lineHeight: 1.3, margin: 0, padding: "0 24px 20px", color: p.muted }}>{c.note}</p>
      <div style={{ ...BOX, position: "relative", height: c.stageHeight, margin: "0 24px" }}>
        {c.options.map((option: any) => {
          const arrive = { opacity: 0, x: option.initial.x, y: option.initial.y + 8, scale: 1, borderColor: p.rowBorder, background: p.rowSurface };
          // tl.fromTo(option, {opacity:0,x,y:y+8}, {opacity:1,x,y,duration:0.24,ease:'power3.out'}, arriveTime), then
          // chosen:      tl.to(option, {x,y,scale,borderColor,backgroundColor,duration:0.42,ease:'power3.inOut'}, chosenMoveTime)
          // distractor:  tl.to(option, {opacity:0,duration:0.16,ease:'power2.out'}, chooseTime)
          //              tl.to(option, {x,y,scale:0.94,duration:0.38,ease:'power3.inOut'}, chooseTime)
          const steps = [{ time: option.arriveTime, duration: d.arrive, ease: "power3.out", to: { opacity: 1, x: option.initial.x, y: option.initial.y } }];
          const target = { x: c.target.x, y: c.target.y };
          let v = chain(t, arrive, option.selected
            ? [...steps, { time: c.chosenMoveTime, duration: d.chosenMove, ease: "power3.inOut", to: { ...target, scale: c.chosenScale, borderColor: accent, background: accent + A.wash } }]
            : [...steps, { time: c.chooseTime, duration: d.distractorMove, ease: "power3.inOut", to: { ...target, scale: 0.94 } }]);
          const moving = inFlight(t, option.selected
            ? [{ time: option.arriveTime, duration: d.arrive }, { time: c.chosenMoveTime, duration: d.chosenMove }]
            : [{ time: option.arriveTime, duration: d.arrive }, { time: c.chooseTime, duration: d.distractorMove }]);
          if (!option.selected && t > c.chooseTime) {
            v = { ...v, opacity: tween(t, { from: 1, to: 0, start: c.chooseTime, duration: d.distractorFade, ease: "power2.out" }) };
          }
          return (
            <div key={option.index} style={{ ...BOX, position: "absolute", left: 0, top: 0, width: c.optionWidth, height: c.rowHeight, padding: "0 16px",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 12, border: `1px solid ${v.borderColor}`, borderRadius: R.focus,
              background: v.background, fontSize: c.optionFont, lineHeight: 1.25, textAlign: "center", ...(p.custom ? { color: p.foreground } : {}),
              opacity: v.opacity, transform: transform(v, moving) }}>
              {option.selected && c.icon ? <span style={{ ...BOX, width: 34, height: 34, flex: "none" }}><SymbolIcon name={c.icon} size={34} /></span> : null}
              <span style={{ ...BOX, minWidth: 0, overflowWrap: "break-word" }}>{option.label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ ...BOX, margin: "18px 24px 24px", opacity: progress }}>
        <div style={{ ...BOX, fontSize: S.size.small, lineHeight: 1.3, marginBottom: 12 }}>{c.progressLabel}</div>
        <div style={{ ...BOX, height: 12, borderRadius: R.focusTrack, background: p.track, overflow: "hidden" }}>
          <div style={{ ...BOX, height: "100%", background: model.accent, transformOrigin: "left center", transform: scaleX(fill, inFlight(t, [{ time: c.progressTime, duration: c.progressDuration }])) }} />
        </div>
      </div>
    </Section>
  );
};
