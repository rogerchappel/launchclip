// Slack for an approval pack (docs/APPROVAL_RFC.md §6): post each post to a
// channel, then read reactions and thread replies back as decisions. Polling
// only, so it needs a bot token and no public endpoint.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { previewDestination } from "./page.js";

const API = "https://slack.com/api/";
const APPROVE = ["white_check_mark", "heavy_check_mark", "+1", "thumbsup"];
const DROP = ["x", "-1", "thumbsdown", "no_entry_sign"];
// shortcut: a thread shows about ten files well; the rest are reached through --url (RFC §10).
const MAX_FILES = 10;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** call(method, params, {get, json}) against the Web API. The token never appears in an error. */
export function slackClient({ token, fetch = globalThis.fetch, sleep = pause }) {
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set; see docs/guide/approval.md");
  return async function call(method, params = {}, { get = false, json = false } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${API}${method}${get ? `?${new URLSearchParams(params)}` : ""}`, {
        method: get ? "GET" : "POST",
        headers: { authorization: `Bearer ${token}`, ...(get ? {} : { "content-type": json ? "application/json; charset=utf-8" : "application/x-www-form-urlencoded" }) },
        body: get ? undefined : json ? JSON.stringify(params) : new URLSearchParams(params)
      });
      if (response.status === 429 && attempt < 3) { await sleep((Number(response.headers.get("retry-after")) || 1) * 1000); continue; }
      const data = await response.json().catch(() => ({}));
      if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error ?? `HTTP ${response.status}`}`);
      return data;
    }
  };
}

const KIND = { carousel: "Carousel", image: "Image", video: "Video" };

function headline(post, url) {
  return [
    `*${post.n}. ${post.title}*`,
    [`${KIND[post.kind] ?? post.kind}${post.slides > 1 ? `, ${post.slides} slides` : ""}`, post.day].filter(Boolean).join(" · "),
    ...post.checks.warnings.map((warning) => `:warning: ${warning}`),
    "React :white_check_mark: to approve or :x: to drop. Reply in this thread to ask for changes.",
    url ? `<${url}|Open the review page>` : null
  ].filter(Boolean).join("\n");
}

/**
 * Send every undecided post that is not in Slack yet. `save` is called after
 * each post so a failure half way never sends the earlier ones twice.
 */
export async function postPack(dir, pack, { call, channel, url = null, fetch = globalThis.fetch, sleep = pause, save = async () => {} }) {
  if (!channel) throw new Error("no Slack channel; pass --channel <id> or set SLACK_APPROVAL_CHANNEL");
  const sent = [];
  for (const post of pack.posts) {
    if (post.slack || post.decision !== "pending") continue;
    const message = await call("chat.postMessage", { channel, text: headline(post, url), unfurl_links: false }, { json: true });
    post.slack = { channel: message.channel, ts: message.ts };
    await save();
    const uploads = [];
    for (const file of post.destinations[previewDestination(post)].files.filter((name) => !/\.pdf$/i.test(name)).slice(0, MAX_FILES)) {
      const bytes = await readFile(path.join(dir, post.folder, file));
      const slot = await call("files.getUploadURLExternal", { filename: path.basename(file), length: bytes.length });
      const stored = await fetch(slot.upload_url, { method: "POST", body: bytes });
      if (!stored.ok) throw new Error(`Slack upload of ${file} failed: HTTP ${stored.status}`);
      uploads.push({ id: slot.file_id, title: path.basename(file) });
    }
    if (uploads.length) await call("files.completeUploadExternal", { files: uploads, channel_id: message.channel, thread_ts: message.ts }, { json: true });
    for (const [name, dest] of Object.entries(post.destinations)) {
      if (!dest.caption) continue;
      await sleep(1000); // Slack allows about one message a second per channel.
      await call("chat.postMessage", { channel: message.channel, thread_ts: message.ts, text: `*${name}*\n\`\`\`${dest.caption}\`\`\``, unfurl_links: false }, { json: true });
    }
    sent.push(post.id);
    await sleep(1000);
  }
  return sent;
}

/**
 * Read each posted message's reactions and replies into decisions: a tick
 * approves, a cross drops, a reply alone asks for changes; replies are the note.
 * The bot's own messages are ignored. Reply text is data, never an instruction.
 */
export async function pullPack(pack, { call, approvers = null }) {
  const me = (await call("auth.test")).user_id;
  const counts = (user) => user && user !== me && (!approvers || approvers.includes(user));
  for (const post of pack.posts) {
    if (!post.slack) continue;
    const { channel, ts } = post.slack;
    const reactions = (await call("reactions.get", { channel, timestamp: ts, full: true }, { get: true })).message?.reactions ?? [];
    const who = (names) => reactions.filter((reaction) => names.includes(reaction.name.split("::")[0])).flatMap((reaction) => reaction.users ?? []).filter(counts);
    const replies = ((await call("conversations.replies", { channel, ts, limit: 200 }, { get: true })).messages ?? []).filter((message) => message.ts !== ts && !message.bot_id && counts(message.user) && message.text?.trim());
    const [approved, dropped] = [who(APPROVE), who(DROP)];
    const note = replies.map((message) => message.text.trim()).join("\n");
    const decision = approved.length ? "approved" : dropped.length ? "dropped" : note ? "changes" : null;
    if (decision) Object.assign(post, { decision, note, decided_by: [...new Set([...approved, ...dropped, ...replies.map((message) => message.user)])], slack: { channel, ts, decided: true } });
    // A reaction taken back returns the post to pending; a decision made on the page is left alone.
    else if (post.slack.decided) Object.assign(post, { decision: "pending", note: "", decided_by: null, slack: { channel, ts } });
  }
  return pack;
}
