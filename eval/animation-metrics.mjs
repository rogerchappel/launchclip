// The animation scorecard's metrics (docs/ANIMATION_PIPELINE_RFC.md §8.3):
// what one finished character Short scores from the files it leaves, how it is
// judged against its brief, and how two paths compare.
//
//   animationMetrics(inputs)            → {contracts, story, design, direction, cadence, gates, critic, cost}
//   scoreAnimation(brief, metrics, suite) → {id, format, label, checks, score, status}
//   formatAnimationScorecard(results)   → the table the runner prints
//   compareAnimation(make, skill)       → {rows, gates, critic, parity}
//   parityMarkdown({briefs, make, skill}) → benchmarks/ANIMATION_PARITY.md
//   flatMetrics(metrics)                → the numeric metrics parity compares
//
// inputs: {script, shots, duration, words, format, profile, storyMeasures,
// skeleton, validation, scriptGate, bibleGate, bible, make, gates, critic,
// retakes}: everything already read (eval/formats.mjs readAnimationProject
// reads the project). Pure: nothing here reads a file, renders or calls a
// model. A metric the project cannot answer is null, never a guess.

import { characterMeasures } from '@launchclip/core/cadence.mjs';
import { compareMeasures } from '@launchclip/core/profiles.mjs';

export const ANIMATION_SCORECARD_SCHEMA = 'launchclip.animation-scorecard.v1';
export const ANIMATION_PARITY_SCHEMA = 'launchclip.animation-parity.v1';
// make is at parity when every numeric metric is within this share of the skill's (MAKE_SKILL_PARITY.md).
export const ANIMATION_PARITY_TOLERANCE = 0.15;
// The contracts a finished animation project holds (RFC §4), in pipeline order.
export const ANIMATION_CONTRACTS = Object.freeze(['script', 'bible', 'direction', 'storyboard']);
const NARRATOR = 'narrator';
const VERDICTS = ['ship', 'repair', 'replan'];

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, places = 3) => (finite(value) ? Math.round(value * 10 ** places) / 10 ** places : null);
const list = (value) => (Array.isArray(value) ? value : []);

function scriptLines(script) {
  const out = [];
  for (const beat of list(script?.beats)) for (const line of list(beat?.lines)) if (line && typeof line === 'object') out.push({ ...line, beat: beat.beat ?? null });
  return out;
}

/** Story: who has the lines, how much is silent, when the problem lands. */
export function storyMetrics(script, measures = null) {
  if (!script) return null;
  const lines = scriptLines(script);
  const spoken = lines.filter((line) => typeof line.speaker === 'string' && line.speaker);
  const silent = lines.filter((line) => line.speaker === null);
  const characters = list(script.characters).map((character) => character?.id).filter(Boolean);
  const per = Object.fromEntries([...characters, NARRATOR].map((id) => [id, spoken.filter((line) => line.speaker === id).length]));
  if (!per[NARRATOR]) delete per[NARRATOR];
  const shares = characters.map((id) => (spoken.length ? per[id] / spoken.length : 0));
  return {
    characters: characters.length,
    lines: lines.length,
    spoken_lines: spoken.length,
    silent_lines: silent.length,
    silent_share: lines.length ? round(silent.length / lines.length) : null,
    narrator_share: spoken.length ? round((per[NARRATOR] ?? 0) / spoken.length) : null,
    lines_per_character: per,
    quietest_share: shares.length ? round(Math.min(...shares)) : null,
    problem_lands_seconds: measures?.problem_lands_seconds ?? null
  };
}

/** Design: how many characters the bible holds, and whether each one's must_keep list is its own. */
export function designMetrics(bible) {
  const characters = list(bible?.cast?.characters);
  if (!characters.length) return null;
  const keys = characters.map((character) => JSON.stringify([...list(character?.must_keep)].map(String).sort()));
  return {
    characters: characters.length,
    with_must_keep: characters.filter((character) => list(character?.must_keep).length > 0).length,
    must_keep_distinct: characters.length < 2 ? null : new Set(keys).size === keys.length
  };
}

