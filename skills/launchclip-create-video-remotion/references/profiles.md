# Cadence profiles

<!-- Generated from kit/profiles/*.json by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->

A cadence profile (`launchclip.cadence-profile.v1`) is what a strong video of one format and platform measures like: ranges (p10, p50, p90) over measurements of a reference set. Plan to the p50 targets inside the p10–p90 band; `launchclip finish` measures the render against the band. `launchclip profile list` and `launchclip profile show <id>` print them; `launchclip profile measure <folder>` measures your own references into one. Design: `docs/VIDEO_QUALITY_RFC.md` §5.

Every shipped profile is a seed until it is measured: conservative ranges, not statistics. Treat the bands as guard rails.

## Choosing a profile

The profile follows the story's lane, aspect, duration and platform (a direction map's `profile` or a style's `profile` names one explicitly):

| Profile | Format | Lanes | Aspects | Duration | Provenance |
| --- | --- | --- | --- | --- | --- |
| explainer-motion | motion | motion, voiceover-motion | any | 20–180 s | seed |
| product-demo | demo-led | motion, voiceover-motion | any | 20–120 s | seed |
| short-motion | motion | motion, voiceover-motion | 9:16 | 5–60 s | seed |
| short-talking-head | footage-led | footage-led | 9:16 | 5–60 s | seed |
| story-characters | characters | motion, voiceover-motion | 16:9, 9:16 | 20–180 s | seed |
| youtube-long-form | footage-led | footage-led | 16:9, 1:1 | 300–1800 s | seed |
| youtube-talking-head-launch | footage-led | footage-led | 16:9, 1:1 | 60–300 s | seed |

## Measures

| Measure | What it is | Gate holds |
| --- | --- | --- |
| shot_seconds | length of a shot between visual changes | p10 and p90 |
| visual_changes_per_min | changes in what is on screen (a scene starts or ends, a cut, a camera move) | p10 and p90 |
| coverage | share of the runtime with a designed graphic on screen | p10 and p90 |
| face_time | share of the runtime with the presenter's face visible | p10 and p90 |
| longest_undressed_seconds | longest stretch with no graphic on screen | p90 (a ceiling) |
| first_visual_seconds | when the first designed graphic appears | p90 (a ceiling) |
| text_hold_seconds | how long a graphic holds on screen | p10 and p90 |
| caption_words_on_screen | caption words visible at once | p90 (a ceiling) |
| layout_changes_per_min | switches between full, split, framed, stacked and insert layouts | p90 (a ceiling) |
| longest_without_reset_seconds | longest stretch with no attention reset (a layout change, an insert or a section card); long form plans a reset every p50 | p90 (a ceiling) |
| subject_effect_share | share of the runtime with a presenter (subject) effect | p90 (a ceiling) |
| flow_velocity_p90 | 90th-percentile optical-flow velocity of the render | p10 (a floor) |
| hold_ratio | share of near-static frames | p90 (a ceiling) |
| motion_bursts_per_min | meaningful motion bursts per minute | p10 (a floor) |
| change_energy_p50 | median frame-change energy | p10 (a floor) |
| first_motion_seconds | when the first meaningful motion arrives | p90 (a ceiling) |
| hook_events | distinct cuts or motion bursts inside the hook window | p10 (a floor) |
| scene_seconds | scene length (character stories) | p10 and p90 |
| character_screen_time | share of the runtime with a character on screen | p10 and p90 |
| expression_changes_per_min | pose or expression changes per minute | p10 and p90 |
| problem_lands_seconds | how soon the problem beat lands | p90 (a ceiling) |

## explainer-motion

A motion or voiceover-motion explainer of 30 s to 3 minutes, any aspect.

| Measure | p10 | p50 | p90 |
| --- | --- | --- | --- |
| shot_seconds | 1 | 3 | 8 |
| visual_changes_per_min | 5 | 20 | 45 |
| coverage | 90% | 100% | 100% |
| longest_undressed_seconds | — | 0 | 1 |
| first_visual_seconds | — | 0 | 0.5 |
| text_hold_seconds | 1 | 2.8 | 8 |
| caption_words_on_screen | — | 3 | 7 |
| flow_velocity_p90 | 2 | — | — |
| hold_ratio | — | — | 80% |
| motion_bursts_per_min | 20 | — | — |
| change_energy_p50 | 0.35 | — | — |
| first_motion_seconds | — | — | 0.35 |
| hook_events | 3 | — | — |

## product-demo

A video led by recorded product flows (product-demo scenes), 30 s to 2 minutes, any aspect.

| Measure | p10 | p50 | p90 |
| --- | --- | --- | --- |
| shot_seconds | 1.2 | 3.5 | 10 |
| visual_changes_per_min | 4 | 16 | 36 |
| coverage | 90% | 100% | 100% |
| longest_undressed_seconds | — | 0 | 1 |
| first_visual_seconds | — | 0 | 0.5 |
| text_hold_seconds | 1 | 3 | 10 |
| caption_words_on_screen | — | 3 | 7 |
| flow_velocity_p90 | 2 | — | — |
| hold_ratio | — | — | 80% |
| motion_bursts_per_min | 20 | — | — |
| change_energy_p50 | 0.35 | — | — |
| first_motion_seconds | — | — | 0.35 |
| hook_events | 3 | — | — |

## short-motion

Motion graphics (with or without a voiceover) for Shorts, Reels and TikTok.

| Measure | p10 | p50 | p90 |
| --- | --- | --- | --- |
| shot_seconds | 0.8 | 2 | 8 |
| visual_changes_per_min | 6 | 28 | 60 |
| coverage | 90% | 100% | 100% |
| longest_undressed_seconds | — | 0 | 1 |
| first_visual_seconds | — | 0 | 0.5 |
| text_hold_seconds | 0.8 | 2.2 | 6 |
| caption_words_on_screen | — | 3 | 6 |
| flow_velocity_p90 | 2 | — | — |
| hold_ratio | — | — | 80% |
| motion_bursts_per_min | 20 | — | — |
| change_energy_p50 | 0.35 | — | — |
| first_motion_seconds | — | — | 0.35 |
| hook_events | 3 | — | — |

## short-talking-head

A presenter on camera, dressed with graphics, for Shorts, Reels and TikTok.

| Measure | p10 | p50 | p90 |
| --- | --- | --- | --- |
| shot_seconds | 0.8 | 2.2 | 5 |
| visual_changes_per_min | 10 | 22 | 45 |
| coverage | 35% | 60% | 92% |
| face_time | 45% | 75% | 100% |
| longest_undressed_seconds | — | 4 | 8 |
| first_visual_seconds | — | 0.5 | 1.5 |
| text_hold_seconds | 0.8 | 2 | 5 |
| caption_words_on_screen | — | 3 | 6 |
| layout_changes_per_min | — | 2 | 10 |
| subject_effect_share | — | 20% | 35% |
| flow_velocity_p90 | 0 | 1.1 | 6 |
| hold_ratio | — | — | 100% |
| motion_bursts_per_min | 0 | — | — |
| change_energy_p50 | 0 | — | — |
| first_motion_seconds | — | — | 2 |
| hook_events | 1 | — | — |

## story-characters

A fully animated story told by a cast (setup, problem, attempt, turn, resolution), 30 s to 3 minutes, 16:9 or 9:16.

| Measure | p10 | p50 | p90 |
| --- | --- | --- | --- |
| scene_seconds | 1.5 | 4 | 9 |
| visual_changes_per_min | 5 | 18 | 40 |
| coverage | 90% | 100% | 100% |
| longest_undressed_seconds | — | 0 | 1 |
| first_visual_seconds | — | 0 | 0.5 |
| character_screen_time | 40% | 70% | 95% |
| expression_changes_per_min | 3 | 8 | 20 |
| problem_lands_seconds | — | 5 | 12 |
| caption_words_on_screen | — | 3 | 6 |
| flow_velocity_p90 | 2 | — | — |
| hold_ratio | — | — | 80% |
| motion_bursts_per_min | 20 | — | — |
| change_energy_p50 | 0.35 | — | — |
| first_motion_seconds | — | — | 0.35 |
| hook_events | 3 | — | — |

## youtube-long-form

A presenter-led video of 5–30 minutes in 16:9, structured in chapters.

| Measure | p10 | p50 | p90 |
| --- | --- | --- | --- |
| shot_seconds | 1.5 | 5 | 15 |
| visual_changes_per_min | 4 | 10 | 24 |
| coverage | 25% | 48% | 80% |
| face_time | 50% | 80% | 97% |
| longest_undressed_seconds | — | 14 | 30 |
| first_visual_seconds | — | 0.5 | 3 |
| text_hold_seconds | 1.2 | 3 | 8 |
| caption_words_on_screen | — | 3 | 7 |
| layout_changes_per_min | — | 1.5 | 4 |
| longest_without_reset_seconds | — | 60 | 120 |
| subject_effect_share | — | 10% | 30% |
| flow_velocity_p90 | 0 | 1.1 | 6 |
| hold_ratio | — | — | 100% |
| motion_bursts_per_min | 0 | — | — |
| change_energy_p50 | 0 | — | — |
| first_motion_seconds | — | — | 3 |
| hook_events | 1 | — | — |

## youtube-talking-head-launch

A founder or presenter launch video, 1–5 minutes in 16:9, for YouTube and landing pages.

| Measure | p10 | p50 | p90 |
| --- | --- | --- | --- |
| shot_seconds | 1.2 | 3.8 | 11 |
| visual_changes_per_min | 6 | 16 | 32 |
| coverage | 35% | 62% | 90% |
| face_time | 45% | 72% | 95% |
| longest_undressed_seconds | — | 8 | 14 |
| first_visual_seconds | — | 0.5 | 2 |
| text_hold_seconds | 1 | 2.4 | 6 |
| caption_words_on_screen | — | 3 | 6 |
| layout_changes_per_min | — | 2.5 | 6 |
| subject_effect_share | — | 15% | 35% |
| flow_velocity_p90 | 0 | 1.1 | 6 |
| hold_ratio | — | — | 100% |
| motion_bursts_per_min | 0 | — | — |
| change_energy_p50 | 0 | — | — |
| first_motion_seconds | — | — | 2 |
| hook_events | 1 | — | — |
