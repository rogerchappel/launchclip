# Recorded treatment evidence check

Run the dependency-free, skill-local helper before expanding a representative
prototype into the full edit:

```bash
node <installed-skill>/scripts/check-recorded-treatment.mjs <project>/EDIT-DIRECTION.json
```

Exit 0 means `evidence-ready`; exit 1 means `needs-attention`; exit 2 means
incorrect command usage. Inspect `issues` and `warnings` in the JSON output.
This is an evidence consistency check, **not artistic approval or a final-video
validator**. The reviewer still has to watch moving footage and listen to the
mix. Hashes bind their declared review to local bytes and direction choices; attestations are not proof
that a person or agent actually performed a good review.

## Direction receipt version 1

All paths are local, resolved relative to the receipt's folder. All times are
seconds in the edited output timeline, including events and the prototype range.
Use a rendered representative range that exercises the chosen treatment, rather
than screenshots. The helper checks nonempty files but does not decode them.

```json
{
  "version": 1,
  "target": {
    "durationSeconds": 90,
    "aspectRatio": "16:9",
    "width": 1920,
    "height": 1080,
    "delivery": "preview"
  },
  "source": {"path": "base-edit.mp4", "width": 3840, "height": 2160},
  "resources": [],
  "beats": [{
    "id": "invitation",
    "start": 0,
    "end": 90,
    "layer": "presenter",
    "purpose": "Give the personal invitation room to land",
    "visualDevelopment": "Stay with the presenter after the explanatory sequence",
    "motionIntent": "Deliberate stillness",
    "events": []
  }],
  "audio": {"narration": "source", "music": {"choice": "none"}, "sfx": []},
  "prototype": {
    "path": "prototype.mp4",
    "sha256": "REPLACE_WITH_ACTUAL_64_CHARACTER_LOWERCASE_SHA256",
    "start": 12,
    "end": 19
  },
  "critique": {
    "prototypeSha256": "REPLACE_WITH_THE_SAME_ACTUAL_SHA256",
    "directionSha256": "REPLACE_WITH_CANONICAL_DIRECTION_SHA256",
    "outcome": "pass",
    "notes": "Replace with specific observations after watching and listening",
    "reviewedAt": "2026-10-11T00:00:00Z",
    "reviewedMotion": true,
    "reviewedAudio": true
  }
}
```

The example deliberately needs real hashes, files and review notes. Do not copy
its passing outcome before reviewing. Set `outcome: "revise"` while revisions
remain. After rerendering, recompute the prototype hash and review the new render.
Compute the direction binding after finalizing the plan and prototype hash:

```bash
node <installed-skill>/scripts/check-recorded-treatment.mjs --hash <project>/EDIT-DIRECTION.json
```

Copy the returned digest into `critique.directionSha256` after reviewing that
exact direction. Hashing sorts object keys recursively, preserves array order
and excludes only the top-level `critique` object. Changes to timing, events,
audio, selected resources, prototype or other direction fields invalidate the
previous review even when the render path and bytes stay unchanged. Recompute
and review again rather than silently refreshing a passing receipt.

- `target`: positive duration and integer dimensions; aspect is `16:9`, `9:16`
  or `1:1`. Dimensions must match. `delivery` is `preview` or `publishable`.
- `source`: nonempty local footage and measured width/height. Optional `sha256`
  binds source bytes. The helper trusts declared dimensions; obtain them using
  the media probe and retain its output. Undersized source is a preview warning
  and blocks `publishable`. Separately inspect actual rendered resolution,
  reframing/crop, focus, decoding, audio and export metadata.
- `resources`: `{id, path, used, sha256?, unusedReason?}`. Used assets require
  actual SHA-256 hashes; unused assets require a reason. Inventory useful local
  resources, not every unrelated file in a user's folder. Missing inventoried
  files need attention. Empty inventory is valid; strong generated graphics can
  carry the treatment without external assets.
- `beats`: unique id, ordered valid start/end, layer, purpose, visualDevelopment,
  motionIntent and events array. Optional `resourceIds` selects inventoried used
  assets. Overlap is valid across distinct intentional layers; the same layer
  cannot overlap. Layer names describe composition tracks, not a workaround for
  conflicting graphics. Quiet presenter holds and empty events are valid. There
  is no imposed beat count, style, tempo, motion density or effects quota.
- `events`: `{id, time}` naming a visible action within its beat, such as a
  connector locking or a shape assembling. IDs are unique within each beat.
- `audio`: narration is explicitly `source` or `none`; music is explicitly
  `{choice: "none"}` or `{choice: "local", resourceId: "bed"}`. SFX entries are
  `{resourceId, beatId, eventId, time}` tied within 0.05s of a named visible event.
  All chosen music/SFX must reference assets marked used. Intentionally absent
  music and effects are valid; the creative reviewer judges whether they help.
- `prototype`: local rendered file, actual SHA-256, valid representative range.
- `critique`: `prototypeSha256` matching the current render and `directionSha256`
  matching the canonical direction, `outcome: "pass"`
  or `"revise"`, specific notes, ISO date, `reviewedMotion: true` and
  `reviewedAudio: true`. `reviewedAudio: "none"` is allowed only when narration,
  music and SFX are all absent. Review pacing, meaningful visual development,
  motion settling, sound synchronization and speech intelligibility; do not
  substitute technical validation for taste.

Keep this receipt beside local project artifacts. It is not a public CLI option,
a paid generation request, a license check, or authorization to publish. Full
render and final delivery QA remain necessary after this prototype gate.
