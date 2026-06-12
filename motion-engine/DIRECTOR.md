# The Director — `launchclip direct`

One command from subject + creative direction to a rendered short in the paper-world grammar:

```bash
# Software product (a repo)
launchclip direct ./my-oss-tool \
  --prompt "Use the animated OpenClaw logo (assets/openclaw.svg). Highlight the 5 setup steps: <steps>. Energetic, chapter rail on."

# Education video (no repo at all)
launchclip direct --topic "How DNS resolution actually works" \
  --prompt "Explainer for junior devs. Use icon flows for the lookup chain. 45 seconds."

# Tomorrow, a different repo — same command, new video
launchclip direct ../other-cli --prompt "Focus on the watch mode"
```

The Director is an LLM pass that authors a `motion.timeline.v1` document; everything around it is deterministic. **The LLM gets creative freedom inside a contract; the contract — schema, lints, art direction — is enforced in code.** That separation is why it can work out of the box for most scenarios: new subjects change the *inputs*, never the renderer.

---

## 1. Why this generalizes (the architecture bet)

Three data-driven layers make new scenarios cheap:

1. **The component catalog** (§4) — every scene type and event ships with machine-readable metadata (params schema, when-to-use, density contribution, examples). The Director reads the catalog at runtime; adding a component extends its vocabulary with zero prompt rewrites.
2. **Format presets** (§5) — pacing templates + scene-type priors per video kind (software demo, education explainer, listicle…). A preset is data, not code.
3. **The validate → lint → repair loop** (§7) — quality is enforced by the schema validator and a density/taste linter, with errors fed back to the model for repair. Taste lives in code; the model only has to be creative, not disciplined.

What does NOT generalize automatically and is explicitly out of scope for the Director: bespoke illustrated props and squash-and-stretch mascot animation (the artisanal tier). The Director can *place* a provided mascot/logo asset; it cannot invent one.

## 2. Inputs

```
launchclip direct <subject> [flags]
```

| Input | Forms | Notes |
|---|---|---|
| **Subject** | repo path · `--topic "..."` · `--script file.md` | Repo → existing `init`/`demo` analysis (README, package metadata, captured demo output). Topic → the Director researches nothing; it writes from the prompt + its knowledge, flagging claims (§9 honesty). Script → skip script generation entirely. |
| **Creative direction** | `--prompt "..."` (free text) | Parsed into structured `direction.json` (§6). May carry: chapters/steps to highlight, asset references, energy, color hints, must-say lines, CTA. |
| **Assets** | `--assets dir/` | Logos, mascot images, screenshots, screen recordings, talking-head take, music, SFX. Manifested with type + role (§8). |
| **Format** | `--format software_demo\|explainer\|listicle\|announcement\|comparison` | Defaults inferred from subject type. |
| **Duration** | `--duration 45` | Target seconds; script generation respects it. |
| **Voice** | `--voice record\|tts\|none` + `--take file.mp4` | §10. |

Everything lands in the existing workspace structure; every stage writes an inspectable artifact (dry-run-first, per repo ethos).

## 3. Pipeline

```
INGEST → SCRIPT → VOICE → ALIGN → RESOLVE ASSETS → DIRECT → RENDER → QA
```

| Stage | What it does | Artifact | Exists today? |
|---|---|---|---|
| INGEST | Classify subject; extract facts/claims/steps with provenance | `subject.json` | Partially (`init`, `demo`) |
| SCRIPT | LLM writes VO script with beat structure + chapter names, sized to duration | `script.json` | Partially (`plan` — needs format presets + chapters) |
| VOICE | Record (teleprompter) / ElevenLabs TTS / HeyGen | take or mp3 | ✅ (`script`, ElevenLabs key wired) |
| ALIGN | Word timestamps (ElevenLabs scribe; whisper fallback) | `words.json` | ✅ (`align`) |
| RESOLVE | Map script entities → assets; build manifest | `assets-manifest.json` | New |
| DIRECT | LLM emits `motion.timeline.v1`; validate → lint → repair loop | `motion-timeline.json` | **New (the core)** |
| RENDER | Remotion render | `motion.mp4` | ✅ (`motion-render`) |
| QA | Frame sampling + checklist critique; optional re-direct | `qa-report.json` | New (phase 4) |

Each stage is independently runnable and resumable; `direct` orchestrates them end to end but respects existing artifacts (re-running after a tweak to `--prompt` reuses the take, alignment, and assets).

## 4. The component catalog (the heart of generality)

`motion-engine/catalog.js` — one entry per scene type and event type:

```js
{
  type: "card_steps",
  kind: "scene",
  use_for: "Numbered how-to beats, checklists, 'N things' structures. Each chip lands on the word that names it.",
  avoid_when: "More than 5 items (split into two scenes); items longer than ~6 words.",
  params: { /* JSON schema fragment — same rules normalizeScene enforces */ },
  density: "one build per item — fills a scene at 1 item per 0.8–1.5s",
  example: { /* a real snippet from a golden timeline */ }
}
```

