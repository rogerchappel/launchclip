Open HyperFrames Studio only after the automated gates, visual snapshot review,
and `CINEMATIC-READINESS.json` all pass. Tell the user where the editable
project and preview are located, summarize any deliberate limitations, and ask
for explicit render approval.
Studio's Export action is useful for an ad hoc draft, but it is not the
workflow's approval signal or final artifact.

If Studio changes the composition, rerun the browser check and inspect fresh
snapshots before asking for approval. If those checks trigger a repair that
changes the visible result, refresh Studio and obtain fresh approval of that
repaired state.
