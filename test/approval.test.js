import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { runApprovalCommand } from "../src/approval/cli.js";
import { applyDecisions, buildPack, loadPack, tally } from "../src/approval/pack.js";
import { postPack, pullPack, slackClient } from "../src/approval/slack.js";

const sample = () => JSON.parse(readFileSync(new URL("../examples/carousel/listicle-4x5/storyboard.json", import.meta.url), "utf8"));
const tmp = (name) => mkdtempSync(path.join(os.tmpdir(), `approval-${name}-`));

// A carousel project with fake Instagram renders.
async function carousel(captions) {
  const dir = path.join(tmp("project"), "listicle");
  const story = sample();
  mkdirSync(path.join(dir, "carousel", "instagram"), { recursive: true });
  writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(story));
  if (captions) writeFileSync(path.join(dir, "captions.json"), JSON.stringify(captions));
  const png = await sharp({ create: { width: 108, height: 135, channels: 3, background: "#e2412b" } }).png().toBuffer();
  story.scenes.forEach((_, i) => writeFileSync(path.join(dir, "carousel", "instagram", `${String(i + 1).padStart(2, "0")}.png`), png));
  return { dir, slides: story.scenes.length };
}

// A fake Slack: records calls and answers from `replies`.
function fakeSlack(replies = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = String(url).startsWith("https://slack.com/api/") ? String(url).slice(22).split("?")[0] : "upload";
    calls.push({ method, url: String(url), init });
    const body = method === "upload" ? {} : { ok: true, ...(typeof replies[method] === "function" ? replies[method](calls) : replies[method]) };
    return { ok: true, status: 200, headers: new Map(), json: async () => body };
  };
  return { calls, fetch, sleep: async () => {} };
}

test("build gathers a carousel with its files, a caption per platform and a page", async () => {
  const { dir, slides } = await carousel({ instagram: "Written for Instagram" });
  const out = tmp("pack");
  const { pack } = await buildPack([dir], { out, dest: "instagram", title: "This week", day: "2026-11-25" });
  const [post] = pack.posts;
  assert.equal(post.kind, "carousel");
  assert.equal(post.destinations.instagram.files.length, slides);
  assert.equal(post.destinations.instagram.caption, "Written for Instagram");
  assert.ok(existsSync(path.join(out, post.folder, post.destinations.instagram.files[0])));
  assert.equal(post.decision, "pending");
  assert.match(readFileSync(path.join(out, "index.html"), "utf8"), /This week/);
});

test("a rebuilt post keeps its decision until its caption changes", async () => {
  const { dir } = await carousel({ instagram: "One" });
  const out = tmp("pack");
  await runApprovalCommand("build", [dir], { out, dest: "instagram" });
  const decisions = path.join(out, "decisions.json");
  writeFileSync(decisions, JSON.stringify([{ id: "listicle", decision: "approved", note: "good" }]));
  await runApprovalCommand("pull", [out], { from: decisions });
  assert.equal((await buildPack([dir], { out, dest: "instagram" })).pack.posts[0].decision, "approved");
  writeFileSync(path.join(dir, "captions.json"), JSON.stringify({ instagram: "Two" }));
  const again = (await buildPack([dir], { out, dest: "instagram" })).pack;
  assert.equal(again.posts[0].decision, "pending");
  assert.equal(again.posts.length, 1);
});

test("decisions for an unknown post or an unknown word are refused", () => {
  const pack = { posts: [{ id: "a", decision: "pending" }] };
  assert.throws(() => applyDecisions(pack, [{ id: "b", decision: "approved" }]), /no post "b"/);
  assert.throws(() => applyDecisions(pack, [{ id: "a", decision: "maybe" }]), /decision must be/);
});

