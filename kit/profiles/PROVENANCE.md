# Cadence profile provenance

<!-- Generated from kit/profiles/*.json by launchclip profile measure (src/profile_store.js provenanceMarkdown). test/profiles.test.js fails when it drifts. -->

Each shipped cadence profile is a set of ranges over measurements of reference videos. Only measurements are stored, never a reference's frames, audio or text. References are videos we have the right to analyse: our own, licensed, or public videos analysed for statistics only.

A seed profile has no references yet: its ranges were set by hand, conservatively, and `launchclip profile measure <folder> --replace <id> --rights …` replaces it with a measured one.

## animated-explainer-reel

Animated explainer reel: motion, 30–75 s, 9:16.

- Provenance: measured (measured 2026-11-07T07:30:59.827Z)
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
- Note: Seed ranges, not measured: set conservatively wide from the RFC placeholders and the current gate floors until a reference set is measured with launchclip profile measure. Treat the bands as guard rails, not targets to tune to.

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
