# Scoring: video signals

A post library is built from captions, numbers and whatever text came with each post. This step adds what only the video shows: how fast it cuts, when the first cut lands, and one small picture of the frames a viewer sees first.

It is off by default. Nothing else in scoring needs it.

```bash
launchclip score library video out/library.jsonl
launchclip score library video out/library.jsonl --best 3 --worst 3 --concurrency 2
```

## What it does

1. Picks a contrast sample: for each account with at least `--best` + `--worst` posts that have a link and a settled result, its best five and worst five by outlier. Comparing an account's hits with its own misses says more than its hits alone.
2. Downloads each sampled video at the lowest resolution that is still at least 360 px.
3. Reads the cuts with ffmpeg's scene detection.
4. Writes one contact sheet, `sheets/<id>.jpg`, beside the library.
5. Deletes the video.

Each sampled row gains:

| Field | Meaning |
| --- | --- |
| `facts.cuts_per_s` | Cuts divided by length. 0 is one unbroken shot. |
| `facts.first_cut_s` | When the first cut lands, or `null` when there is none. |
| `facts.duration_s` | Length in seconds, when the row had none. |
| `sheet` | The contact sheet's path, relative to the library. |
| `transcript` | Only when the row had none and local Whisper is installed. Marked `transcript_source: "whisper"`. |

The library is rewritten in place. Running it again skips rows that already have `facts.cuts_per_s`, and retries the ones that failed. A failed download is printed and counted; it does not stop the run.

## What it needs

- `yt-dlp` and `ffmpeg` on your PATH (`brew install yt-dlp ffmpeg`). If either is missing the command stops before downloading anything and says which.
- Optional: `whisper` (openai-whisper) for posts with no transcript. It runs on your machine. Pass `--no-transcribe` to skip it.

## Other people's videos

This downloads videos that other people posted. Whether you may do that, and what you may do with them, is set by each platform's terms and by the law where you are. That is yours to check and answer for. The tool keeps as little as it can: the video is deleted as soon as it has been read, and what stays is a few numbers and a nine-frame picture for your own analysis. Do not republish the sheets.

## Disk use

A short post at this size is about 1 to 3 MB, and only `--concurrency` videos exist at once. A video over 50 MB is skipped. The working folder is removed at the end, even when a download fails. A contact sheet is about 30 to 110 KB, so a sample of 200 posts leaves roughly 15 MB of sheets.

## The contact sheet

Nine frames, 240 px wide each: 0 s, 1 s and 3 s (the hook), then the frame after each of the next cuts. A video with few cuts is filled out with evenly spaced frames. On-screen text of ordinary size stays readable.

What a sheet cannot show:

- **Motion.** A slow push, a shake or an animated caption looks like a still.
- **Sound.** Music, voice and the timing of a line against a cut are not in it.
- **What happened between frames.** Nine frames of a 60-second video miss most of it.

## Limits

- The cut count comes from frame-to-frame change. Flashes, fast zooms and full-screen effects count as cuts, and a soft dissolve can be missed, so read `cuts_per_s` as pace, not as an edit list.
- Whisper is run with its small English model. On a post with only music, or speech in another language, it can write words nobody said. Treat a `transcript_source: "whisper"` transcript as a hint and check it before relying on it.
- The library is written once, at the end. An interrupted run keeps its sheets but downloads the same posts again next time.
