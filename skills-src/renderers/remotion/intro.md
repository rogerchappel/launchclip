---
name: launchclip-create-video-remotion
description: Create an end-to-end cinematic Remotion video, authored in React and TSX from a storyboard.json file, with the current subscription agent as the creative, editorial, and orchestration layer. Use when a user wants a high-quality portrait or landscape video, promo, explainer, product story, repository walkthrough, YouTube video, Short, Reel, or social clip from an idea, URL, repository, topic, brief, script, supplied media, a user-owned project style pack, or a downloaded HeyGen avatar, and wants Remotion rather than HyperFrames as the renderer, while avoiding LaunchClip's metered model pipeline and not depending on Remotion or HyperFrames plugin skills. storyboard.json is the primary artefact; catalogue modules from the bundled Remotion kit render it, and bespoke TSX modules are an escape hatch for flagship work. Use the recorded-video direction workflow for existing footage; use a five-concept tournament and cinematic readiness gate for new stories. Preserve narration, develop motion and sound together, and verify the rendered result.
---

# LaunchClip Create Video (Remotion)

Create a reviewable video with the current agent's included reasoning and local
Remotion tooling. `storyboard.json` is the artefact you author: the bundled
`LaunchclipStory` composition renders it with frame-pure React modules. Treat
this skill as the agent-native counterpart to `launchclip produce`, not as a
wrapper around it. Its sibling, `launchclip-create-video`, renders the same
storyboard with HyperFrames; the creative funnel and gates are identical.
