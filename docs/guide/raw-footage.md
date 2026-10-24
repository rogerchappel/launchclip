# Raw footage: the base edit, done for you

Recorded a podcast, a talking-head video or a product walkthrough in one long take? LaunchClip does the tedious first pass:

- **Removes silences:** dead air and long pauses are trimmed, with natural padding left in.
- **Removes bad takes:** when you restart a sentence or redo a section, the earlier attempt and false starts are cut, and the last take wins.
- **Removes filler words:** "um", "uh" and friends.
- **Cleans up the audio:** rumble, hiss and hum are reduced, harsh "s" sounds are softened, and levels are evened out. Choose `--enhance light` (the default), `podcast` (stronger levelling across speakers) or `off`. Add `--voice-isolation elevenlabs` for a premium isolation pass (a paid ElevenLabs call, only when you ask for it). If clean-up ever makes a cut worse, LaunchClip keeps the unprocessed edit.
- **Checks its own joins:** every cut is re-transcribed and reviewed, so no words are clipped and nothing is left half-said.

Transcription runs locally on your machine.

## With your AI agent

> "Clean up `podcast-ep4.mov`: remove silences, bad takes and filler words, then make a 60-second portrait highlight with captions."

## From the command line

```bash
launchclip edit-recording podcast-ep4.mov --out ./ep4 --aspect 16:9 --enhance podcast
```

You get the edited video, a transcript of what's left, and a report of every cut and why it was made. From there LaunchClip can turn the cleaned recording into a finished video: captions, punch-in zooms on key words, callouts, lower-thirds, inserts and music. Or you can [export it to your editor](../guide/editors.md).

The full set of options (silence thresholds, retake windows, keeping fillers and more) is in the [advanced reference](advanced.md#recorded-video-edits-and-b-roll).

## Effects around you, not just over you

When there's one person in the shot, LaunchClip can cut you out of the background (locally, on your machine) and put graphics behind you:

- **Masthead:** your product's name, huge, behind your head, like a magazine cover.
- **Dolly zoom:** the room pushes in behind you while you stay still, for the "and that's when it hit me" moment.
- **Punch-in steps and blur:** zoom in, further in and back out on the words you stress, with a few frames of zoom blur.

`launchclip make` checks your framing first and only uses these when the cut-out works (one person, enough room around you). Add `--no-subject` to turn them off. The first run downloads two small cut-out models (about 26 MB in total); `launchclip subject setup` fetches them up front, and `launchclip doctor` shows whether they're ready.

To try the cut-out yourself:

```bash
launchclip subject probe my-recording.mp4
```
