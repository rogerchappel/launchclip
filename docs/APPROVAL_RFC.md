# RFC: Approval packs and review in Slack

Status: proposed. Nothing here is built yet.
Date: 2026-11-24
Builds on: [CAROUSELS_RFC.md](CAROUSELS_RFC.md) (the export folder per
destination), [COLLECTIONS_RFC.md](COLLECTIONS_RFC.md) (batches),
[SCORING_ROADMAP.md](SCORING_ROADMAP.md) (a day's carousels)

## 1. Summary

LaunchClip can make a day's posts, but nothing tells a person they are ready,
and nothing brings that person's decision back. This RFC adds one small
command group, `launchclip approval`:

- `build` gathers finished posts (carousels, single images, videos) into an
  **approval pack**: one folder with every file per platform, every caption,
  one `APPROVAL.json` and one page to read them on.
- `post` sends each post to a Slack channel, where reviewers answer with a
  reaction or a reply.
- `pull` reads those answers back into `APPROVAL.json`.

It stays a CLI. It has no server, no account and no scheduler of its own.

## 2. Goals and non-goals

Goals:

- A reviewer learns that posts are waiting without anyone messaging them.
- A reviewer can decide from a phone, away from the machine that made the posts.
- Decisions come back as data a script or an agent can act on.
- A host application can read the same pack and run its own review screen.

Non-goals:

- Publishing or scheduling to social platforms. The pack ends at "approved".
- A hosted review site. The page is static files; where it is served is the
  user's choice.
- Slack buttons. Buttons need a public endpoint that Slack calls; a CLI has
  none. Reactions and thread replies need only polling.
- Email, Teams or Discord delivery. The pack format allows them later (§8).

## 3. What already exists

| Need | Where it is today |
|---|---|
| Files per platform for a carousel or single image | `carousel export` writes `carousel/<dest>/` with numbered slides, a PDF where the platform takes one, `caption.md`, `alt.json` and `CAROUSEL.json` |
| Video and mixed carousels | Motion slides are separate clips (`NN.mp4`), with the still as fallback where a platform takes images only (CAROUSELS_RFC §5.3) |
| A video's publishing text | `publish-manifest` writes `publish.json` (titles, description, hashtags, platform fit) |
| Check results | `carousel check`, the score rubric gate, the finish gates |
| A static page a host can serve | `preview --export` already writes a player as plain files |
| A batch of posts for one day | `score batch` |

Missing: one place that lists a batch with its decisions, any notification,
and any way to get a decision back.

## 4. The approval pack

```
approval/
  APPROVAL.json
  index.html
  posts/
    01-<id>/
      instagram/01.png … caption.md
      tiktok/01.jpg …
      linkedin/slides.pdf
      video.mp4            (a video post)
```

`APPROVAL.json` (`launchclip.approval.v1`):

```json
{
  "schema": "launchclip.approval.v1",
  "title": "Week of 25 November",
  "created": "2026-11-24T10:00:00Z",
  "posts": [
    {
      "id": "ranked-01",
      "n": 1,
      "title": "5 mistakes that slow your launch",
      "kind": "carousel",
      "slides": 7,
      "day": "2026-11-25",
      "folder": "posts/01-ranked-01",
      "destinations": {
        "instagram": { "files": ["01.png", "02.png"], "caption": "…" },
        "linkedin": { "files": ["slides.pdf"], "caption": "…" }
      },
      "checks": { "ok": true, "warnings": [] },
      "decision": "pending",
      "note": "",
      "decided_by": null,
      "slack": null
    }
  ]
}
```

- `kind` is `carousel`, `image` (one slide) or `video`.
- `decision` is `pending`, `approved`, `changes` or `dropped`.
- A caption is the full text to paste for that platform. It comes from
  `captions.json` in the project when present (`{"instagram": "…"}`, written
  by hand or by a model for that platform), else from the export's
  `caption.md` hook, body, call to action and tags.
- `slack` holds `{channel, ts}` once the post is sent, so `pull` and a second
  `post` know where it lives.
- The pack is self-contained: paths are relative, so the folder can be zipped,
  synced or served as it is.

`index.html` shows each post with its slides, the captions with a copy button
and a character count, and Approve / Change / Drop with a note. It keeps marks
in the browser and offers "Copy decisions" as JSON, which
`approval pull --from <file>` reads. This is the path with no Slack at all.

## 5. Commands

```
launchclip approval build <project>… --out <dir> [--title "…"] [--day YYYY-MM-DD] [--dest instagram,tiktok,…]
launchclip approval post  <dir> --slack [--channel <id>] [--url <where the page is served>] [--json]
launchclip approval pull  <dir> [--slack] [--from decisions.json] [--json]
launchclip approval status <dir> [--json]
```

- `build` exports any project whose export is missing or older than its
  storyboard, copies the files in, and adds to an existing pack instead of
  replacing it. A post already in the pack keeps its decision unless its files
  changed, in which case it returns to `pending`.
- `post` sends every post that has no `slack` entry. Running it twice sends
  nothing twice.
- `pull` updates decisions and prints the tally. It exits non-zero while any
  post is `pending`, so a script can wait on it.
- `status` prints the tally without calling anything.

## 6. Slack

### 6.1 What the reviewer sees

One message per post in the channel: the number and title, the kind, the day,
any check warnings, and how to answer. The slides are uploaded into that
message's thread (up to ten images, or the video), followed by one reply per
platform with the caption in a code block, ready to copy.

To answer:

| Reviewer does | Decision |
|---|---|
| Adds ✅ to the post | `approved` |
| Adds ❌ | `dropped` |
| Replies in the thread | `changes`, with the reply as the note |
| Replies, then adds ✅ | `approved`, the note kept |

The newest signal wins. The bot's own messages and reactions are ignored
(`auth.test` gives its user id). With `--approvers U123,U456` only those
people's answers count.

### 6.2 What it needs

A Slack app in the user's own workspace with a bot token in
`SLACK_BOT_TOKEN`, a channel id in `SLACK_APPROVAL_CHANNEL` (or `--channel`),
and the bot invited to that channel. Scopes: `chat:write`, `files:write`,
`reactions:read`, and `channels:history` (`groups:history` for a private
channel).

### 6.3 Calls

| Step | Method |
|---|---|
| Who am I | `auth.test` |
| The post | `chat.postMessage` (returns `ts`) |
| Each file | `files.getUploadURLExternal`, POST the bytes, then one `files.completeUploadExternal` with `channel_id` and `thread_ts` |
| Captions | `chat.postMessage` with `thread_ts` |
| Reactions | `reactions.get` |
| Replies | `conversations.replies` |

The message is posted before the files because the upload call does not
return a message timestamp. Posting is paced at one message a second per
channel, Slack's limit. A 429 waits for `Retry-After` and tries again.

### 6.4 Safety

- The token is read from the environment and never written to the pack, a log
  or an error message.
- Slack text is data. A reply becomes a note; nothing in it is run or followed.
- `post` uploads the user's content to the user's Slack. It is the only
  command here that sends anything off the machine, and only with `--slack`.

## 7. Review away from the machine

Two ways, and they combine:

1. **Slack** (§6): nothing to host.
2. **The page**: `index.html` is static. Put the folder on any static host or
   shared drive and pass its address as `--url`; the Slack message then links
   to it. Decisions made on the page come back by pasting "Copy decisions"
   into the thread or a file.

## 8. Running it every night

LaunchClip does not schedule. One line in cron, launchd or a CI workflow does:

```
0 6 * * *  cd ~/content && launchclip score batch … && launchclip approval build out/today/* --out approval && launchclip approval post approval --slack
*/15 7-20 * * *  cd ~/content && launchclip approval pull approval --slack --json > approval/decisions.json
```

A host application that has its own scheduler, queue and notifications reads
`APPROVAL.json` (or builds the same posts itself) and skips `post` and `pull`.
The pack is the contract between the engine and such a host: files per
platform, a caption per platform, and a decision.

Other channels later: `post` takes one sender today. Email or a plain webhook
would be a second sender with the same input.

## 9. Phases

1. `build`, `status` and the page.
2. `post --slack` and `pull --slack`.
3. `pull --from` for decisions copied from the page.

Later, if asked for: more senders, and `approval apply`, which hands each
`changes` note back to the planner as an edit.

## 10. Open questions

- Should a `changes` note trigger a rewrite on its own, or always wait for a
  person? Proposed: always wait.
- More than ten slides: Slack shows files well up to about ten in a thread.
  Proposed: upload the first ten and link the rest through `--url`.
- Per-platform captions live in a side file (`captions.json`) for now. If
  they prove useful they belong in the story's `carousel.caption`.