The Director's system prompt is **generated** from: art direction digest (the hard rules from ART_DIRECTION.md, ~60 lines) + the catalog + the format preset. New component ⇒ new catalog entry ⇒ the Director can use it tomorrow.

**v1 catalog** (exists): `talking_head` (split/card/full), `screen`, `typography`, `prompt_card`, `screenshot_pile` (pile/scroll), `icon_flow`, `card_steps`; events `punch_zoom`, `logo_pop`; transitions `cut`/`swipe_left`/`swipe_right`/`zoom_into`.

**Build-out priority** (each unlocks scenario coverage):
1. `chapter_rail` — persistent top progress rail fed by chapter names (retention device; education videos especially)
2. `stat_counter` — oversized number roll-up (education, comparisons, social proof)
3. `quote_card` — attributed quote/principle card (education, personal brand)
4. `chat_thread` — recreated conversation bubbles (SaaS support/demo stories)
5. `compare_split` — left/right before-after or A-vs-B panel (comparisons)
6. `words_on_footage` — typography staged over talking-head footage (the OpenClaw pattern)
7. `icon_orbit` — icons orbiting a central asset (integration stories)
8. `mascot` — provided character poses, spring-puppeted (phase 4; artisanal)

A software demo and an education explainer use the *same catalog* — they differ in preset priors and in which components the script naturally calls for. That's the out-of-the-box mechanism.

## 5. Format presets (`motion-engine/presets.js`)

Data, not code. Each preset: pacing skeleton, scene-type priors, CTA norms, energy defaults.

| Preset | Skeleton (for ~45–60s) | Priors |
|---|---|---|
| `software_demo` | face/typography hook → problem (pile/typography) → prompt_card or screen → card_steps (what it does) → icon_flow (how it fits) → CTA | screen + prompt heavy; chapter rail optional |
| `explainer` (education) | typography hook ("There are 3 levels to this") → chapter rail ON → concept beats alternating typography/icon_flow/stat_counter → recap card_steps → CTA | no product assets needed; diagrams + type carry it |
| `listicle` | hook → chapter rail with N items → card_steps/quote_card per item → recap | rail is the spine |
| `announcement` | face hook → typography (the news) → screen/pile (proof) → CTA | short, 20–30s |
| `comparison` | hook → compare_split beats → stat_counter → verdict typography → CTA | |

Presets are *priors, not straitjackets* — the Director may deviate when the script demands it; the linter only enforces the hard rules.

## 6. Structured creative direction (`direction.json`)

A small LLM call (or pure parsing for simple prompts) converts `--prompt` free text into:

```json
{
  "must_include": [{"kind": "steps", "items": ["...", "..."]}, {"kind": "line", "text": "..."}],
  "asset_refs": [{"path": "assets/openclaw.svg", "role": "mascot_logo", "instruction": "animated, recurring character"}],
  "chapters": ["Intro", "Docs", "Setup", "Split", "Skills"],
  "energy": "high",
  "emphasis_moments": ["the 10x claim"],
  "cta": {"text": "Link in bio", "platform": "tiktok"},
  "overrides": {"accent": null, "duration": 45}
}
```

The linter then *verifies the direction was honored* — e.g. all five requested steps appear in some scene's items; every referenced asset is placed at least once. Unhonored direction = lint failure = repair round. This is what makes "I give it five steps and it builds the video around them" reliable rather than hopeful.

## 7. The DIRECT stage

**Model:** `claude-opus-4-8` with `thinking: {type: "adaptive"}` for both SCRIPT and DIRECT (timeline authoring is genuinely hard: word-timing arithmetic + creative staging). TypeScript/JS SDK (`@anthropic-ai/sdk`), streaming.

