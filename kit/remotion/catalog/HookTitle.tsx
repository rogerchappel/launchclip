// hook-title: frame-0 visible opening claim with kinetic emphasis words.
// Mirrors emitHookTitle() in kit/hyperframes/catalog-a.mjs node for node.
import React from "react";
import { AbsoluteFill } from "remotion";
import { HeadlineWords, Model, N, Root, makeStyler, useModuleTime } from "./shared";

export const HookTitle: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  const st = makeStyler(model, t);
  const c = model.content;
  return (
    <AbsoluteFill>
      <Root model={model} st={st}>
        <N model={model} st={st} node="glow" />
        {c.eyebrow ? <N model={model} st={st} node="eyebrow">{c.eyebrow}</N> : null}
        {c.eyebrow ? <N model={model} st={st} node="rule" /> : null}
        <N model={model} st={st} node="headline" as="h1"><HeadlineWords model={model} st={st} lines={c.lines} glow /></N>
        {c.kicker ? <N model={model} st={st} node="kicker">{c.kicker}</N> : null}
      </Root>
    </AbsoluteFill>
  );
};
