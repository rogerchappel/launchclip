## Reuse a project-local style pack

Treat `.launchclip/styles/<name>` as the default home for a user's reusable
channel or series identity. When the user names a style, resolve an explicit
directory first, then that project-local path. If a pack exists:

- Read `style.json` and the complete `frame.md` before designing.
- Inspect any caption skin, fonts, audio notes, and assets named by the pack.
- Copy the resolved pack into the output project's `style/` directory so the
  composition and later render do not depend on mutable external files.
- Record the pack name and source path in `BRIEF.md`. Translate its palette,
  type roles, graphic language, motion character, and forbidden motifs into
  the project-specific `DESIGN.md`; keep scene composition driven by this
  video's content rather than cloning the previous edit.

If no pack exists, treat the requested words as creative direction and design
an original system for the video. Do not substitute a built-in branded preset.
After an approved video, create a reusable pack only when the user asks, using
`launchclip style create <name> --from <output-project>`. This local management
command makes no model calls. Never overwrite an existing pack without explicit
`--force` approval.
