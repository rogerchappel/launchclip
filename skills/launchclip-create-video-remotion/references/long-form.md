# Long form: chapters, resets, segments and cut-downs

<!-- Generated from kit/core/long-form.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->

A video of 5 minutes or more (the `youtube-long-form` profile) needs structure before density: chapters, an opening promise, a section card per chapter, a progress line, and an attention reset about every minute. Its sections can then be cut into Shorts that are re-planned for 9:16, not cropped. Design: `docs/VIDEO_QUALITY_RFC.md` §10.2 in the LaunchClip repo.

## Steps

1. Write `DIRECTION.json` first ([direction-map.md](direction-map.md)). Each section is a chapter: give it a short `title`, at least 10 s, and a new one every 1–3 minutes. When the style defines recurring segments (`segments` in its style.json), set the section's `"segment": "<id>"` and title it like the segment.
2. Author `storyboard.json` against the map. Leave the first 2–3 s of each chapter free for its section card.
3. Run `launchclip story long-form <project>`. It writes `chapters`, the "In this video" promise after the hook, a section card at each chapter start (the segment's kicker and icon for a segment chapter, which also holds the segment's layout), the progress line with chapter ticks, and the attention resets. It prints what it added and moved. Run it again after any edit; it replaces what it added.
4. `launchclip story validate storyboard.json` fails a run with no reset past the profile's ceiling, and warns when YouTube would ignore the chapters (fewer than 3, or one under 10 s).
5. `launchclip finish <project> --prototype`, then `launchclip finish <project>`. It writes `renders/chapters.txt` for the YouTube description and puts the chapters in the MP4 and in `launchclip export`.
6. To fix one chapter, edit it and run `launchclip finish <project> --chapter <id>`: only that chapter re-renders, the master is stitched from the cache, and the chapter is also written alone to `renders/chapters/<id>.mp4`.
7. Cut a Short with `launchclip cutdown <project> --to shorts [--section <id>]`. It picks the strongest 15–58 s run of lines in the section (or in the whole video) and writes a new 9:16 project at `<project>/cutdowns/<section>-shorts/`. Review its `storyboard.json` and `CUTDOWN.json`, then run `launchclip finish` on it. The cut must pass the Shorts profile, which its receipt reports.

## Rules

- Long form (5 min and up, or the youtube-long-form profile): each section is a chapter. Give every section a short `title` (2–5 words, the chapter name viewers see in the YouTube chapter list) and make each one at least 10 s; aim for 3–10 chapters, a new one every 1–3 minutes.
- The first section opens with the hook line and the promise: say what the video will cover. The structure pass adds an "In this video" icon-row of the chapters after the hook line, a section-card insert at each later chapter start, and a progress line with chapter ticks in the brand frame (`launchclip story long-form`; the headless planner runs it).
- Leave the first 2–3 s of each chapter free of other scenes so its section card has room; a planned scene in the way starts later or the card shortens.
- Attention resets: plan a layout change (a section with another layout), an insert line or a section card about every minute (the profile's longest_without_reset_seconds p50), never more than its p90 apart. Where a run is longer, the structure pass turns an overlay card near the right time into an insert, else switches the layout for up to 20 s.
- Section cards hold 2.6 s (at least 1.4 s, up to 4 s late when a scene is in the way); the promise holds 4.5 s within the first 45 s.
- A reset turns an overlay card near the right time into an insert (concept-card, icon-row, object-card, stat-card, quote-card, excerpt, compare, timeline), else switches the layout for up to 20 s (split-right, or stacked in portrait).

## Cut-downs

- **Reused from the long form:** the base edit (its kept source ranges, as `base.trim`), the mattes and the whole-video face track (in source time, hard-linked under `assets/`), and the scenes in the window. Word anchors are re-counted for the Short's narration (`word:<text>#n`); only one no word reaches becomes seconds.
- **Re-planned for Shorts:** split layouts become `stacked`. The chapter structure (promise, section cards, progress line) stays behind. Scenes the 9:16 canvas cannot take are left out with a warning. The cut gets word captions.
- **Hook and loop:** the cut opens on a hook card with the first line's key words in the first second, and `ending.loop_to` returns to it.
- **Density:** concept cards dress any undressed run past the Shorts profile's target until coverage is in its band.
- **Planner:** `--model provider:model` re-plans the section with the planner (paid calls) instead of the free deterministic pass, keeping the base edit and the loop.
