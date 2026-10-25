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
