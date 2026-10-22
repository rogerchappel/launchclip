# Finishing in an NLE

Use this when the user wants to keep editing a finished storyboard project in
Final Cut Pro, Premiere Pro, DaVinci Resolve or another editor, instead of (or
after) delivering the rendered MP4. `launchclip export` turns the project into
an editable timeline whose clips line up frame for frame with the render.

## Command

Run `launchclip finish` first: it writes the voice, the mix, the SFX manifest,
the captions and the render that the export picks up. Then:

```bash
launchclip export <project> --format fcpxml|premiere|edl|otio|all \
  [--overlays prores4444|png|none] [--out exports/] [--fps 24|25|29.97|30|60] \
  [--name name] [--absolute] [--force] [--json]
```

| Editor | Format | Import |
| --- | --- | --- |
| Final Cut Pro | `fcpxml` (FCPXML 1.10) | File > Import > XML. Add `--absolute` if it cannot find the media. |
| DaVinci Resolve | `fcpxml` (or `premiere`) | File > Import > Timeline; point it at `media/` when asked. |
| Premiere Pro | `premiere` (FCP 7 xmeml v4) | File > Import the `.xml`, then import `captions.srt` and drag it onto the sequence. |
| Avid, conform tools | `edl` (CMX 3600, V1 only) + `captions.srt` | Import the EDL; reels are named after the media files. |
| OTIO hosts (Resolve, Hiero, RV, otio tools) | `otio` | Open the `.otio`. |

Everything lands in `<out>/<name>/` (default `exports/<project-folder>/`):
`<name>.fcpxml`, `<name>.xml`, `<name>.edl`, `<name>.otio`, `captions.srt`,
`timeline.json` (the model every format was written from), `EXPORT.json`
(files, tracks, warnings, validation) and `media/` with every file the
timeline references, copied in so the folder can be moved or zipped. Paths are
relative unless `--absolute` is passed.

## What the timeline holds

- **V1** is the base. Footage-led projects get one clip per trim segment of the
  original recording, each with its source in point (the edit-recording cuts
  stay editable). Motion projects get a solid plate in `brand.colors.bg`.
- **V2 and up** hold the overlays: each scene rendered on its own as ProRes 4444
  with alpha (`media/overlays/<scene>.mov`), on the lanes of its story track.
  A scene that transitions in sits above the one it overlaps, as in the render,
  so a run of transitions climbs one lane per boundary. Track-0 scenes keep
  their brand plate, because during a fade or zoom the incoming plate covers the
  outgoing scene; their alpha still carries the transition.
- **Top video track**: the finished render, disabled, as a reference to compare
  against.
- **A1** is the voice (the narration, or the recording's own audio linked to its
  V1 clips), **A2** the music bed at its level, **A3 and up** every SFX cue as
  its own clip at its time with its level, then the finished mix (disabled) as a
  reference. A project that supplies a premixed `audio.mix` and no stems gets
  the mix on A1.
- **Captions** are a subtitle track (FCPXML caption role
  `SRT?captionFormat=SRT.en`; `captions.srt` for the other formats).
- **Markers** at every scene start, hit and camera move.

`--overlays none` skips the overlay renders: the finished render becomes the one
enabled picture clip above V1. `--overlays png` writes PNG sequences
(`media/overlays/<scene>/frame-NNNN.png`) for compositing apps; only the OTIO
references them, since FCPXML and xmeml cannot point at image sequences.
Overlay renders are cached in `media/overlays/.renders.json` and reused while the
story and the kit are unchanged (`--force` re-renders).

## What is not carried

Say so when you hand the export over:

- Punch-in and other camera moves on the base are markers, not transforms;
  re-create them as scale/position keyframes on V1.
- The mix ducks the music under the voice; the music clip is at its bed level
  without ducking (use the editor's ducking).
- Word-highlight caption styling is a render effect; the subtitle track holds
  the words and timings only.
- Transitions are baked into the overlay clips, not editor transitions.
- SFX cues snap to the nearest frame (at most half a frame).

## Frame rates

The timeline uses the story's fps unless `--fps` overrides it. NTSC rates are
exact (29.97 is 30000/1001) and use drop-frame timecode; overlays then render
at that rate too, and the editor conforms 30 fps base footage.

## Overlays and the HyperFrames renderer

Overlay clips always come from the Remotion kit (`SceneOverlay` composition),
whichever renderer made the finished video. HyperFrames can write transparent
MOV and PNG sequences (`hyperframes render --format mov|png-sequence`), but the
storyboard compiler always paints the brand background and compiles the whole
timeline, so it cannot isolate one scene on alpha yet.

## Checks

Every written file is parsed back and compared with the timeline model: clip
starts, durations and source in points, markers and captions, frame for frame.
FCPXML also gets structural checks (resources, a contiguous primary storyline,
DTD element order, connected clips in their parent's local time, roles) and is
validated against Apple's FCPXML 1.10 DTD when Final Cut Pro is installed (or
`--dtd`/`LAUNCHCLIP_FCPXML_DTD` points at it). When the Python
`opentimelineio` package is installed, the `.otio` is also read with it.
`EXPORT.json` records which checks ran; `status: failed` means a file did not
match the model.