/** Direction: how much acting the shot list holds. */
export function directionMetrics(shots, { duration }) {
  const all = list(shots);
  if (!all.length || !(duration > 0)) return null;
  const poses = new Set(), expressions = new Set(), framings = new Set();
  let actions = 0, lines = 0, onReaction = 0;
  for (const shot of all) {
    if (shot.framing) framings.add(shot.framing);
    actions += list(shot.actions).length;
    const states = Object.entries(shot.poses ?? {});
    for (const [, entries] of states) for (const state of list(entries)) {
      if (state.pose) poses.add(state.pose);
      if (state.expression) expressions.add(state.expression);
      if (state.shot) framings.add(state.shot);
    }
    for (const line of list(shot.lines)) {
      if (!line?.speaker || line.speaker === NARRATOR) continue;
      lines += 1;
      const listeners = states.filter(([id]) => id !== line.speaker);
      const unseen = !list(shot.who).includes(line.speaker) && listeners.length > 0;
      const reacts = listeners.some(([, entries]) => list(entries).some((state, index) => index > 0 && state.at >= line.start - 0.1 && state.at <= line.end + 0.1));
      if (unseen || reacts) onReaction += 1;
    }
  }
  return {
    shots: all.length,
    actions_per_min: round(actions / (duration / 60), 2),
    poses: poses.size,
    expressions: expressions.size,
    framings: framings.size,
    framings_used: [...framings].sort(),
    reaction_line_share: lines ? round(onReaction / lines) : null
  };
}

function contract(status, extra = {}) {
  return { status, ...extra };
}

/** Everything one finished project scores. */
export function animationMetrics(inputs = {}) {
  const { script = null, shots = [], duration = null, words = [], format = null, profile = null, storyMeasures = null, validation = null, bible = null, make = null, gates = null, critic = null, retakes = null } = inputs;
  const measures = duration > 0 ? { ...(storyMeasures ?? {}), ...characterMeasures(shots, { duration, words, script }) } : null;
  const bands = measures && profile ? compareMeasures(measures, profile) : [];
  const directionErrors = list(validation?.errors).filter((entry) => /^direction:/.test(String(entry)));
  const storyErrors = list(validation?.errors).filter((entry) => !/^direction:/.test(String(entry)));
  const gateStatus = (gate) => (!gate || gate.status === 'skipped' ? 'missing' : gate.status === 'passed' ? 'valid' : 'invalid');
  const passes = list(make?.script?.passes);
  const recorded = gates && typeof gates === 'object' ? Object.entries(gates).filter(([, gate]) => gate && typeof gate === 'object' && typeof gate.status === 'string') : null;
  const findings = list(critic?.findings);
  const started = Date.parse(make?.started_at ?? ''), finished = Date.parse(make?.finished_at ?? '');
  return {
    video: { duration_seconds: round(duration), width: format?.width ?? null, height: format?.height ?? null, aspect: format?.width && format?.height ? (format.height > format.width ? '9:16' : format.width > format.height ? '16:9' : '1:1') : null, skeleton: inputs.skeleton ?? null },
    contracts: {
      script: contract(gateStatus(inputs.scriptGate), { errors: list(inputs.scriptGate?.rules), repairs: make ? passes.filter((pass) => pass?.kind === 'repair').length : null }),
      bible: contract(gateStatus(inputs.bibleGate), { errors: list(inputs.bibleGate?.findings).length, frozen: bible ? bible.frozen === true : null }),
      direction: contract(validation?.direction === false ? 'missing' : directionErrors.length ? 'invalid' : validation ? 'valid' : 'missing', { errors: directionErrors.length }),
      storyboard: contract(!validation ? 'missing' : storyErrors.length ? 'invalid' : 'valid', { errors: storyErrors.length, repairs: finite(make?.repairs?.passes) ? make.repairs.passes : finite(make?.repairs) ? make.repairs : null })
    },
    story: storyMetrics(script, measures),
    design: designMetrics(bible),
    direction: directionMetrics(shots, { duration }),
    cadence: measures ? {
      profile: profile?.id ?? null,
      provenance: profile?.provenance?.kind ?? null,
      measures: Object.fromEntries(Object.entries(measures).filter(([name]) => !['counts', 'framings', 'intervals', 'reset_times', 'lane', 'duration_seconds'].includes(name)).map(([name, value]) => [name, value && typeof value === 'object' ? value.p50 ?? null : value])),
      counts: measures.counts,
      bands: bands.map(({ measure, status, value, band, target }) => ({ measure, status, value, band, target })),
      outside: bands.filter((band) => band.status !== 'inside').map((band) => band.detail)
    } : null,
    // qa/finish/gates.json is the last finish. It is the first render only when no retake has run since.
    gates: recorded ? { passed: recorded.filter(([, gate]) => gate.status === 'passed').map(([name]) => name).sort(), failed: recorded.filter(([, gate]) => gate.status === 'failed').map(([name]) => name).sort(), not_checked: recorded.filter(([, gate]) => !['passed', 'failed'].includes(gate.status)).map(([name]) => name).sort(), retake_rounds_before: list(retakes?.rounds).length || null } : null,
    critic: critic && typeof critic === 'object' ? { verdict: VERDICTS.includes(critic.verdict) ? critic.verdict : null, blocking: findings.filter((finding) => finding?.severity === 'blocking').length, major: findings.filter((finding) => finding?.severity === 'major').length, findings: findings.length, retake_rounds: retakes ? list(retakes.rounds).length : null } : null,
    cost: make ? { status: make.status ?? null, estimated_usd: finite(make.costs?.estimated_usd) ? make.costs.estimated_usd : null, complete: make.costs?.complete ?? null, seconds: finite(started) && finite(finished) && finished >= started ? round((finished - started) / 1000, 1) : null } : null
  };
}

