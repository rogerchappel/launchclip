# Cadence profile provenance

<!-- Generated from kit/profiles/*.json by launchclip profile measure (src/profile_store.js provenanceMarkdown). test/profiles.test.js fails when it drifts. -->

Each shipped cadence profile is a set of ranges over measurements of reference videos. Only measurements are stored, never a reference's frames, audio or text. References are videos we have the right to analyse: our own, licensed, or public videos analysed for statistics only.

A seed profile has no references yet: its ranges were set by hand, conservatively, and `launchclip profile measure <folder> --replace <id> --rights …` replaces it with a measured one.

## animated-explainer-reel

Animated explainer reel: motion, 30–75 s, 9:16.

- Provenance: measured (measured 2026-11-07T09:59:19.607Z)
- References: 2
- Note: Measured from 2 reference videos (public-statistics). Only statistics are stored; coverage is estimated from pixels. With fewer than 10 references, p10 and p90 are the smallest and largest reference values. Left out: face_time, text_hold_seconds. Two public faceless animated explainer reels (9:16, 62–70 s). face_time is left out because the face probe reads the drawn host as a presenter; text_hold_seconds because the designed-region estimate sees the whole illustrated frame as one graphic.

| Source | Rights | Duration | SHA-256 |
| --- | --- | --- | --- |
| reel-a.mp4 | public-statistics | 70.2 s | `94c5be881cb7` |
| reel-b.mp4 | public-statistics | 62.577 s | `6e1f91562e9c` |

## explainer-motion

Explainer motion: motion, 20–180 s.

- Provenance: seed
- References: 0
- Note: Seed ranges, not measured: set conservatively wide from the RFC placeholders and the current gate floors until a reference set is measured with launchclip profile measure. Treat the bands as guard rails, not targets to tune to.

## paper-diorama

Paper diorama reel: motion, 30–75 s, 9:16.

- Provenance: measured (measured 2026-11-08T22:45:31.516Z)
- References: 1
- Note: Measured from one public reel, as statistics only, with bands at ±25% because one reference cannot show its own spread. Moving sharpness and soft-frame share are left out: they are unstable with few held frames. A target, not a survey.

| Source | Rights | Duration | SHA-256 |
| --- | --- | --- | --- |
| reel-c.mp4 | public-statistics | 33.451 s | `c02b1c914cb4` |

## product-demo

Product demo: demo-led, 20–120 s.

- Provenance: seed
- References: 0
- Note: Seed ranges, not measured: set conservatively wide from the RFC placeholders and the current gate floors until a reference set is measured with launchclip profile measure. Treat the bands as guard rails, not targets to tune to.

## short-motion

Short motion: motion, 5–60 s, 9:16.

- Provenance: seed
- References: 0
- Note: Seed ranges, not measured: set conservatively wide from the RFC placeholders and the current gate floors until a reference set is measured with launchclip profile measure. Treat the bands as guard rails, not targets to tune to.

## short-talking-head

Short talking head: footage-led, 5–60 s, 9:16.

- Provenance: seed
- References: 0
- Note: Seed ranges, not measured: set conservatively wide from the RFC placeholders and the current gate floors until a reference set is measured with launchclip profile measure. Treat the bands as guard rails, not targets to tune to. face_time p90 0.85: a short that never cuts away from the presenter reads as static; lines that name something the viewer could see cut to full-frame inserts.

## story-characters

Story with characters: characters, 20–180 s, 16:9 or 9:16.

- Provenance: seed
- References: 0
- Note: Seed ranges, not measured: set conservatively wide from the RFC placeholders and the current gate floors until a reference set is measured with launchclip profile measure. Treat the bands as guard rails, not targets to tune to. The four dialogue measures (speaker_turns_per_min, line_seconds, reaction_share, longest_framing_seconds) are provisional and were set by hand on 2026-11-10; no reference video was measured for them. They come from the script contract's arithmetic (150 words a minute and 0.3 s between lines, so a line of 3 to 12 words runs about 1 to 5 s and plain back-and-forth gives 12 to 30 turns a minute), widened downwards for narrated stretches and silent beats; reaction_share has a floor only, set low at 10%; longest_framing_seconds sits a little above the scene_seconds ceiling because two scenes in a row can share a framing. As a check that the bands are not absurd, not as a source, two of this repository's own example projects (a 20 s 9:16 dialogue and a 23 s 16:9 story, both hand-authored) read 15 and 10 turns a minute, median lines of 2.0 and 3.4 s, 25% and 44% reaction, and 6.4 and 6.8 s on one framing. profile measure reads pixels and cannot hear who speaks, so replacing these four needs references annotated by hand (speaker per line, shot per framing) or our own approved renders measured from their project files.

## ui-explainer-reel

UI explainer reel: motion, 30–75 s, 9:16.

- Provenance: measured (measured 2026-11-08T00:33:01.997Z)
- References: 1
- Note: Measured from 1 reference video (public-statistics). Only statistics are stored; coverage is estimated from pixels. With one reference, p50 is its value and p10 and p90 are set 15% either side so the gate holds a band, not an exact match. Left out: face_time, text_hold_seconds, shot_seconds. One public faceless explainer reel (9:16, 46 s) that walks through software tools on dark animated interface panels with a small sprite host. face_time is left out because the face probe reads the sprite host as a presenter; text_hold_seconds because the designed-region estimate sees the whole interface as one graphic. shot_seconds is left out because the reference changes scene with whip-pans and wipes, which the cut detector does not see, so it measured one 46 s shot. The look measures (moving_sharpness_ratio, soft_frame_share, change_p99, top_light_ratio, midtone_share, burst_change_mean) are read on a fixed 360×640 grey grid, the sharpness ones against the reference's own held frames, so its 720p platform compression shifts them little. first_motion_seconds p90 is 0.35 s, not the reference's 0: the reference opens mid-move, while a reel that opens on a built frame needs a fraction of a second before whole-frame motion registers.

| Source | Rights | Duration | SHA-256 |
| --- | --- | --- | --- |
| reel-c.mp4 | public-statistics | 45.833 s | `22142d685096` |

## ui-steady-reel

UI reel, steady camera: motion, 30–75 s, 9:16.

- Provenance: measured (measured 2026-11-08T20:02:35.348Z)
- References: 1
- Note: Bands from ui-explainer-reel, with frame-change energy and camera moves re-centred (±15%) on one of our own renders with the steady camera, approved by eye: a target, not a survey. Moving sharpness and soft-frame share are left out: a steady camera has few held frames to compare, and they swung widely between renders.

| Source | Rights | Duration | SHA-256 |
| --- | --- | --- | --- |
| steady-reel.mp4 | own | 46.8 s | `2dc6f7196dae` |

## youtube-long-form

YouTube long form: footage-led, 300–1800 s, 16:9 or 1:1.

- Provenance: seed
- References: 0
- Note: Seed ranges, not measured: set conservatively wide from the RFC placeholders and the current gate floors until a reference set is measured with launchclip profile measure. Treat the bands as guard rails, not targets to tune to. The attention-reset interval (a reset about every minute, never more than two) is a seed from the long-form RFC row, not a measurement.

## youtube-talking-head-launch

YouTube talking-head launch: footage-led, 60–300 s, 16:9 or 1:1.

- Provenance: seed
- References: 0
- Note: Seed ranges, not measured: set conservatively wide from the RFC placeholders and the current gate floors until a reference set is measured with launchclip profile measure. Treat the bands as guard rails, not targets to tune to.
