// equation-lockup: typeset terms land one by one, one term can be boxed.
// Mirrors emitEquationLockup(); atoms share the core's class styles.
import React from "react";
import { AbsoluteFill } from "remotion";
import { Atoms, Lines, Model, N, Root, makeStyler, useModuleTime } from "./shared";

export const EquationLockup: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  const st = makeStyler(model, t);
  const c = model.content;
  const term = (item: any) => (
    <N key={item.index} model={model} st={st} node={`term-${item.index}`} as="span">
      {item.index === c.highlight ? <N model={model} st={st} node={`term-${item.index}-box`} as="span" /> : null}
      <N model={model} st={st} node={`term-${item.index}-text`} as="span"><Atoms model={model} atoms={item.atoms} /></N>
    </N>
  );
  return (
    <AbsoluteFill>
      <Root model={model} st={st}>
        <N model={model} st={st} node="glow" />
        {c.name ? <N model={model} st={st} node="name">{c.name}</N> : null}
        <N model={model} st={st} node="rule-top" />
        <N model={model} st={st} node="eq">
          {/* A long equation is set on two lines: each row is then its own block. */}
          {c.rows.length > 1
            ? c.rows.map((row: number[], index: number) => (
                <N key={index} model={model} st={st} node={`eq-row-${index}`} as="span">{row.map((at) => term(c.terms[at]))}</N>
              ))
            : c.terms.map(term)}
        </N>
        <N model={model} st={st} node="rule-bottom" />
        {c.note ? <N model={model} st={st} node="note"><Lines model={model} st={st} lines={c.noteLines} prefix="note-line" /></N> : null}
      </Root>
    </AbsoluteFill>
  );
};