/** A brief's checks against one project's metrics. suite: {duration_seconds: [min, max], aspect}. */
export function scoreAnimation(brief, metrics, suite = {}) {
  const checks = [];
  const add = (id, status, value, want) => checks.push({ id, status, value, want });
  const expect = brief.expect ?? {};
  for (const name of ANIMATION_CONTRACTS) {
    const entry = metrics.contracts[name];
    add(`contract_${name}`, entry.status === 'valid' ? 'pass' : entry.status === 'missing' ? 'warn' : 'fail', entry.status === 'invalid' && list(entry.errors).length ? `invalid: ${entry.errors.join(', ')}` : entry.status, 'valid');
  }
  const [min, max] = suite.duration_seconds ?? [null, null];
  const seconds = metrics.video.duration_seconds;
  if (finite(min) && finite(max)) add('length', !finite(seconds) ? 'n/a' : seconds >= min && seconds <= max ? 'pass' : seconds >= min * 0.85 && seconds <= max * 1.15 ? 'warn' : 'fail', seconds, `${min}–${max} s`);
  if (suite.aspect) add('aspect', metrics.video.aspect === null ? 'n/a' : metrics.video.aspect === suite.aspect ? 'pass' : 'fail', metrics.video.aspect, suite.aspect);
  const story = metrics.story;
  if (expect.characters !== undefined) add('characters', !story ? 'n/a' : story.characters === expect.characters ? 'pass' : 'fail', story?.characters ?? null, String(expect.characters));
  if (expect.skeleton) add('skeleton', metrics.video.skeleton === expect.skeleton ? 'pass' : metrics.video.skeleton ? 'fail' : 'warn', metrics.video.skeleton ?? 'none', expect.skeleton);
  const range = (id, value, bounds, unit = '') => {
    if (!bounds) return;
    const low = bounds.min ?? -Infinity, high = bounds.max ?? Infinity;
    const want = bounds.min !== undefined && bounds.max !== undefined ? `${bounds.min}–${bounds.max}${unit}` : bounds.min !== undefined ? `≥ ${bounds.min}${unit}` : `≤ ${bounds.max}${unit}`;
    add(id, !finite(value) ? 'n/a' : value >= low && value <= high ? 'pass' : 'fail', value ?? null, want);
  };
  range('silent_share', story?.silent_share, expect.silent_share);
  range('spoken_lines', story?.spoken_lines, expect.spoken_lines);
  range('narrator_share', story?.narrator_share, expect.narrator_share);
  range('quietest_share', story?.quietest_share, expect.quietest_share);
  range('speaker_turns', metrics.cadence?.measures?.speaker_turns_per_min, expect.speaker_turns_per_min, '/min');
  range('expression_changes', metrics.cadence?.measures?.expression_changes_per_min, expect.expression_changes_per_min, '/min');
  if (metrics.design) add('must_keep', metrics.design.must_keep_distinct === null ? 'n/a' : metrics.design.must_keep_distinct ? 'pass' : 'fail', metrics.design.must_keep_distinct, 'each character its own');
  if (metrics.cadence) {
    const outside = metrics.cadence.bands.filter((band) => band.status !== 'inside').map((band) => band.measure);
    add('cadence', !metrics.cadence.bands.length ? 'n/a' : !outside.length ? 'pass' : outside.length <= 2 ? 'warn' : 'fail', outside.length ? outside.join(', ') : `${metrics.cadence.bands.length} inside`, `${metrics.cadence.profile ?? 'profile'} bands${metrics.cadence.provenance === 'seed' ? ' (seed)' : ''}`);
  }
  add('gates', !metrics.gates ? 'n/a' : metrics.gates.failed.length ? 'fail' : 'pass', metrics.gates ? (metrics.gates.failed.length ? metrics.gates.failed.join(', ') : `${metrics.gates.passed.length} passed`) : null, 'none failed');
  add('critic', !metrics.critic?.verdict ? 'n/a' : metrics.critic.verdict === 'ship' ? 'pass' : metrics.critic.verdict === 'repair' ? 'warn' : 'fail', metrics.critic?.verdict ?? null, 'ship');
  const judged = checks.filter((check) => check.status !== 'n/a');
  const points = judged.reduce((sum, check) => sum + (check.status === 'pass' ? 1 : check.status === 'warn' ? 0.5 : 0), 0);
  return { id: brief.id, format: brief.format ?? 'animated', label: brief.label, checks, score: judged.length ? Math.round((points / judged.length) * 100) : null, status: judged.some((check) => check.status === 'fail') ? 'fail' : judged.some((check) => check.status === 'warn') ? 'warn' : 'pass' };
}

