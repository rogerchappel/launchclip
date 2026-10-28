// Shared helpers for the catalogue A components. Everything is a pure
// function of the current frame: t = useSceneTime(model.start), and each
// node's animated props come from sampleNode() (kit/core/catalog-a.mjs),
// which evaluates the model's tweens with kit/core/motion.mjs, the same
// tweens the HyperFrames emitter hands to GSAP.
import React from "react";
import { useSceneTime } from "../clock";
// @ts-ignore plain ESM core without type declarations
import { cssFromProps, nodeId, sampleNode, textAt } from "@launchclip/core/catalog-a.mjs";

export type Model = any;
export type Styler = (node: string) => React.CSSProperties;

/** Absolute composition time for the current frame (kit/remotion/clock.tsx). */
export function useModuleTime(model: Model): number {
  return useSceneTime(model.start);
}

/** node → static style plus the animated props at time t. */
export function makeStyler(model: Model, t: number): Styler {
  return (node: string) => ({ ...(model.styles[node] ?? {}), ...cssFromProps(sampleNode(model, node, t)) }) as React.CSSProperties;
}

export const text = (model: Model, node: string, t: number): string => textAt(model, node, t);
export const id = (model: Model, node: string): string => nodeId(model, node);

/** Node element with its DOM id (matching the HyperFrames markup) and style. */
export function N({ model, st, node, as = "div", children, ...rest }: { model: Model; st: Styler; node: string; as?: any; children?: React.ReactNode; [key: string]: any }) {
  const Tag = as;
  return <Tag id={nodeId(model, node)} style={st(node)} {...rest}>{children}</Tag>;
}

/** Module root: the catalogue element at absolute canvas coordinates. */
export function Root({ model, st, children }: { model: Model; st: Styler; children?: React.ReactNode }) {
  return <section id={model.id} data-module={model.module} style={st("root")}>{children}</section>;
}

/** Headline lines of inline-block words, spaces between words as in the HTML. */
export function HeadlineWords({ model, st, lines, glow }: { model: Model; st: Styler; lines: any[]; glow: boolean }) {
  return (
    <>
      {lines.map((line: any) => (
        <N key={line.index} model={model} st={st} node={`line-${line.index}`} as="span">
          {line.words.map((word: any, index: number) => {
            const node = `word-${word.index}`;
            const inner = !glow || typeof word.emphasis !== "number"
              ? word.text
              : (
                <>
                  <N model={model} st={st} node={`${node}-glow`} as="span" aria-hidden="true">{word.text}</N>
                  <N model={model} st={st} node={`${node}-text`} as="span">{word.text}</N>
                  <N model={model} st={st} node={`${node}-bar`} as="span" />
                </>
              );
            return (
              <React.Fragment key={word.index}>
                {index > 0 ? " " : null}
                <N model={model} st={st} node={node} as="span">{inner}</N>
              </React.Fragment>
            );
          })}
        </N>
      ))}
    </>
  );
}

/** Plain lines of text, one block span each. */
export function Lines({ model, st, lines, prefix }: { model: Model; st: Styler; lines: string[]; prefix: string }) {
  return <>{lines.map((line, index) => <N key={index} model={model} st={st} node={`${prefix}-${index}`} as="span">{line}</N>)}</>;
}

const cls = (model: Model, name: string): React.CSSProperties => (model.classes?.[name] ?? {}) as React.CSSProperties;

/** Equation atoms, the same structure and classes as the HyperFrames emitter. */
export function Atoms({ model, atoms }: { model: Model; atoms: any[] }) {
  return (
    <>
      {atoms.map((atom: any, index: number) => {
        if (atom.type === "frac") {
          return (
            <span key={index} className="a-frac" style={cls(model, "frac")}>
              <span className="a-frac-num" style={cls(model, "frac-num")}><Atoms model={model} atoms={atom.num} /></span>
              <span className="a-frac-bar" style={cls(model, "frac-bar")} />
              <span className="a-frac-den" style={cls(model, "frac-den")}><Atoms model={model} atoms={atom.den} /></span>
            </span>
          );
        }
        const name = atom.type === "op" ? (atom.wide ? "op-wide" : atom.unary ? "op-unary" : "op") : atom.type;
        return (
          <React.Fragment key={index}>
            <span className={`a-${name}`} style={cls(model, name)}>{atom.text}</span>
            {atom.sub ? <span className="a-sub" style={cls(model, "sub")}><Atoms model={model} atoms={atom.sub} /></span> : null}
            {atom.sup ? <span className="a-sup" style={cls(model, "sup")}><Atoms model={model} atoms={atom.sup} /></span> : null}
          </React.Fragment>
        );
      })}
    </>
  );
}
