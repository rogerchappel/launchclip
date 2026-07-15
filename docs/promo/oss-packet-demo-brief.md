# LaunchClip OSS Packet Demo Brief

## Promise

Show how `launchclip` turns a local OSS repository into a reviewable promotion
packet without posting anywhere or rendering a final video by default.

## Demo flow

1. Run `launchclip doctor` to show local capabilities and missing provider
   setup without printing credential values.
2. Run a dry-run packet command against a small OSS repo:

   ```bash
   launchclip run ./my-oss-tool \
     --out .launchclip/my-oss-tool \
     --demo-cmd "npm run smoke" \
     --demo-media demo/screenshot.png \
     --angle "turns demo proof into launch content" \
     --audience "developers shipping small OSS tools"
   ```

3. Open the generated workspace and show `REVIEW.md` as the reviewer handoff.
4. Run `launchclip captions .launchclip/my-oss-tool --platforms x,linkedin,tiktok,bluesky`
   to show platform-specific copy drafts.
5. Close with the approval boundary: `production-preview` is for reviewing the
   editable HyperFrames project, and `production-render --approve` is the
   explicit final-render step.

## Grounded talking points

- The CLI is local-first and dry-run-first.
- `run` creates a reviewable packet from repository evidence, demo media, an
  angle, and an audience.
- `captions` writes drafts for X, LinkedIn, TikTok, and Bluesky.
- The model-directed lane keeps stages resumable: evidence, creative plan,
  assembly, verification, draft, critique, repair, preview, and approved render.
- LaunchClip does not publish packages, post to social platforms, or submit live
  product-videogen work without a future explicit integration and human
  approval.

## Shot list

| Time | Visual | Point |
| --- | --- | --- |
| 0-4s | Terminal with `launchclip doctor` | Local readiness before promotion |
| 4-12s | `launchclip run` command | Convert repo proof into a packet |
| 12-20s | Workspace files and `REVIEW.md` | Human review is the handoff |
| 20-28s | Caption drafts | One source packet feeds multiple platforms |
| 28-35s | Preview/render commands | Final render requires explicit approval |
