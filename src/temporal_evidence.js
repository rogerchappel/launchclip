import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const TEMPORAL_EVIDENCE_VERSION = "launchclip.temporal-evidence.v1";

const HOOK_TIMES = [0, .25, .5, .75, 1, 1.5, 2, 3, 4];
const CONTINUOUS_HANDOFFS = new Set(["continue", "transform"]);

export function buildTemporalEvidencePlan(plan, assembly = {}, options = {}) {
  const duration = Number(plan?.format?.duration_seconds ?? assembly?.duration_seconds);
  if (!(duration > 0)) throw new Error("Temporal evidence requires a positive production duration");
  const points = new Map();
  const maximumTime = Math.max(0, duration - Math.min(.05, duration / 2));
  const add = (seconds, role) => {
    const timestamp = round(clamp(Number(seconds), 0, maximumTime));
    if (!Number.isFinite(timestamp)) return;
    const key = timestamp.toFixed(3);
    const point = points.get(key) ?? { timestamp_seconds: timestamp, roles: [] };
    const roleKey = JSON.stringify(role);
    if (!point.roles.some((entry) => JSON.stringify(entry) === roleKey)) point.roles.push(role);
    points.set(key, point);
  };

  const hookWindow = Math.min(duration, Number(options.hookWindowSeconds ?? 4));
  for (const timestamp of HOOK_TIMES) {
    if (timestamp <= hookWindow + .001) add(timestamp, { type: "hook" });
  }

  for (const transition of assembly?.transitions ?? []) {
    const at = Number(transition.at_seconds);
    const transitionDuration = Math.max(0, Number(transition.duration_seconds ?? 0));
    const cut = transition.kind === "cut" || transitionDuration === 0;
    const padding = Math.max(.001, Number(options.transitionPaddingSeconds ?? .08));
    const offset = cut ? padding : Math.min(padding, transitionDuration / 4);
    const samples = cut
      ? [[at - offset, "before"], [at, "mid"], [at + offset, "after"]]
      : [[at - offset, "before"], [at + transitionDuration / 2, "mid"], [at + transitionDuration + offset, "after"]];
    for (const [timestamp, phase] of samples) {
      add(timestamp, {
        type: "transition",
        phase,
        from_shot_id: transition.from_shot_id,
        to_shot_id: transition.to_shot_id,
        at_seconds: round(at),
        duration_seconds: round(transitionDuration),
        kind: transition.kind ?? "unknown"
      });
    }
  }

  let previous = null;
  let activeSequence = null;
  for (const shot of plan?.shots ?? []) {
    const continuity = shot.visual?.continuity ?? {};
    const joinsPrevious = previous
      && activeSequence?.sequence_id === continuity.sequence_id
      && CONTINUOUS_HANDOFFS.has(previous.visual?.continuity?.handoff);
    if (!joinsPrevious) {
      if (activeSequence) add(Number(previous.end_seconds) - .12, { type: "sequence-settle", sequence_id: activeSequence.sequence_id, shot_id: previous.id });
      activeSequence = { sequence_id: continuity.sequence_id ?? shot.id };
      add(shot.start_seconds, { type: "sequence-entry", sequence_id: activeSequence.sequence_id, shot_id: shot.id });
    }
    add((Number(shot.start_seconds) + Number(shot.end_seconds)) / 2, { type: "shot-midpoint", shot_id: shot.id });
    for (const event of shot.visual?.events ?? []) {
      add(Number(shot.start_seconds) + Number(event.at_seconds), { type: "event", shot_id: shot.id, event_id: event.id });
    }
    previous = shot;
  }
  if (previous && activeSequence) add(Number(previous.end_seconds) - .12, { type: "sequence-settle", sequence_id: activeSequence.sequence_id, shot_id: previous.id });
  add(maximumTime, { type: "final-hold" });

  const ordered = [...points.values()].sort((left, right) => left.timestamp_seconds - right.timestamp_seconds);
  const bounded = boundOptionalEvidence(ordered, Number(options.maxFrames ?? 64));
  return bounded.map((point, index) => {
    const shot = activeShot(plan?.shots ?? [], point.timestamp_seconds);
    return {
      evidence_id: `temporal-${String(index + 1).padStart(3, "0")}`,
      timestamp_seconds: point.timestamp_seconds,
      shot_id: shot?.id ?? null,
      sequence_id: shot?.visual?.continuity?.sequence_id ?? null,
      roles: point.roles
    };
  });
}

export async function captureTemporalEvidence({ project, qaDir, plan, assembly = {}, snapshot, options = {} }) {
  if (typeof snapshot !== "function") throw new Error("Temporal evidence capture requires a snapshot adapter");
  const frames = path.resolve(options.output ?? path.join(qaDir, "snapshots"));
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  const evidence = buildTemporalEvidencePlan(plan, assembly, options);
  let check = await snapshot([
    "snapshot", "--at", evidence.map((entry) => entry.timestamp_seconds).join(","), "--no-end",
    "--output", frames, "--describe", "false", project
  ]);
  const files = check.ok
    ? (await readdir(frames, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^frame-.*\.(?:png|jpe?g|webp)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    : [];
  if (check.ok && files.length !== evidence.length) {
    check = {
      ...check,
      ok: false,
      failure_kind: "content",
      error: `Temporal snapshot produced ${files.length} frames for ${evidence.length} requested timestamps`
    };
  }
  const frameDirectory = path.relative(qaDir, frames).split(path.sep).join("/");
  if (!frameDirectory || frameDirectory.startsWith("../") || path.isAbsolute(frameDirectory)) throw new Error("Temporal evidence frames must remain inside the QA directory");
  const describedEvidence = evidence.map((entry, index) => ({
    ...entry,
    file: files[index] ? `${frameDirectory}/${files[index]}` : null
  }));
  const manifestPath = path.join(qaDir, "temporal-evidence.json");
  const manifest = {
    schema_version: TEMPORAL_EVIDENCE_VERSION,
    status: check.ok ? "passed" : "failed",
    duration_seconds: Number(plan.format.duration_seconds),
    hook_window_seconds: Math.min(Number(plan.format.duration_seconds), Number(options.hookWindowSeconds ?? 4)),
    evidence: describedEvidence
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    check,
    frames,
    files: files.map((name) => path.join(frames, name)),
    manifest: manifestPath,
    evidence: describedEvidence
  };
}

function boundOptionalEvidence(points, maximum) {
  const limit = Math.max(1, Math.floor(maximum) || 64);
  if (points.length <= limit) return points;
  const mandatory = points.filter((point) => point.roles.some((role) => role.type === "hook" || role.type === "transition" || role.type === "final-hold"));
  if (mandatory.length >= limit) return mandatory;
  const optional = points.filter((point) => !mandatory.includes(point));
  const remaining = limit - mandatory.length;
  const selected = Array.from({ length: remaining }, (_, index) => optional[Math.floor(index * optional.length / remaining)]).filter(Boolean);
  return [...new Set([...mandatory, ...selected])].sort((left, right) => left.timestamp_seconds - right.timestamp_seconds);
}

function activeShot(shots, timestamp) {
  return shots.find((shot, index) => Number(shot.start_seconds) <= timestamp + .001
    && (timestamp < Number(shot.end_seconds) - .001 || index === shots.length - 1)) ?? null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value) {
  return Number(Number(value).toFixed(3));
}
