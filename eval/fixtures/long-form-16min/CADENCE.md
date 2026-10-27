# Beat map dry run

2241 words at 155 wpm (dry-run timings, no voice), `node eval/beat-map-dry-run.mjs`.

```text
beat map: Halcyon 2, explained: what a frontier model launch actually changes — 16.3 min, 12 chapters, 48 shots, 158 states
cadence passed (long-form, default): 157 events, 9.65/min; gaps p10 3.897 / p50 5.753 / p90 8.874 s; longest static 11.517 s; 47 cuts, median 20.607 s apart
  ok   per_min            9.65  want 9–16 (target 11.5)
  ok   gap_p50           5.753  want 4–6.5 s
  ok   gap_p10           3.897  want ≥ 1.5 s
  ok   gap_p90           8.874  want ≤ 10.5 s
  ok   longest_static   11.517  want ≤ 14 s
  ok   cut_gap_p50      20.607  want 15–25 s
states per shot 1–4 (mean 3.29); changes enter 48, swap 87, build 23
variety: 24 modules; top icon-row 14%, timeline 9%, glass-word 8%, motion-title 8%, kinetic-words 8%; longest same-module run across cuts 2
evidence: 57/85 claims shown with a sourced visual (67%), 13 on a capture
fallbacks (planned modules not registered yet): particle-text→glass-word ×13, title-decompose→motion-title ×9, glass-bars-3d→bar-chart ×8, paper-stack→excerpt ×6, social-post→feed-frame ×6, tokenizer→kinetic-words ×5, evidence-chain→timeline ×4, coin-stack→stat-card ×4, lineage-graph→timeline ×3, repo-pr-card→window-chrome ×2, date-pinned-timeline→timeline ×2, diff-view→excerpt ×2, month-grid→timeline ×1, rack-shelf→stat-card ×1, terminal-session→window-chrome ×1, commit-card→excerpt ×1, social-stack→quote-card ×1
chunks: 12 (0 reused)
```
