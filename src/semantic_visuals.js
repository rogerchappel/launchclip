const CONTENT_OBJECT_KINDS = new Set(["asset", "logo", "diagram-node", "connector", "metric", "timeline", "process"]);
const TEXT_ONLY_REPRESENTATIONS = new Set(["kinetic-type"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function validateSemanticVisualPlan(plan) {
  const errors = [];
  const shots = Array.isArray(plan?.shots) ? plan.shots : [];
  const totalDuration = Number(plan?.format?.duration_seconds);
  let textOnlyDuration = 0;
  let previous = null;

  for (const [index, shot] of shots.entries()) {
    const label = `shots[${index}]`;
    const visual = shot?.visual;
    if (!visual) {
      errors.push(`${label}.visual semantic contract is required`);
      previous = shot;
      continue;
    }
    const duration = Number(shot.end_seconds) - Number(shot.start_seconds);
    const objects = Array.isArray(visual.objects) ? visual.objects : [];
    const events = Array.isArray(visual.events) ? visual.events : [];
    const objectIds = new Set();
    const eventIds = new Set();
    const layers = new Set();

    for (const [objectIndex, object] of objects.entries()) {
      if (!ID_PATTERN.test(String(object?.id ?? ""))) errors.push(`${label}.visual.objects[${objectIndex}].id must be a stable object id`);
      if (objectIds.has(object?.id)) errors.push(`${label}.visual.objects contains duplicate object id: ${object.id}`);
      objectIds.add(object?.id);
      layers.add(object?.layer);
      if (object?.asset_resource_id && !shot.resource_ids?.includes(object.asset_resource_id)) errors.push(`${label}.visual.objects[${objectIndex}] uses an asset not approved for this shot: ${object.asset_resource_id}`);
    }
    if (layers.size < 2) errors.push(`${label}.visual.objects must span at least two depth layers`);

    for (const [eventIndex, event] of events.entries()) {
      if (!String(event?.id ?? "").startsWith(`${shot.id}-`)) errors.push(`${label}.visual.events[${eventIndex}].id must begin ${shot.id}-`);
      if (eventIds.has(event?.id)) errors.push(`${label}.visual.events contains duplicate event id: ${event.id}`);
      eventIds.add(event?.id);
      if (Number(event?.at_seconds) > duration + .001) errors.push(`${label}.visual.events[${eventIndex}] falls outside the shot duration`);
      if (!event?.target_ids?.length) errors.push(`${label}.visual.events[${eventIndex}] must target at least one visual object`);
      for (const target of event?.target_ids ?? []) if (!objectIds.has(target)) errors.push(`${label}.visual.events[${eventIndex}] targets unknown object: ${target}`);
    }

    const contentObjects = objects.filter((object) => CONTENT_OBJECT_KINDS.has(object.kind));
    const textOnly = TEXT_ONLY_REPRESENTATIONS.has(visual.representation) || objects.every((object) => ["text", "decoration", "container"].includes(object.kind));
    if (textOnly) textOnlyDuration += Math.max(0, duration);
    if (["companion", "voiceover"].includes(shot.presenter?.mode) && !contentObjects.length) errors.push(`${label} must include a content-bearing visual object beyond presenter and text`);

    for (const [cueIndex, cue] of (shot.sfx ?? []).entries()) {
      const event = events.find((candidate) => candidate.id === cue.event_id);
      if (!event) errors.push(`${label}.sfx[${cueIndex}].event_id references an unknown visual event: ${cue.event_id}`);
      else {
        if (!event.sfx_eligible) errors.push(`${label}.sfx[${cueIndex}] is bound to an event that is not SFX-eligible: ${cue.event_id}`);
        if (Math.abs(Number(cue.at_seconds) - Number(event.at_seconds)) > .05) errors.push(`${label}.sfx[${cueIndex}].at_seconds must match its visual event within 0.05s`);
      }
    }

    const continuity = visual.continuity;
    if (previous && previous.visual?.continuity?.sequence_id === continuity?.sequence_id && ["continue", "transform"].includes(previous.visual.continuity.handoff)) {
      const handedOff = previous.visual.continuity.hands_off_object_ids ?? [];
      const inherited = new Set(continuity.inherits_object_ids ?? []);
      for (const objectId of handedOff) if (!inherited.has(objectId)) errors.push(`${label}.visual.continuity must inherit handed-off object ${objectId}`);
      const exitVelocity = Number(previous.visual.continuity.exit_velocity);
      const entryVelocity = Number(continuity.entry_velocity);
      const maximum = Math.max(exitVelocity, entryVelocity, 1);
      if (Math.abs(exitVelocity - entryVelocity) / maximum > .05) errors.push(`${label}.visual.continuity entry velocity must match the previous exit velocity within 5%`);
    }
    previous = shot;
  }

  if (Number.isFinite(totalDuration) && totalDuration > 0 && textOnlyDuration / totalDuration > .15) errors.push(`text-only visual runtime must not exceed 15% (actual ${Math.round(textOnlyDuration / totalDuration * 100)}%)`);
  return errors;
}

export function semanticVisualReport(plan) {
  const shots = plan?.shots ?? [];
  const duration = Number(plan?.format?.duration_seconds) || 0;
  const textOnlyDuration = shots.reduce((sum, shot) => {
    const objects = shot.visual?.objects ?? [];
    const textOnly = TEXT_ONLY_REPRESENTATIONS.has(shot.visual?.representation) || objects.every((object) => ["text", "decoration", "container"].includes(object.kind));
    return sum + (textOnly ? Number(shot.end_seconds) - Number(shot.start_seconds) : 0);
  }, 0);
  const events = shots.flatMap((shot) => shot.visual?.events ?? []);
  const cues = shots.flatMap((shot) => shot.sfx ?? []);
  return {
    shots: shots.length,
    semantic_events: events.length,
    sfx_cues: cues.length,
    bound_sfx_cues: cues.filter((cue) => events.some((event) => event.id === cue.event_id)).length,
    text_only_ratio: duration > 0 ? textOnlyDuration / duration : 0,
    representations: Object.fromEntries([...new Set(shots.map((shot) => shot.visual?.representation).filter(Boolean))].map((kind) => [kind, shots.filter((shot) => shot.visual?.representation === kind).length])),
    continuity_sequences: [...new Set(shots.map((shot) => shot.visual?.continuity?.sequence_id).filter(Boolean))]
  };
}
