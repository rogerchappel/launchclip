// equation-lockup: typeset terms land one by one, one term can be boxed.
// Mirrors emitEquationLockup(); atoms share the core's class styles.
import React from "react";
import { AbsoluteFill } from "remotion";
import { Atoms, Lines, Model, N, Root, makeStyler, useModuleTime } from "./shared";

export const EquationLockup: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  const st = makeStyler(model, t);
  const c = model.content;
  return (
    <AbsoluteFill>
      <Root model={model} st={st}>
        <N model={model} st={st} node="glow" />
        {c.name ? <N model={model} st={st} node="name">{c.name}</N> : null}
        <N model={model} st={st} node="rule-top" />
        <N model={model} st={st} node="eq">
          {c.terms.map((term: any) => (
            <N key={term.index} model={model} st={st} node={`term-${term.index}`} as="span">
              {term.index === c.highlight ? <N model={model} st={st} node={`term-${term.index}-box`} as="span" /> : null}
              <N model={model} st={st} node={`term-${term.index}-text`} as="span"><Atoms model={model} atoms={term.atoms} /></N>
            </N>
          ))}
        </N>
        <N model={model} st={st} node="rule-bottom" />
        {c.note ? <N model={model} st={st} node="note"><Lines model={model} st={st} lines={c.noteLines} prefix="note-line" /></N> : null}
      </Root>
    </AbsoluteFill>
  );
};
