// launchclip approval build|post|pull|status (docs/APPROVAL_RFC.md §5).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyDecisions, buildPack, loadPack, savePack, tally } from "./pack.js";
import { postPack, pullPack, slackClient } from "./slack.js";

const ACTIONS = ["build", "post", "pull", "status"];

export async function runApprovalCommand(action, args, flags, io = {}) {
  if (!ACTIONS.includes(action)) throw new Error(`launchclip approval needs an action: launchclip approval build <project>… --out <dir> | post|pull|status <dir>${action ? ` (got ${action})` : ""}`);
  const env = io.env ?? process.env;
  let dir;
  let pack;
  let sent = null;
  if (action === "build") ({ dir, pack } = await buildPack(args, flags));
  else {
    if (!args[0]) throw new Error(`launchclip approval ${action} needs the pack folder`);
    dir = path.resolve(args[0]);
    pack = await loadPack(dir);
    if (!pack) throw new Error(`no APPROVAL.json in ${dir}; run launchclip approval build first`);
  }
  const slack = () => ({ call: slackClient({ token: env.SLACK_BOT_TOKEN, fetch: io.fetch, sleep: io.sleep }), fetch: io.fetch, sleep: io.sleep });
  if (action === "post") {
    if (!flags.slack) throw new Error("launchclip approval post needs --slack (the only sender so far)");
    sent = await postPack(dir, pack, { ...slack(), channel: typeof flags.channel === "string" ? flags.channel : env.SLACK_APPROVAL_CHANNEL, url: typeof flags.url === "string" ? flags.url : null, save: () => savePack(dir, pack) });
  }
  if (action === "pull") {
    if (!flags.slack && typeof flags.from !== "string") throw new Error("launchclip approval pull needs --slack or --from <decisions.json>");
    if (typeof flags.from === "string") applyDecisions(pack, JSON.parse(await readFile(path.resolve(flags.from), "utf8")));
    if (flags.slack) await pullPack(pack, { call: slack().call, approvers: typeof flags.approvers === "string" ? flags.approvers.split(",").map((id) => id.trim()).filter(Boolean) : null });
  }
  if (action !== "status") await savePack(dir, pack);
  const counts = tally(pack);
  const report = { dir, title: pack.title, tally: counts, ...(sent ? { sent } : {}), posts: pack.posts.map(({ id, n, title, kind, decision, note, decided_by }) => ({ id, n, title, kind, decision, note, decided_by })) };
  if (io.stdout) {
    io.stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : [
      `${pack.title}: ${Object.entries(counts).map(([decision, count]) => `${count} ${decision}`).join(", ")}`,
      ...(sent ? [`Sent to Slack: ${sent.length ? sent.join(", ") : "nothing new"}`] : []),
      ...report.posts.map((post) => `  ${String(post.n).padStart(2, "0")} ${post.decision.padEnd(8)} ${post.title}${post.note ? `\n       ${post.note.replace(/\n/g, "\n       ")}` : ""}`),
      `${path.join(dir, "index.html")}\n`
    ].join("\n"));
  }
  // A script can wait on pull: it exits 1 while any post is undecided.
  if (action === "pull" && counts.pending) process.exitCode = 1;
  return report;
}
