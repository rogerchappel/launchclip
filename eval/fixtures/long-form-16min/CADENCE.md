# Beat map dry run

2241 words at 155 wpm (dry-run timings, no voice), `node eval/beat-map-dry-run.mjs`.

```text
beat map: Halcyon 2, explained: what a frontier model launch actually changes — 16.3 min, 12 chapters, 48 shots, 156 states
cadence passed (long-form, default): 155 events, 9.53/min, 14.37 words per event; gaps p10 3.905 / p50 5.772 / p90 8.933 s; longest static 11.517 s; 47 cuts, median 20.607 s apart
  ok   per_min            9.53  want 9–16 (target 11.5)
  ok   gap_p50           5.772  want 4–6.5 s
  ok   gap_p10           3.905  want ≥ 1.5 s
  ok   gap_p90           8.933  want ≤ 10.5 s
  ok   longest_static   11.517  want ≤ 14 s
  ok   words_per_event   14.37  want 10–20 words
  ok   cut_gap_p50      20.607  want 15–25 s
states per shot 1–4 (mean 3.29); changes enter 48, swap 106, hold 2, build 2
variety: 22 modules; top motion-title 24%, kinetic-words 24%, concept-card 15%, quote-card 5%, process-steps 4%; longest same-module run across cuts 2
evidence: 60/86 claims shown with a sourced visual (70%), 16 on a capture
chunks: 12 (0 reused)

shorts: 4 cut for 9:16 at short-form cadence
  ok   short-1-reading-the-benchmarks-honestly       598.317–643.252  45.335 s  14 events, p50 2.801 s, 4 cuts  skeleton versus  opens on percent-fill
  ok   short-2-what-northlight-actually-announced    287.073–309.85   23.177 s  7 events, p50 2.524 s, 3 cuts  skeleton none  opens on odometer
  ok   short-3-inside-the-training-run               163.723–211.413   48.09 s  15 events, p50 2.499 s, 5 cuts  skeleton dollar-a-second  opens on odometer
  ok   short-4-the-price-cut-and-who-pays-for-it     521.663–557.521  36.258 s  11 events, p50 2.899 s, 3 cuts  skeleton none  opens on quote-card
```
