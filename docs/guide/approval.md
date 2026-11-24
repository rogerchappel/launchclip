# Approval packs and Slack review

Make a batch of posts, tell a reviewer they are ready, and get the decisions
back. The design is in [APPROVAL_RFC.md](../APPROVAL_RFC.md).

## 1. Build a pack

```
launchclip approval build out/monday/* --out approval --title "Week of 25 November" --day 2026-11-25
```

Each project is a rendered carousel or single image (`launchclip carousel
render` first) or a finished video (`renders/final.mp4`). The pack is one
folder:

- `APPROVAL.json`: every post, its files and caption per platform, and its decision.
- `index.html`: the same on one page, with Approve, Change, Drop and a note per post.
- `posts/NN-<id>/`: the files to upload, in a folder per platform.

Captions come from the carousel's own caption, shaped for each platform. To
use text written for one platform, put a `captions.json` in the project:

```json
{ "instagram": "Full caption for Instagram", "linkedin": "Full caption for LinkedIn" }
```

Run `build` again to add projects. A post keeps its decision unless its files
or captions changed. Two projects with the same folder name are the same post.

## 2. Review on the page

Open `index.html`, mark each post, then press **Copy decisions** and save
what it copies to a file:

```
launchclip approval pull approval --from decisions.json
```

The page is plain files. To review away from your machine, put the folder on
any static host or shared drive.

## 3. Review in Slack

One-time setup, in your own workspace:

1. Create an app at api.slack.com/apps ("From scratch").
2. Under **OAuth & Permissions**, add the bot scopes `chat:write`,
   `files:write`, `reactions:read` and `channels:history` (`groups:history`
   too for a private channel).
3. Install the app to the workspace and copy the **Bot User OAuth Token**
   (starts `xoxb-`) into `SLACK_BOT_TOKEN` in your `.env`.
4. Invite the bot to the review channel (`/invite @your-app`) and put the
   channel's id (channel details, at the bottom) in `SLACK_APPROVAL_CHANNEL`.

Then:

```
launchclip approval post approval --slack
launchclip approval pull approval --slack
```

`post` sends one message per undecided post, with its slides (the first ten)
and each platform's caption in the thread. It never sends a post twice.

Reviewers answer in Slack:

| Do this | Decision |
|---|---|
| Add ✅ (or 👍) to the post | approved |
| Add ❌ (or 👎) | dropped |
| Reply in the thread | changes, with the reply as the note |

A tick wins over a cross, and a reaction wins over a reply. `--approvers
U123,U456` counts only those people. `pull` exits 1 while any post is
undecided, so a script can wait on it. `--url <address>` on `post` adds a
link to the review page if you host it.

`post --slack` uploads your slides and captions to your Slack workspace.
Nothing else in LaunchClip sends them anywhere.

## 4. Every night

LaunchClip has no scheduler. Use cron, launchd or a CI workflow:

```
0 6 * * *        cd ~/content && launchclip approval build out/today/* --out approval && launchclip approval post approval --slack
*/15 7-20 * * *  cd ~/content && launchclip approval pull approval --slack --json > approval/decisions.json
```

## 5. From a host application

An application with its own queue and notifications can read `APPROVAL.json`
instead of using Slack: each post lists its files and caption per platform
and carries a `decision` of `pending`, `approved`, `changes` or `dropped`.