test("post sends the message, the slides in its thread and the caption, once", async () => {
  const { dir, slides } = await carousel({ instagram: "Caption text" });
  const out = tmp("pack");
  const { pack } = await buildPack([dir], { out, dest: "instagram" });
  const slack = fakeSlack({ "chat.postMessage": { channel: "C1", ts: "111.222" }, "files.getUploadURLExternal": (calls) => ({ upload_url: "https://files.example/up", file_id: `F${calls.length}` }) });
  const call = slackClient({ token: "xoxb-test", ...slack });
  assert.deepEqual(await postPack(out, pack, { call, channel: "C1", ...slack }), ["listicle"]);
  const methods = slack.calls.map((entry) => entry.method);
  assert.equal(methods[0], "chat.postMessage");
  assert.equal(methods.filter((name) => name === "upload").length, Math.min(slides, 10));
  const complete = JSON.parse(slack.calls.find((entry) => entry.method === "files.completeUploadExternal").init.body);
  assert.equal(complete.thread_ts, "111.222");
  assert.equal(complete.files.length, Math.min(slides, 10));
  assert.match(JSON.parse(slack.calls.at(-1).init.body).text, /Caption text/);
  assert.deepEqual(pack.posts[0].slack, { channel: "C1", ts: "111.222" });
  assert.deepEqual(await postPack(out, pack, { call, channel: "C1", ...slack }), []);
});

test("pull reads a tick, a cross and a reply, and ignores the bot", async () => {
  const post = (id, ts) => ({ id, decision: "pending", note: "", decided_by: null, slack: { channel: "C1", ts } });
  const pack = { posts: [post("a", "1"), post("b", "2"), post("c", "3"), post("d", "4")] };
  const at = (calls) => new URL(calls.at(-1).url).searchParams.get("timestamp") ?? new URL(calls.at(-1).url).searchParams.get("ts");
  const slack = fakeSlack({
    "auth.test": { user_id: "UBOT" },
    "reactions.get": (calls) => ({ message: { reactions: { 1: [{ name: "white_check_mark", users: ["U1"] }], 2: [{ name: "x", users: ["U2"] }], 4: [{ name: "white_check_mark", users: ["UBOT"] }] }[at(calls)] ?? [] } }),
    "conversations.replies": (calls) => ({ messages: [{ ts: at(calls), user: "UBOT", text: "parent" }, ...(at(calls) === "3" ? [{ ts: "3.1", user: "U3", text: "Shorten slide 2" }, { ts: "3.2", bot_id: "B1", user: "UBOT", text: "caption" }] : [])] })
  });
  await pullPack(pack, { call: slackClient({ token: "xoxb-test", ...slack }) });
  assert.deepEqual(pack.posts.map((entry) => entry.decision), ["approved", "dropped", "changes", "pending"]);
  assert.equal(pack.posts[2].note, "Shorten slide 2");
  assert.deepEqual(pack.posts[0].decided_by, ["U1"]);
  assert.deepEqual(tally(pack), { pending: 1, approved: 1, changes: 1, dropped: 1 });
});

test("only the named approvers count, and a Slack error never shows the token", async () => {
  const pack = { posts: [{ id: "a", decision: "pending", slack: { channel: "C1", ts: "1" } }] };
  const slack = fakeSlack({ "auth.test": { user_id: "UBOT" }, "reactions.get": { message: { reactions: [{ name: "+1", users: ["U9"] }] } }, "conversations.replies": { messages: [] } });
  await pullPack(pack, { call: slackClient({ token: "xoxb-test", ...slack }), approvers: ["U1"] });
  assert.equal(pack.posts[0].decision, "pending");
  const failing = slackClient({ token: "xoxb-secret", fetch: async () => ({ status: 200, headers: new Map(), json: async () => ({ ok: false, error: "not_in_channel" }) }) });
  await assert.rejects(failing("chat.postMessage", {}), (error) => /not_in_channel/.test(error.message) && !error.message.includes("xoxb-secret"));
  assert.throws(() => slackClient({ token: "" }), /SLACK_BOT_TOKEN/);
});

test("a pack file of another kind is refused, not replaced", async () => {
  const out = tmp("pack");
  writeFileSync(path.join(out, "APPROVAL.json"), JSON.stringify({ schema: "other" }));
  await assert.rejects(loadPack(out), /not a launchclip.approval.v1 pack/);
});
