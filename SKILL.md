# launchclip Skill

Use this skill when Roger wants to promote a local OSS repo with a reviewable packet before anything is posted.

## Workflow

1. Identify the repo path, intended audience, and approved demo command.
2. Run `launchclip init <repo> --out .launchclip/<repo-name>`.
3. Ask before running non-trivial or state-changing demo commands.
4. Run `launchclip demo <repo> --out .launchclip/<repo-name> --demo-cmd "<command>" --capture terminal`.
5. Run `launchclip plan .launchclip/<repo-name> --format short-30 --renderer none`.
6. Run `launchclip captions .launchclip/<repo-name> --platforms x,linkedin,tiktok,bluesky`.
7. Run `launchclip render .launchclip/<repo-name> --provider product-videogen --dry-run`.
8. Run `launchclip submit-review .launchclip/<repo-name> --provider product-videogen --dry-run`.
9. Run `launchclip review .launchclip/<repo-name>` and present `REVIEW.md` for human review.

## Side-Effect Boundaries

- Do not post to social media.
- Do not submit live product-videogen or Clutch Cut requests unless local config, explicit approval, and a future supported submission path are present.
- Do not publish packages, tag releases, merge PRs, or create GitHub Releases.
- Treat generated captions as drafts.

## Validation

Run `npm test`, `npm run smoke`, or `npm run check` before handing off a repo change.

## Approval Checkpoints

Human approval is required before final rendering, external uploads, Review Feed submission, social queueing, or posting.
