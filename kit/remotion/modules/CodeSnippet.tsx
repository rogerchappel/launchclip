// code-snippet: label row (unless hidden), then up to three lines that slide in at
// their time; with typing, every character appears at its charTime.
import React from "react";
// @ts-ignore plain ESM core, bundled by Remotion
import { tween } from "@launchclip/core/motion.mjs";
import { BOX, C, F, Model, Section, Title, inFlight, palette, transform, useModuleTime, visible } from "./shell-b";

export const CodeSnippet: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  if (!visible(model, t)) return null;
  const c = model.content, p = palette(model), theme = model.theme;
  const colour: Record<string, string | undefined> = p.custom
    ? { keyword: theme.accentText, string: theme.muted, number: theme.accentText, comment: theme.muted, operator: theme.foreground }
    : { keyword: C.token.keyword, string: C.token.string, number: model.accent, comment: C.token.comment, operator: C.token.operator };
  return (
    <Section model={model} t={t}>
      <Title model={model} />
      {c.label !== null && <p style={{ ...BOX, font: `22px/1.3 ${F.mono}`, margin: 0, padding: "0 24px 16px", color: p.custom ? theme.muted : C.codeLanguage }}>{c.label}</p>}
      <pre style={{ ...BOX, margin: 0, padding: "0 24px 24px", font: `${c.codeFont}px/1.5 ${F.mono}` }}>
        {c.lines.map((line: any) => {
          // tl.fromTo(line, {opacity:0,x:12}, {opacity:1,x:0,duration:0.24,ease:'power3.out'}, line.time)
          const enter = tween(t, { from: { opacity: 0, x: 12 }, to: { opacity: 1, x: 0 }, start: line.time, duration: c.durations.line, ease: "power3.out" });
          let character = 0;
          return (
            <span key={line.index} style={{ ...BOX, display: "block", height: c.lineHeight, whiteSpace: "pre", opacity: enter.opacity, transform: transform({ x: enter.x }, inFlight(t, [{ time: line.time, duration: c.durations.line }])) }}>
              {line.tokens.map((token: any, k: number) => (
                <span key={k} style={{ ...BOX, color: colour[token.type] }}>
                  {c.typing
                    ? token.chars.map((char: string) => {
                        const j = character++;
                        // tl.to(char, {opacity:1,duration:0.001,ease:'none'}, charTimes[j])
                        const opacity = tween(t, { from: 0, to: 1, start: line.charTimes[j], duration: 0.001, ease: "none" });
                        return <span key={j} style={{ ...BOX, opacity }}>{char}</span>;
                      })
                    : token.text}
                </span>
              ))}
            </span>
          );
        })}
      </pre>
    </Section>
  );
};
