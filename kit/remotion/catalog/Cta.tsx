// cta: end card with an action line, a handle pill and a pulsing ring, with
// an optional loop ending. Mirrors emitCta().
import React from "react";
import { AbsoluteFill } from "remotion";
import { HeadlineWords, Lines, Model, N, Root, makeStyler, useModuleTime } from "./shared";

// SVG children are the core's CTA_ICONS strings; they are fixed local markup.
export const Cta: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  const st = makeStyler(model, t);
  const c = model.content;
  return (
    <AbsoluteFill>
      <Root model={model} st={st}>
        <N model={model} st={st} node="glow" />
        <N model={model} st={st} node="action" as="h2"><HeadlineWords model={model} st={st} lines={c.lines} glow={false} /></N>
        {c.detail ? <N model={model} st={st} node="detail"><Lines model={model} st={st} lines={c.detailLines} prefix="detail-line" /></N> : null}
        {c.handle ? (
          <N model={model} st={st} node="pill">
            <N model={model} st={st} node="ring" />
            <N model={model} st={st} node="pill-body">
              {c.icon !== "none" ? (
                <N model={model} st={st} node="icon" as="span" aria-hidden="true">
                  <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}
                    strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }} dangerouslySetInnerHTML={{ __html: c.iconPaths }} />
                </N>
              ) : null}
              <span>{c.handle}</span>
            </N>
          </N>
        ) : null}
      </Root>
    </AbsoluteFill>
  );
};
