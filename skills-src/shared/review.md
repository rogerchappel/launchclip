## Obtain review and render

For recorded-video work, use the verification and delivery checks in
`references/recorded-video.md`. Full treatments require the recorded direction
readiness gate, while base-edit-only exports use recording QA. Neither route
needs fabricated cinematic tournament receipts. The cinematic creation
requirements below apply to new-story creation only.

<!-- include: renderers/{renderer}/preview.md -->

**Prototype first.** For a story over 60 seconds, render the opening before
the whole: `launchclip finish <project> --prototype` renders the first 20–30 s
(cut at a sentence end) with the full style, layouts and sound to
`renders/prototype.mp4`, and runs the coverage, direction and face gates on
that opening: only the direction-map lines and scenes inside it are checked,
and the whole-video shares (coverage, face time) are reported as `advisory`
rather than failing it. Show it to the user and stop for review; render the
whole video only once the opening is right.

**Draft and final.** `launchclip finish` defaults to `--quality draft`,
which writes `renders/draft.mp4`: the same resolution, frame rate, timing,
mix, loudness master and gates as the final, encoded faster at a lower
bitrate (Remotion CRF 28 `veryfast`; HyperFrames `--quality draft`, CRF 28
with lighter frame capture). Every
gate, the critic and `cinematic-check` judge this draft, and it is a
reviewable deliverable. `--quality high` writes `renders/final.mp4` (the full-quality encode)
and needs the user's explicit approval in this conversation after they have
seen the draft or Studio preview, for example "render the final". A passing
gate, a `ship` verdict from the critic, or the original request to make a
video is not that approval. When the user has not approved yet, deliver
`renders/draft.mp4`, say plainly that it is the gated draft, and give the
one command that renders the final once they approve.

After approval:

<!-- include: renderers/{renderer}/render.md -->
2. Confirm the file exists and is non-empty.
3. Probe its duration, dimensions, video codec, and audio presence.
<!-- renderer: hyperframes -->
4. If a final render is visually different from snapshots, repair, recheck,
   obtain fresh approval, and rerender.
<!-- /renderer -->
<!-- renderer: remotion -->
4. If a final render is visually different from the reviewed stills, repair,
   recheck, obtain fresh approval, and rerender.
<!-- /renderer -->
5. Return the project path, planning artifacts, QA result, and final media path.

Do not publish, upload, or post the result unless the user separately asks for
that external action.
