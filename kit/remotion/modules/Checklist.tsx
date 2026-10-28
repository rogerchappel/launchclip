// checklist. Mirrors the emitter's checklist branch: status labels appear, the
// tick fades in (power2.out), active rows take the accent wash and border,
// and doneAt rows return to the surface with the tick drawn. In footage mode
// (content.typeIn) each row fades in on its time and its label steps through
// the same text sets the emitter's tl.set calls make.
import React from 'react';
// @ts-ignore plain ESM core module
import {TYPE_IN} from '@launchclip/core/editorial-core.mjs';
import {A, C, ModuleShell, TRANSPARENT, chain, stepped, useModuleTime, type ModuleProps, type Model, type Segment} from './shared';

export function rowState(model: Model, row: any, t: number) {
  const {accent, content: c} = model;
  const swap = .16, cut = .01;
  const pending: Segment[] = [], active: Segment[] = [], done: Segment[] = [], tick: Segment[] = [], wash: Segment[] = [], border: Segment[] = [];
  // A row that turns active or done at its time shows no status label before
  // it (the pending label would read as a state it never has).
  if (row.status !== 'pending') (row.status === 'active' ? active : done).push({start: row.time, duration: swap, to: 1});
  if (row.status === 'done') tick.push({start: row.time, duration: swap, to: 1, ease: 'power2.out'});
  if (row.status === 'active') {
    border.push({start: row.time, duration: swap, to: accent});
    wash.push({start: row.time, duration: swap, to: accent + A.wash});
  }
  if (row.doneTime !== null) {
    wash.push({start: row.doneTime, duration: swap, to: c.doneBackground});
    active.push({start: row.doneTime, duration: cut, to: 0});
    done.push({start: row.doneTime, duration: swap, to: 1});
    tick.push({start: row.doneTime, duration: swap, to: 1, ease: 'power2.out'});
  }
  const custom = model.customTheme;
  const typeIn = model.content.typeIn === true;
  return {
    opacity: typeIn ? chain(t, 0, [{start: row.time, duration: TYPE_IN.fade, to: 1}]) : undefined,
    label: typeIn ? stepped(t, '', row.typed.map((frame: any) => ({time: frame.time, value: frame.text}))) : row.label,
    pending: chain(t, row.status === 'pending' ? 1 : 0, pending), active: chain(t, 0, active), done: chain(t, 0, done), tick: chain(t, 0, tick),
    background: wash.length ? chain(t, custom ? model.theme.surface : TRANSPARENT, wash) : undefined,
    borderColor: border.length ? chain(t, custom ? model.theme.border : C.checkBorder, border) : undefined
  };
}

export const Checklist: React.FC<ModuleProps> = ({model}) => {
  const t = useModuleTime(model);
  const {id, accent, content: c} = model;
  const labels = c.statusLabels;
  return (
    <ModuleShell model={model} t={t}>
      <h2 className="ui-title">{model.title}</h2>
      {c.rows.map((row: any) => {
        const i = row.index, state = rowState(model, row, t);
        return (
          <div key={i} id={`${id}-row-${i}`} className="ui-row" style={{height: `${c.rowHeight}px`, ...(state.background ? {backgroundColor: state.background} : {}), ...(state.opacity !== undefined ? {opacity: state.opacity} : {})}}>
            <span className="ui-check" style={state.borderColor ? {borderColor: state.borderColor} : undefined}>
              <svg viewBox={c.check.viewBox} aria-hidden="true" style={{opacity: state.tick}}>
                <path d={c.check.path} fill="none" stroke={accent} strokeWidth={c.check.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span id={c.typeIn ? `${id}-label-${i}` : undefined} className="ui-label">{state.label}</span>
            <span className="ui-status">
              <span id={`${id}-status-${i}-pending`} style={{opacity: state.pending}}>{labels.pending}</span>
              <span id={`${id}-status-${i}-active`} style={{opacity: state.active, position: 'absolute', right: 0}}>{labels.active}</span>
              <span id={`${id}-status-${i}-done`} style={{opacity: state.done, position: 'absolute', right: 0}}>{labels.done}</span>
            </span>
          </div>
        );
      })}
    </ModuleShell>
  );
};

export default Checklist;