const MARK = Object.freeze({ pass: '✓', warn: '~', fail: '✗', 'n/a': '·' });
const WORST = ['n/a', 'pass', 'warn', 'fail'];
// The checks every brief has; the rest are the brief's own expectations, shown as one column.
const COMMON_CHECKS = Object.freeze(['contract_script', 'contract_bible', 'contract_direction', 'contract_storyboard', 'length', 'aspect', 'must_keep', 'cadence', 'gates', 'critic']);

/**
 * The scorecard table: one row per brief. results: the report's results
 * ({id, status, score?}); a brief with no finished project reads "not run".
 */
export function formatAnimationScorecard(results) {
  const columns = [['script', ['contract_script']], ['bible', ['contract_bible']], ['direction', ['contract_direction']], ['storyboard', ['contract_storyboard']], ['length', ['length', 'aspect']], ['brief', null], ['design', ['must_keep']], ['cadence', ['cadence']], ['gates', ['gates']], ['critic', ['critic']]];
  const head = ['brief'.padEnd(14), 'score'.padStart(5), ...columns.map(([name]) => name.padEnd(10))].join(' ');
  const lines = [head, '-'.repeat(head.length)];
  const notes = [];
  for (const result of results) {
    if (!result.score) { lines.push(`${result.id.padEnd(14)} ${'–'.padStart(5)} ${result.status === 'error' ? 'error' : 'not run'}`); continue; }
    const checks = result.score.checks;
    const cells = columns.map(([, ids]) => {
      const own = checks.filter((check) => (ids ? ids.includes(check.id) : !COMMON_CHECKS.includes(check.id)));
      const worst = own.reduce((status, check) => (WORST.indexOf(check.status) > WORST.indexOf(status) ? check.status : status), 'n/a');
      return MARK[worst].padEnd(10);
    });
    lines.push([result.id.padEnd(14), String(result.score.score ?? '–').padStart(5), ...cells].join(' '));
    for (const check of checks) if (check.status === 'fail' || check.status === 'warn') notes.push(`  ${result.id}: ${check.id} ${check.value} (want ${check.want})`);
  }
  lines.push('', '✓ pass  ~ missing, or within 15% of the line  ✗ fail  · not recorded in the project', 'brief: the checks only that brief has (cast size, skeleton, how much is silent, how fast the turns come)');
  if (notes.length) lines.push('', 'misses:', ...notes);
  return lines.join('\n');
}