**Output:** structured outputs (`output_config: {format: {type: "json_schema", schema: TIMELINE_JSON_SCHEMA}}`) so the response is guaranteed-parseable JSON. The JSON schema is a *loosened* mirror of `motion.timeline.v1` (structured outputs don't support numeric ranges/recursion); the real `validateTimeline()` remains the authority.

**Prompt assembly (cache-friendly):** stable prefix = art direction digest + catalog + preset (with `cache_control`, ~8–12K tokens, cached across repair rounds and across videos); volatile suffix = script, word timings, assets manifest, direction.json.

**The loop:**

```
for attempt in 1..4:
  timeline = claude(system=stable_prefix, user=inputs + previous_errors)
  v = validateTimeline(timeline)        # existing schema: types, timing, honesty, zoom rules
  l = lintTimeline(timeline, direction) # density, coverage, direction-honoring (below)
  if v.ok and l.ok: break
  previous_errors = v.errors + l.failures (+ v.warnings as advisories)
render
```

**The linter** (`motion-engine/lint.js`, deterministic) encodes the taste rules the schema can't:
- **Density:** no gap > 1.5s without something entering/building/transforming (the #1 fluidity gap vs the reference)
- **Coverage:** scenes span the full duration; every `must_include` item appears; every `asset_ref` is placed
- **Word grounding:** every `at` matches a word start ±0.1s; key spoken nouns with available assets actually use them
- **Budget rules:** accent-color budget, ≤1 punch_zoom per scene, travel-transition share (40–80% of transitions, not 0%, not 100%)
- **Chapter rail consistency** when chapters are declared

Schema = "is it renderable"; linter = "is it good"; repair loop = "make the model fix it, don't fix it for the model."

**Cost per video** (opus-4-8 at $5/$25 per MTok): SCRIPT ~$0.05; DIRECT ~12K in / ~5K out ≈ $0.19 per attempt, ×2 average attempts with cached prefix ≈ **$0.40–0.60 total**. Negligible against the value; no need to downgrade models.

## 8. Asset resolution

Priority order — provided beats fetched beats generated:
1. **`--assets` dir** — manifested by type (logo/mascot/screenshot/recording/take/music) via filename + small vision-call classification when ambiguous
2. **Repo-derived** — captured demo output (prompt_card/console text), screenshots from `demo --demo-media`
3. **Fetched** — brand logos for *mentioned third-party tools* (Brandfetch/logo.dev → icon cards), cached in `public/logos/`
4. **Generated** — AI image gen for missing illustrative assets, **always behind an approval gate** (the packet ethos: nothing fake ships unreviewed); phase 3

The manifest records provenance per asset; the honesty rules in the schema stay intact (screenshots/footage must be real; generated assets are labeled as designed graphics, never fake screenshots).

## 9. Education videos specifically

No repo, no product, no screenshots — the grammar still works because the reference's own Obsidian video is essentially an education video. The `explainer` preset leans on: typography theses, icon_flow for processes, stat_counter for magnitudes, card_steps recaps, chapter rail as the spine, quote_card for principles. Honesty handling differs: factual claims in the script are flagged `claim: "model_knowledge"` in `script.json` and surfaced in the REVIEW packet for human verification — same review-gate philosophy as the launch packets.

## 10. Voice paths

| Path | Flow | Word timings |
|---|---|---|
| `record` (default when a take exists) | teleprompter → user records → `align` | scribe STT |
| `tts` | ElevenLabs TTS from script (voice id configurable) | scribe STT on the generated audio (timestamps API later) |
| `heygen` | script → HeyGen avatar mp4 → `align` | scribe STT |
| `none` | music + SFX only; typography carries all words | script-estimated timings (the deterministic estimator we already use) |

`tts`/`none` make the pipeline fully autonomous — important for "new repo tomorrow, video by lunch".

## 11. Testing & evals

- **Golden timelines as fixtures** — every approved video's timeline joins `examples/motion/` and the few-shot pool; the library compounds.
- **Validator/linter property tests** — extend `test/motion.test.js`.
- **Determinism** — LLM calls cached by input hash (`.launchclip/cache/`); `direct --replay` re-renders without API calls.
- **Five-scenario eval set** (the out-of-the-box bar; run before calling any phase done):
  1. launchclip itself (`software_demo`, recorded take)
  2. A cold OSS repo never seen before (`software_demo`, TTS, no assets)
  3. "How DNS works" (`explainer`, TTS, zero assets)
  4. product-videogen with screenshots (`software_demo`, screenshot-heavy)
  5. "5 mistakes new freelancers make" (`listicle`, `--voice none`)
  Pass = renders warning-free, lints clean, and survives a human watch-through.

## 12. Phasing

| Phase | Scope | Outcome |
|---|---|---|
| **1. Director core** | catalog.js, presets.js (software_demo + explainer), direction parsing, DIRECT loop with structured outputs + repair, `direct` command wiring existing stages | Scenarios 1–3 work end to end |
| **2. Density + structure components** | chapter_rail, stat_counter, quote_card, words_on_footage + density linter tightening | Fluidity gap closes; education videos look structured |
| **3. Assets + breadth** | resolver (manifest, Brandfetch, vision classify), compare_split, chat_thread, icon_orbit, listicle/announcement/comparison presets, approval-gated image gen | Scenarios 4–5; logos auto-appear |
| **4. QA loop + character** | frame-sampling QA critic (vision call against the disqualifier checklist) → re-direct; mascot pose system | Self-correcting quality; the OpenClaw charm tier |
| **Port** | schema, catalog, presets, lint, director prompts → product-videogen; product-videogen supplies its own ingest (media library), voice (existing ElevenLabs), and review UI | The product |

## 13. Risks

| Risk | Mitigation |
|---|---|
| LLM timelines are mediocre even when valid | The linter is the lever — push every observed failure into a deterministic lint, not into prompt prose. Golden timelines as few-shot. |
| Density rules produce chaos instead of fluidity | Density lint has both floor AND ceiling; phase 2 components give the Director *legitimate* ways to fill time. |
| Asset legal (fetched logos) | Nominative use for mentioned tools is standard practice, but surface every fetched logo in the REVIEW packet for human sign-off. |
| Education claims are wrong | `model_knowledge` flags + review gate (§9). |
| Scope creep in launchclip | Phases 1–2 only need ~4 new files + catalog entries. The port to product-videogen is the deadline forcing function. |
