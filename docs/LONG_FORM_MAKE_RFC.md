# RFC: Long-form `make`, 3 to 20 minutes from one prompt

Status: draft, open for review
Date: 2026-10-30
Builds on: [BEAT_DIRECTOR.md](BEAT_DIRECTOR.md) (the long-form director, cadence, chunks),
[STORYBOARD_ENGINE_RFC.md](STORYBOARD_ENGINE_RFC.md) (the storyboard planner and its checks)

## 1. Summary

`launchclip make` stops at 180 seconds (`--duration must be between 3 and 180
seconds`). An app that offers an 8–12 minute explainer gets a failed job.

The 180 s limit is real for today's pipeline:

- **The plan is one model call.** The storyboard planner writes every scene in
  one structured response, capped at 16,000 output tokens. A 45 s video is
  about 16 scenes; 10 minutes would be about 200. One bad scene fails the whole
  plan, and a failed plan repeats up to five times.
- **The script is one call.** 6,000 output tokens is about 1,400 words of
  narration, which is just enough for 10 minutes, with no room left.
- **The render is one long job.** On a CPU worker, finish takes 4–5 minutes
  for 45 s.

Most of what long form needs already exists:

- `kit/core/beat-director.mjs` plans a 10–60 minute video deterministically:
  - a visual decision for every clause;
  - shots of 2–4 states;
  - a plate per chapter;
  - a camera pass;
  - a cadence gate measured from a reference explainer.
- `kit/core/long-form.mjs` cuts chapters into resumable chunks of at most
  180 s.
- `beatMapToStory` turns the map into a storyboard.
- The segment cache renders, reuses and re-renders segments, including a whole
  chapter (`finish --chapter`).
- `cutShorts` cuts 3–5 Shorts from the long form.

None of this is wired into `make`. The eval dry run
(`eval/beat-map-dry-run.mjs`) is the only caller.

This RFC adds a **long-form lane** to `make`:

1. a script written in chapters;
2. a voice for each chapter;
3. a plan from the beat director;
4. a small model pass per chunk;
5. a render that resumes by chapter.

No single step grows with the length of the video, and a failure in one
chapter never throws away the others.

## 2. Goals and non-goals

Goals:

- `make "<prompt>" --duration 600` returns a finished 10-minute video, with
  the same report, costs, gates and publish metadata as a short.
- Each model call stays the size of a short video's call.
- A failed step costs at most one chapter's work. A rerun resumes from the
  first chapter that changed or failed.
- The pace matches the long-form cadence band: about 10 events per minute, and
  cuts 15–25 s apart.
- The cost and time are predictable before the run, so an app can quote them.

Non-goals (for now):

- Footage-led long form, such as a 20-minute recording with overlays. That is
  the footage lane's own work.
- More than 20 minutes. The director handles 60, but the render time and
  review make 20 the first ceiling.
- A model that plans every scene. The director's rules plan the structure; the
  model only writes words and parameters (§5.3).

## 3. Routing

- `--duration` accepts 3–1200 s.
- A motion-lane run longer than 180 s takes the **long-form lane**.
- So does a prompt that names a length over 3 minutes, such as "a 10 minute
  explainer".
- The report says `lane: "long-form"` and gives the reason. Everything up to
  180 s keeps today's path unchanged.
- `--long-form` forces the lane, which is useful for testing with a 2-minute
  video.

## 4. The script, in chapters

Three passes, each sized like a short's:

1. **Outline (one call).** From the prompt, notes, research and assets, it
   returns:
   - the title and angle;
   - 4–10 chapters, each with a title, a one-line point, its facts, and a
     target length.

   The chapter lengths add up to the target duration. Tooling checks the
   outline:
   - every chapter is 45–180 s;
   - the facts come from the brief or the notes;
   - the cold open is under 30 s.

   An outline that fails gets one repair pass, as the script does today.
2. **Chapter scripts (one call per chapter).** Each call gets:
   - the outline;
   - its own chapter;
   - the last two sentences of the previous chapter, for the handoff;
   - the notes.

   The word target comes from the voice's measured words per minute (§4.1).
   Chapters are written in order, so each handoff reads naturally. Each one
   passes through today's script checks and gets one repair pass if it fails.
3. **The joined script** is `SCRIPT.md`, with `# Title` and `## Chapter`
   headings. That is the format `parseScript` already reads, so the beat
   director, the dry run and the Shorts cutter all take it as it is.

`SCRIPT.json` keeps the outline, each chapter's passes and its cost, and the
hash of each chapter. A rerun reuses every chapter whose inputs are unchanged.

### 4.1 Length without a cap

Long form has no single "resize pass". Instead:

- The first chapter is voiced before the second is written.
- Its measured words per minute sets the word target for the rest. Kokoro,
  ElevenLabs and a cloned voice each speak at a different pace, and this
  absorbs that.
- A chapter more than 15% off its target gets one resize pass, for that
  chapter only.
- The video's length is what the voice says. The report warns when the total
  is more than 10% from the target, as a short does today.

## 5. Voice, plan and story

### 5.1 Voice per chapter

- Each chapter is synthesised on its own and cached by its text, as the voice
  cache works today.
- The takes are joined with a 0.6 s gap between chapters, and their word times
  are offset into one `NARRATION.json`.
- A change to one chapter re-voices that chapter only.
- Kokoro on CPU runs at about 1–2× real time, so 10 minutes of voice takes
  5–10 minutes. Chapters can be voiced in parallel with the chapter scripts
  still being written, up to the worker's share.

