## Obtain review and render

For recorded-video work, use the verification and delivery checks in
`references/recorded-video.md`. Full treatments require the recorded direction
readiness gate, while base-edit-only exports use recording QA. Neither route
needs fabricated cinematic tournament receipts. The cinematic creation
requirements below apply to new-story creation only.

<!-- include: renderers/{renderer}/preview.md -->

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
