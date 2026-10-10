# B-roll capture planner

The offline planner turns a timed transcript into a practical capture checklist.
It uses topic keywords, not a model API, and does not invent evidence. Suggested
shots cover real code verification, sandbox agents, content editing, product
launches, templates, community progress and first-build challenges. Review each
suggestion against what the product actually does before recording it.

```js
import { createBrollPlan, renderBrollChecklist } from "../src/broll_plan.js";

const plan = createBrollPlan(editedWords, {
  durationSeconds: editedDuration,
  aspect: "16:9",
  maxCards: 12
});
const checklist = renderBrollChecklist(plan);
```

Supply flat timed words, `{ words: [...] }`, Whisper nested segment words, or
timed segments `{ segments: [{ text, start, end }] }`. Use the approved edit's
remapped words and duration so cards align with the edited video. Raw-source
timestamps cannot automatically identify positions in a cut edit. Word timings
are grouped by sentence, pause or a 24-word limit; segment-only input keeps its
original line granularity. Invalid timings fail rather than inventing offsets.

Each card includes an edit start/end, spoken line, shot description, capture
instructions, priority, `status: "planned"`, `media_path: null`, a stable filename
and a suggested 12-second capture duration. The edit placement and recording
duration are separate: record 10–15 seconds with steady handles so the editor
can select a useful portion. One suggestion per keyword topic prevents repeated
capture requests. `maxCards` caps chronological output.

For a subject the keywords do not cover, pass explicit `shots`:

```js
const plan = createBrollPlan(editedWords, {
  durationSeconds: editedDuration,
  shots: [{
    start_seconds: 8,
    end_seconds: 12,
    shot_description: "Show the real build checklist",
    capture_instructions: "Open your checklist and highlight the current task.",
    priority: "high"
  }]
});
```

Explicit shots are additional timestamped cards, subject to the same chronological
cap. Optional `spoken_line` overrides the overlapping transcript text. Use your
own material or demo accounts; hide credentials, private messages and production
data. Capture actual states rather than simulated customers, revenue or results.

After recording, update a saved card's `status` to `captured` and `media_path` to
the local clip, then regenerate the Markdown checklist. These pure functions
perform no recording, file writes, uploads, paid calls or media validation; the
calling CLI owns persistence and checking that a supplied capture exists.
