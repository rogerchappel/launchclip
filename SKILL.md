# launchclip Skill

Use this skill when Roger wants to promote a local OSS repo with a reviewable packet before anything is posted.

## Workflow

1. Identify the repo path, intended audience, and approved demo command.
2. Ask before running non-trivial or state-changing demo commands.
3. Prefer the one-command dry-run workflow:

   ```bash
   launchclip run <repo> --out .launchclip/<repo-name> --demo-cmd "<command>" --angle "<social angle>" --audience "<target audience>"
   ```

4. For manual staging, run `init`, `demo`, `plan`, `captions`, `render --dry-run`, `submit-review --dry-run`, `validate`, and `review`.
5. Inspect `demo/terminal.txt` and `demo/command-receipt.json`; launchclip redacts common secret patterns, but agents should still verify no sensitive values are present.
6. Present `REVIEW.md` and `review/social-readiness.json` for human review.

## Side-Effect Boundaries

- Do not post to social media.
- Do not submit live product-videogen or Clutch Cut requests unless local config, explicit approval, and a future supported submission path are present.
- Do not publish packages, tag releases, merge PRs, or create GitHub Releases.
- Treat generated captions as drafts.
- Treat redacted receipts as review artifacts, not permission to run commands that print secrets.

## Validation

Run `launchclip validate <workspace>` before using a generated packet. Run `npm test`, `npm run smoke`, or `npm run check` before handing off a launchclip repo change.

## Approval Checkpoints

Human approval is required before final rendering, external uploads, Review Feed submission, social queueing, or posting.
