Open Remotion Studio (`npx remotion studio`) only after the automated gates,
visual still review, and `CINEMATIC-READINESS.json` all pass. Tell the user
where the editable project and preview are located, summarize any deliberate
limitations, and ask for explicit render approval.
Studio's Render button is useful for an ad hoc draft, but it is not the
workflow's approval signal or final artifact.

If the user edits `storyboard.json`, a bespoke module, or the props in Studio, rerun
`launchclip story validate` and `launchclip layout-check` and inspect fresh
stills before asking for approval. If those checks trigger a repair that
changes the visible result, refresh Studio and obtain fresh approval of that
repaired state.