### 5.2 The beat map

`directLongForm({words, chapters, evidence})` plans the video:

- `longFormChunks` cuts it into ≤ 180 s chunks;
- clauses become states, states become shots, and each chapter gets a plate;
- the camera pass plans the moves;
- the cadence gate checks the whole map.

This step is deterministic: a 60-minute run plans in under a second. It needs
no model and has no repair loop. It writes `BEATMAP.json`, `DIRECTION.json`
and `CADENCE.md`.

The style pack, brand and visual history feed the director's settings, the
same inputs the storyboard planner gets.

### 5.3 The model pass, per chunk

The director's states carry rule-made text and params. One model call per
chunk (≤ 180 s, about 15–30 states) rewrites:

- the on-screen words (headline, labels, list items);
- the params (numbers, names, chart values);

using the narration and the notes for that chunk. It may not change the
module, the timing, the shot, or the structure. Those are the director's.

- Each chunk's output passes through the module param checks: the same
  `checkStoryboard` the short path uses, on that chunk's scenes.
- A chunk that still fails after two repairs **keeps the director's
  rule-made params** for the failing states and logs a warning. It never fails
  the video.
- Chunks run in parallel, up to the model's rate limit.

Timing-only errors (§7) are fixed by tooling before any check.

### 5.4 Story and render

`beatMapToStory` builds one `storyboard.json`. Then:

- `finalizeStory` fills in the audio, captions, style and brand.
- `checkStoryboard` checks the whole story once, with timing errors fitted by
  tooling. A remaining error points at its chunk, which replans alone.
- **finish** renders through the segment cache, chapter by chapter. A crash or
  timeout in chapter 7 keeps chapters 1–6, and a rerun starts at 7.
- **Music:** one bed for the whole video, looped and ducked under the voice.
  A chapter-break swell is a follow-up.
- **Captions:** they run as today, for the whole video.

### 5.5 Shorts

`cutShorts` already picks 3–5 windows that pass the short-form gate.
`--shorts` (off by default) renders them as 9:16 cutdowns from the same story.
An app can offer "Short only" from the same long-form job.

## 6. Cost and time

Estimates for 10 minutes on the current model (`@medium`) and a CPU worker:

| Step | Calls | Time |
|---|---|---|
| Outline | 1 (+1 repair) | ~40 s |
| Chapter scripts | 6–8 (+repairs) | ~4 min, overlapped with voice |
| Voice (Kokoro, CPU) | per chapter | 5–10 min |
| Beat map | 0 | < 1 s |
| Model pass | 4 chunks in parallel | ~2–3 min |
| Render | segments | ~30–50 min on one worker; less across render workers |

The model cost should be roughly 10–15 short-video calls, which is about
$2–4. Phase 0 (§9) measures the real figures, and an app's quote should be set
from them, not from this table.

## 7. Timing checks are tooling's job

Three real runs in a row failed their first storyboard on a timing
check:

- a tier param;
- a countdown step (fixed in #427);
- a scene of 1.67 s for a module that needs at least 2 s.

Each failure cost a full replan of about 7–8 minutes. Long form would have
hundreds of such checks.

Before long form ships, the checks that are pure arithmetic get fitted by
tooling, like the countdown:

- scene minimum durations: merge into, or borrow from, a neighbour;
- step and interval params;
- event times past the end of a scene.

The model is only asked to fix what needs judgment. This also fixes today's
short-video replans.

## 8. What an app sees

- The report gains `lane: "long-form"`, `chapters`, per-chapter timings and
  costs, and the cadence report.
- `--json` progress lines name the chapter, such as `chapter 3/7: voice`, so
  an app can show real progress for a job that takes half an hour.
- An app that runs `make` should scale its timeout with the duration.
- An app can then:
  - offer motion lengths up to 20 minutes;
  - quote long form from measured runs;
  - show chapter progress.

## 9. Phases

Each phase is one PR, with tests.

0. **Prototype, before any wiring.**
   - Write a real 8–10 minute news explainer script by hand, using the
     outline prompt.
   - Voice it with Kokoro.
   - Run `directLongForm` and render two chapters.
   - Review the direction map and the two chapters before building
     the rest.
   - Record the real time and cost for §6.
1. **Timing fits (§7).** Tooling fits scene durations and timing params.
   This helps short videos straight away.
2. **Routing and the chaptered script (§3, §4)**, with the per-chapter cache.
3. **Voice per chapter and the joined narration (§5.1).**
4. **Beat map and story in `make` (§5.2, §5.4)**, using the rule-made params
   only. This is the first end-to-end long video.
5. **The model pass per chunk (§5.3).**
6. **Chapter-resumable render, progress lines and report fields (§5.4, §8).**
7. **Shorts cutdowns (§5.5).**


## 10. Open questions

1. **Builds re-enter.** Today a `build` state renders as a new scene that
   fades in, so the card animates in again (BEAT_DIRECTOR.md, "Not yet").
   Long form leans on builds heavily. Should in-shot state changes come before
   phase 4, or right after?
2. **Plates and the world camera.** The director plans a plate for each
   chapter. Should a chapter's shots travel on one world canvas, as the seeded
   short styles now do, or cut between chapters?
3. **Review gate.** Should a long video stop after the beat map and wait for
   approval, as a draft, before the half-hour render? For an app that's a
   setting; the CLI would need a new `--stop-after plan`.
4. **Voice.** Kokoro on CPU is the slow step after the render. Should long
   form prefer ElevenLabs when a key is set, given the cost of about $1–2 per
   10 minutes?