// The numeric metrics parity compares, in the RFC's order. gated: false rows are shown and never decide parity.
// better: 'lower' marks a count of things going wrong (repairs, blocking findings, retakes): fewer than the
// skill's is not a miss, as in eval/make-parity-metrics.mjs. Every other metric is held on both sides.
const PARITY_METRICS = Object.freeze([
  ['contracts.script.repairs', 'script repair passes', true, 'lower'],
  ['contracts.storyboard.repairs', 'storyboard repair passes', true, 'lower'],
  ['story.spoken_lines', 'spoken lines'],
  ['story.silent_share', 'share of silent lines'],
  ['story.quietest_share', 'quietest character\'s share of lines'],
  ['story.problem_lands_seconds', 'problem lands (s)'],
  ['design.characters', 'distinct characters'],
  ['direction.actions_per_min', 'actions per minute'],
  ['direction.poses', 'distinct poses'],
  ['direction.expressions', 'distinct expressions'],
  ['direction.reaction_line_share', 'share of lines played on a reaction'],
  ['direction.framings', 'framings used'],
  ['cadence.measures.scene_seconds', 'scene seconds (p50)'],
  ['cadence.measures.visual_changes_per_min', 'visual changes per minute'],
  ['cadence.measures.coverage', 'coverage'],
  ['cadence.measures.character_screen_time', 'character screen time'],
  ['cadence.measures.expression_changes_per_min', 'expression changes per minute'],
  ['cadence.measures.speaker_turns_per_min', 'speaker turns per minute'],
  ['cadence.measures.line_seconds', 'seconds per line (p50)'],
  ['cadence.measures.reaction_share', 'share of speech on a listener\'s reaction'],
  ['cadence.measures.longest_framing_seconds', 'longest stretch on one framing (s)'],
  ['critic.blocking', 'critic: blocking findings', true, 'lower'],
  ['critic.retake_rounds', 'retake rounds', true, 'lower'],
  ['cost.estimated_usd', 'model cost (USD)', false],
  ['cost.seconds', 'wall-clock (s)', false]
]);
export const ANIMATION_PARITY_METRICS = PARITY_METRICS.map(([key, label, gated = true, better = null]) => ({ key, label, gated, better }));

const dig = (object, key) => key.split('.').reduce((value, part) => (value === null || value === undefined ? undefined : value[part]), object);

/** {key: number | null} for every parity metric. */
export function flatMetrics(metrics) {
  return Object.fromEntries(ANIMATION_PARITY_METRICS.map(({ key }) => { const value = dig(metrics, key); return [key, finite(value) ? value : null]; }));
}

/**
 * make against the skill on one brief. A numeric metric is at parity when
 * make's is within `tolerance` of the skill's, or on the better side of it
 * for a count of failures (both zero is parity; a metric
 * either path could not measure is "unmeasured" and decides nothing). The
 * same gates must pass, and make's verdict must be no worse.
 */
