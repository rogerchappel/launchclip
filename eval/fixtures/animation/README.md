# Animation measurement fixtures

For the animation scorecard (`npm run eval:formats -- --animation`,
`eval/animation-metrics.mjs`) and the `script` gate (`src/script_gate.js`).

- `broken-script/`: a project that holds only a `SCRIPT.json`, written to
  break the four rules the gate names: `boss` speaks but is not a character,
  `theo` is listed and never speaks or acts, the script runs well past its
  20 seconds, and the problem beat starts after the profile's limit. The team
  and the meeting are invented.

The passing case is the two-character example, `examples/story/dialogue-9x16`.

Finished projects for the six briefs are not kept here. A run writes them
wherever the caller says; the scorecard reads them from
`<runs>/<brief id>/` (see docs/ANIMATION_MEASUREMENT.md).
