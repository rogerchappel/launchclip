## Promote a downloaded HeyGen avatar

When the user supplies an already-generated, authorized HeyGen MP4, treat it as
the production's presenter-and-narration source:

- Keep the original brief, repository, URL, or research source as evidence.
- Treat the avatar's spoken audio as authoritative; do not rewrite or replace
  it unless the user explicitly requests a new script or voice.
- Copy the video into the project, probe it, trim boundary silence only, and
  transcribe it locally when no transcript is supplied.
<!-- renderer: hyperframes -->
- Extract one continuous local narration track from the prepared video. Mount
  that audio once at the composition root for the whole edit.
- Mount muted video segments as direct root children for presenter-visible
  scenes. Preserve continuous source time across segments; use the same video
  for anchor, split, inset, and companion layouts, and omit it only for a
  deliberate voiceover scene.
<!-- /renderer -->
<!-- renderer: remotion -->
- Extract one continuous local narration track from the prepared video. Feed
  it into the single offline mix that plays through the one root `<Audio>`
  for the whole edit.
- Mount the prepared video as muted `<OffthreadVideo>` segments inside
  presenter-visible scenes. Preserve continuous source time across segments by
  deriving each segment's `startFrom` from its scene start; use the same video
  for anchor, split, inset, and companion layouts, and omit it only for a
  deliberate voiceover scene.
<!-- /renderer -->
- Inspect the face box, gaze, and negative space before defining graphic zones.
  Never cover the face merely to preserve a planned layout.

Do not call HeyGen, request HeyGen credentials, or assume the subscription
agent includes HeyGen generation. If the user wants a new avatar generated,
pause and obtain explicit provider, likeness, upload, cost, and script approval.
This local-file handoff is the subscription-skill equivalent of the CLI's
`--heygen-avatar` flag; do not invoke the metered LaunchClip production lane to
simulate it.
