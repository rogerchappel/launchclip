## Quick path

The minimum, in order, for a new story (a 30–60 s Short or promo). Every step
names the reference that holds its detail; load a reference only when you
reach its step. `launchclip <command> --help` prints any command's usage.

There is also a CLI equivalent with no agent session: `launchclip make
"<prompt>" [--assets <dir>]` routes the inputs to a lane, writes the script
and storyboard with an API model (OpenAI or Anthropic key), and runs finish
headlessly ("Make a video headlessly" in the launchclip-cli reference). Use it
when the user wants a hands-off draft or has no agent subscription; use this
skill when they want the bespoke, reviewed path below.

1. **Brief.** Ask at most three grouped questions (story, delivery, materials
   and audio), default the rest, and write `BRIEF.md`, `EVIDENCE.md` and
   `SOURCE.md` into the output project (`.launchclip/agent-<slug>`).
   Details: [references/workflow.md](references/workflow.md) ("Conduct the
   compact intake", "Freeze the brief and evidence"). Pointed at a SaaS
   codebase? Record its key flows next with `launchclip demo record` ("Record
   the product (demo autopilot)" in the same reference) and show them as
   `product-demo` scenes. No style or brand given? Write the art-direction
   constraints into `BRIEF.md` and generate a seeded style
   (`launchclip style generate --project <project> --tone <tone>`; "No
   style given" in [references/workflow.md](references/workflow.md)).
2. **Concept and story.** Five distinct concepts judged in a fresh context →
   `CONCEPTS.json`; an independently edited retention story → `STORY.json`;
   the exact narration → `SCRIPT.md`.
   `cinematic-check` requires both receipts. Details:
   [references/cinematic-production.md](references/cinematic-production.md).
3. **Voice.** Put the script in `storyboard.json` `audio.narration`, run
   `launchclip voice <project>` (local Kokoro, cached), and adjust the text or
   `speed` until the measured take fits. It writes `NARRATION.json`; size
   `format.duration` and the scenes to that take.
4. **Direction map, then storyboard.** First write `DIRECTION.json` from
   [references/direction-map.md](references/direction-map.md): every
   narration line gets an intent and a treatment, aimed at the cadence
   profile in [references/profiles.md](references/profiles.md). Then write
   `storyboard.json` against it from
   [references/storyboard-modules.md](references/storyboard-modules.md):
   one catalogue module per scene, typed `in` transitions (the boundaries
   `cinematic-check` reads), and scene starts and hits anchored to narration
   words (`word:<text>`). Pick one `motion.grammar` and, for travel, the world
   camera. Check with `launchclip story validate` (it checks the map too) and
   `launchclip layout-check`. Also write `STORYBOARD.md`, `DESIGN.md` and
   `QUALITY.md`.
<!-- renderer: hyperframes -->
   Hand-authoring HyperFrames HTML instead? Put
   `data-launchclip-cinematic-contract="phase-2"` on the composition root and
   follow "Author and repair" in
   [references/workflow.md](references/workflow.md) and the runtime reference.
<!-- /renderer -->
5. **Candidates.** Render two opening candidates and two for one risky
   transition, each from its own candidate project, with no paid calls:
   `launchclip finish <candidate> --candidate <id> --into <project>
   [--boundary <scene>]`. Score them from the pixels in
   `qa/rendered-candidates.json` (`cinematic-check` requires four admissible
   candidates). Details: "Render critical candidates" in
   [references/cinematic-production.md](references/cinematic-production.md).
6. **Draft.** Run
<!-- renderer: hyperframes -->
   `launchclip finish <project> --renderer hyperframes`
<!-- /renderer -->
<!-- renderer: remotion -->
   `launchclip finish <project> --renderer remotion`
<!-- /renderer -->
   to render `renders/draft.mp4` with voice, captions, music, SFX, the −14 LUFS
   master, `qa/temporal-evidence/manifest.json`, critic sheets and gates
   (`AUDIO-MANIFEST.json` included). Fix one scene with
   `--preview-scene <id>`, then `--scene <id>`.
7. **Critic.** A fresh-context critic reviews `qa/critic-sheets/` and the
   draft and writes `qa/critic.json`, citing every evidence ID it reviewed.
   Repair the smallest responsible scene, at most three passes.
8. **Gate.** Run
<!-- renderer: hyperframes -->
   `launchclip cinematic-check <project> --video renders/draft.mp4 --critique qa/critic.json --expect-audio`
<!-- /renderer -->
<!-- renderer: remotion -->
   `launchclip cinematic-check <project> --renderer remotion --video renders/draft.mp4 --critique qa/critic.json --expect-audio`
<!-- /renderer -->
   to write `CINEMATIC-READINESS.json`. Deliver the draft; render
   `--quality high` only after the user explicitly approves the final.

Essential rules:

- Do not run `launchclip produce`, `creative-plan`, `direct-frames`,
  `production-critique` or `production-repair` (metered model stages); you are
  the director and critic. Use `launchclip cinematic-check` as the local gate
  (no model calls).
- Never spend provider credits silently: ElevenLabs voice, music or SFX need
  the user's explicit opt-in. With `ELEVENLABS_API_KEY` set, `finish` makes
  ElevenLabs music by default (paid once, then locked), so pass
  `--music synth` until the user opts in. Candidates use `finish --candidate`,
  which never pays.
- Supplied narration is authoritative; never invent capabilities, numbers or
  testimonials.
- Keep motion deterministic: catalogue modules first, bespoke code only for
  flagship work.
- Never weaken a gate or mark an accidental overlap as intentional; report
  `needs-repair` after three passes.
- Do not publish or upload anything unless the user asks.
