# Long videos and chapters

A 10-minute YouTube video needs structure before it needs more graphics. LaunchClip gives a long video chapters, a card at the start of each one, and a progress line that shows where the viewer is.

## Chapters

Every section of the direction map (`DIRECTION.json`) becomes a chapter, named by the section's `title`. When you make a long video headless, the planner does this for you:

```bash
launchclip make "A 10-minute walkthrough of our new release" --assets ./assets --aspect 16:9
```

On the skill path, or after you edit the storyboard or the map yourself, run the structure pass:

```bash
launchclip story long-form ./my-video
```

It writes `chapters` into `storyboard.json` and adds three things:

- **The opening promise.** Right after the hook, an "In this video" card lists the chapters to come.
- **Section cards.** Each chapter after the first opens on a full-frame card with its number and title.
- **The progress line.** A thin line along the bottom of the frame fills as the video plays, with a tick at each chapter. The frame's section label shows the chapter you're in.

It also keeps attention up. Long videos need a change of picture about every minute: a new layout, a full-frame graphic or a section card. Where a stretch runs longer, the pass turns a nearby card into a full-frame insert, or puts you beside a branded panel for a few seconds. `launchclip story validate` and `launchclip finish` flag any stretch over two minutes without one.

If a scene is in a card's way, the scene starts a little later or the card gets shorter. The command lists everything it moved, and it's safe to run again.

Give each chapter at least 10 seconds and make at least three. YouTube ignores a chapter list otherwise, and LaunchClip warns you when that would happen.

## Recurring segments

A series looks like a series when its regular segments look the same every episode. Define them once in your style:

```json
"segments": [
  { "id": "tool-of-the-week", "title": "Tool of the week", "kicker": "Every Friday", "icon": "wrench",
    "layout": "split-right", "modules": ["object-card", "concept-card"], "match": ["this week's tool"] }
]
```

Any chapter titled like the segment ("Tool of the week", "This week's tool: Raycast") becomes that segment. It opens on a card with the segment's kicker and icon, keeps you on one side of the frame with a branded panel beside you, and the planner prefers the segment's graphics. You can also name the segment in the direction map yourself: `"segment": "tool-of-the-week"`.

## Fix one chapter

When one chapter needs a change, re-render only that chapter:

```bash
launchclip finish ./my-video --chapter c3
```

Every other chapter comes from the render cache, the full video is put back together with your fix in it, and the chapter is also saved on its own as `renders/chapters/c3.mp4`. Chapter ids are in `storyboard.json` under `chapters`.

## What you get

`launchclip finish` puts the chapters in three places:

- `renders/chapters.txt`, ready to paste into the YouTube description:

  ```
  0:00 The problem
  1:40 Tool of the week
  3:20 How it works
  ```

- the MP4 itself, so players that read chapters show them;
- [editor exports](editors.md): chapter markers in Final Cut Pro, and markers in Premiere Pro, Resolve and OpenTimelineIO.

## Cut Shorts from it

Turn any chapter into a Short:

```bash
launchclip cutdown ./my-video --to shorts --section c2
launchclip finish ./my-video/cutdowns/c2-shorts
```

The Short isn't a crop of the long video. LaunchClip picks the strongest 15–58 seconds of the chapter and plans them again for a vertical screen:

- your edit, cut-outs and face tracking are reused, so nothing is re-processed;
- side-by-side layouts stack vertically;
- it opens on a hook card with the first line's key words and loops back to it;
- it adds captions and enough graphics to hold attention at Shorts pace.

`CUTDOWN.json` in the new project shows which seconds it took, what it kept and added, and whether the Short passes the Shorts checks. Leave out `--section` to let LaunchClip pick the best stretch of the whole video. Add `--model` to have the AI planner design the Short from scratch instead (paid).

