// count-up: a big number counting over a window, then a hit. Mirrors
// emitCountUp(); the digits come from the model's discrete text frames.
import React from "react";
import { AbsoluteFill } from "remotion";
import { Lines, Model, N, Root, makeStyler, text, useModuleTime } from "./shared";

export const CountUp: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  const st = makeStyler(model, t);
  const c = model.content;
  return (
    <AbsoluteFill>
      <Root model={model} st={st}>
        <N model={model} st={st} node="glow" />
        <N model={model} st={st} node="number">
          {c.prefix ? <N model={model} st={st} node="prefix" as="span">{c.prefix}</N> : null}
          <N model={model} st={st} node="digits" as="span">{text(model, "digits", t)}</N>
          {c.suffix ? <N model={model} st={st} node="suffix" as="span">{c.suffix}</N> : null}
          {c.underline ? <N model={model} st={st} node="bar" /> : null}
          {c.spark ? (
            <N model={model} st={st} node="sparks">
              {c.sparks.map((item: any) => (
                <N key={item.index} model={model} st={st} node={`spark-${item.index}`}>
                  <N model={model} st={st} node={`spark-${item.index}-ray`} />
                </N>
              ))}
            </N>
          ) : null}
        </N>
        <N model={model} st={st} node="label"><Lines model={model} st={st} lines={c.labelLines} prefix="label-line" /></N>
        {c.note ? <N model={model} st={st} node="note">{c.note}</N> : null}
      </Root>
    </AbsoluteFill>
  );
};