export function compareAnimation(make, skill, { tolerance = ANIMATION_PARITY_TOLERANCE } = {}) {
  const a = flatMetrics(make), b = flatMetrics(skill);
  const rows = ANIMATION_PARITY_METRICS.map(({ key, label, gated, better }) => {
    const x = a[key], y = b[key];
    if (x === null || y === null) return { key, label, gated, make: x, skill: y, delta: null, status: 'unmeasured' };
    const delta = y === 0 ? (x === 0 ? 0 : null) : round((x - y) / Math.abs(y));
    const ok = (better === 'lower' && x <= y) || (y === 0 ? x === 0 : Math.abs(x - y) <= Math.abs(y) * tolerance + 1e-9);
    return { key, label, gated, make: x, skill: y, delta, status: ok ? 'within' : 'outside' };
  });
  const passed = (metrics) => (metrics.gates ? metrics.gates.passed : null);
  const gateDiff = passed(make) && passed(skill) ? { only_make: passed(make).filter((name) => !passed(skill).includes(name)), only_skill: passed(skill).filter((name) => !passed(make).includes(name)) } : null;
  const gates = { status: !gateDiff ? 'unmeasured' : gateDiff.only_make.length || gateDiff.only_skill.length ? 'differ' : 'same', ...(gateDiff ?? {}) };
  const rank = (metrics) => (metrics.critic?.verdict ? VERDICTS.indexOf(metrics.critic.verdict) : null);
  const critic = { make: make.critic?.verdict ?? null, skill: skill.critic?.verdict ?? null, status: rank(make) === null || rank(skill) === null ? 'unmeasured' : rank(make) <= rank(skill) ? 'no-worse' : 'worse' };
  const outside = rows.filter((row) => row.gated && row.status === 'outside').map((row) => row.key);
  const unmeasured = [...rows.filter((row) => row.gated && row.status === 'unmeasured').map((row) => row.key), ...(gates.status === 'unmeasured' ? ['gates'] : []), ...(critic.status === 'unmeasured' ? ['critic'] : [])];
  // Parity is claimed only when nothing failed and the gates and the critic were both measured.
  const parity = outside.length || gates.status === 'differ' || critic.status === 'worse' ? false : gates.status === 'same' && critic.status === 'no-worse' ? true : null;
  return { schema: ANIMATION_PARITY_SCHEMA, tolerance, rows, gates, critic, outside, unmeasured, parity };
}

const cell = (value) => (value === null || value === undefined ? '–' : String(value));

/**
 * The parity table. briefs: the suite's briefs; make, skill: each path's
 * scorecard report ({results: [{id, metrics}]}) or null when that path has
 * not been run. A brief either path has not finished is "not run"; no number
 * is ever filled in for it.
 */
