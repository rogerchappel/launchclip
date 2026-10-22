// kinetic-words: 1–3 words per beat, word-timed. Mirrors emitKineticWords().
import React from "react";
import { AbsoluteFill } from "remotion";
import { Model, N, Root, makeStyler, useModuleTime } from "./shared";

export const KineticWords: React.FC<{ model: Model }> = ({ model }) => {
  const t = useModuleTime(model);
  const st = makeStyler(model, t);
  return (
    <AbsoluteFill>
      <Root model={model} st={st}>
        {model.content.beats.map((beat: any) => {
          const node = `beat-${beat.index}`;
          return (
            <N key={beat.index} model={model} st={st} node={node}>
              <N model={model} st={st} node={`${node}-text`} as="span">
                {beat.lines.map((line: string, index: number) => (
                  <N key={index} model={model} st={st} node={`${node}-mask-${index}`} as="span">
                    <N model={model} st={st} node={`${node}-line-${index}`} as="span">{line}</N>
                  </N>
                ))}
              </N>
              {model.styles[`${node}-bar`] ? <N model={model} st={st} node={`${node}-bar`} /> : null}
            </N>
          );
        })}
      </Root>
    </AbsoluteFill>
  );
};