export function parityMarkdown({ briefs, make = null, skill = null, generated = null, suite = {} }) {
  const find = (report, id) => list(report?.results).find((result) => result.id === id && result.metrics) ?? null;
  const pairs = briefs.map((brief) => ({ brief, make: find(make, brief.id), skill: find(skill, brief.id) }));
  const compared = pairs.map((pair) => (pair.make && pair.skill ? compareAnimation(pair.make.metrics, pair.skill.metrics) : null));
  const ran = compared.filter(Boolean).length;
  const verdict = (comparison) => (!comparison ? 'not run' : comparison.parity === true ? 'parity' : comparison.parity === false ? 'not at parity' : 'incomplete');
  const overall = !ran ? 'NOT YET RUN' : ran < briefs.length ? `PARTIAL: ${ran} of ${briefs.length} briefs run on both paths` : compared.every((comparison) => comparison.parity === true) ? 'AT PARITY' : compared.some((comparison) => comparison.parity === false) ? 'NOT AT PARITY' : 'INCOMPLETE: some metrics were not measured';
  const out = [
    '# Animation parity: `make` against the skill',
    '',
    '<!-- Generated by npm run eval:animation-parity (eval/animation-parity.mjs). Do not edit by hand: run it again. -->',
    '',
    `**Status: ${overall}.**`,
    '',
    !ran
      ? 'Neither path has been run on the six briefs, so every cell below is empty on purpose. The one-prompt animation run does not exist until the planning and animatic phases of docs/ANIMATION_PIPELINE_RFC.md land. Nothing here is an estimate.'
      : `Generated ${generated ?? 'from the two reports'}. make: ${make?.source ?? 'report'}; skill: ${skill?.source ?? 'report'}.`,
    '',
    `Method: docs/ANIMATION_PIPELINE_RFC.md §8.3. Each brief is a ${list(suite.duration_seconds).join('–') || '30–45'} second ${suite.aspect ?? '9:16'} Short, run once through \`launchclip make --animation\` and once through the create-video skill, and scored from the files each run leaves (docs/ANIMATION_MEASUREMENT.md). make is at parity on a brief when every numeric metric is within ${Math.round(ANIMATION_PARITY_TOLERANCE * 100)}% of the skill's (fewer repair passes, blocking findings or retake rounds than the skill is not a miss), the same gates pass, and the critic's verdict is no worse. Cost and wall-clock time are shown and do not decide parity.`,
    '',
    '## Summary',
    '',
    '| # | Brief | make | skill | Metrics outside 15% | Gates | Critic (make / skill) | Result |',
    '|---|---|---|---|---|---|---|---|'
  ];
  pairs.forEach((pair, index) => {
    const comparison = compared[index];
    const side = (result) => (result ? `${result.score?.score ?? '–'} (${result.score?.status ?? 'scored'})` : 'not run');
    out.push(`| ${index + 1} | ${pair.brief.label} (\`${pair.brief.id}\`) | ${side(pair.make)} | ${side(pair.skill)} | ${comparison ? (comparison.outside.length ? comparison.outside.length : 0) : '–'} | ${comparison ? comparison.gates.status : '–'} | ${comparison ? `${cell(comparison.critic.make)} / ${cell(comparison.critic.skill)}` : '–'} | ${verdict(comparison)} |`);
  });
  out.push('');
  pairs.forEach((pair, index) => {
    const comparison = compared[index];
    out.push(`## ${index + 1}. ${pair.brief.label} (\`${pair.brief.id}\`)`, '', `> ${pair.brief.brief}`, '', `Exercises: ${list(pair.brief.exercises).join('; ')}.`, '');
    if (!comparison) out.push(`Not run: ${!pair.make && !pair.skill ? 'neither path has a finished project for this brief' : !pair.make ? 'make has no finished project for this brief' : 'the skill has no finished project for this brief'}.`, '');
    out.push('| Metric | make | skill | Δ | Within 15% |', '|---|---|---|---|---|');
    const a = pair.make ? flatMetrics(pair.make.metrics) : null, b = pair.skill ? flatMetrics(pair.skill.metrics) : null;
    for (const metric of ANIMATION_PARITY_METRICS) {
      const row = comparison?.rows.find((entry) => entry.key === metric.key);
      const delta = row && row.delta !== null ? `${row.delta > 0 ? '+' : ''}${Math.round(row.delta * 100)}%` : '–';
      const within = !row ? '–' : !metric.gated ? 'shown only' : row.status === 'within' ? 'yes' : row.status === 'outside' ? '**no**' : 'unmeasured';
      out.push(`| ${metric.label} | ${cell(a?.[metric.key])} | ${cell(b?.[metric.key])} | ${delta} | ${within} |`);
    }
    const gates = (result) => (result?.metrics.gates ? `${result.metrics.gates.passed.length} passed${result.metrics.gates.failed.length ? `, failed: ${result.metrics.gates.failed.join(', ')}` : ''}` : '–');
    const contracts = (result) => (result ? ANIMATION_CONTRACTS.map((name) => `${name} ${result.metrics.contracts[name].status}`).join(', ') : '–');
    out.push(`| contracts | ${contracts(pair.make)} | ${contracts(pair.skill)} | – | ${comparison ? '' : '–'} |`);
    out.push(`| gates as finish recorded them | ${gates(pair.make)} | ${gates(pair.skill)} | – | ${comparison ? comparison.gates.status : '–'} |`);
    out.push(`| critic verdict | ${cell(pair.make?.metrics.critic?.verdict)} | ${cell(pair.skill?.metrics.critic?.verdict)} | – | ${comparison ? comparison.critic.status : '–'} |`, '');
  });
  return `${out.join('\n').trimEnd()}\n`;
}
