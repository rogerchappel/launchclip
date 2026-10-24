// Demo autopilot: point it at a SaaS repo and it starts the app, prepares a
// clean demo state, plans 2–4 flows, records them, and writes contact sheets
// for review. Used by `launchclip demo record` and `launchclip make --repo`.
//
//   1. detect how the app runs (src/demo/app.js), or take --start / --url
//   2. ask before running anything with side effects (the seed script and the
//      start command), unless --approve
//   3. seed (npm run seed, prisma db seed…) and start the app, wait until healthy
//   4. plan: --plan DEMO-PLAN.json, else the model client, else the heuristic
//      tour; the plan is written next to the clips so the user can edit it
//   5. record each flow (src/demo/record.js), then stop the app
//   6. contact sheets and REVIEW.md: every flow stays "pending" until the user
//      approves it (`launchclip demo approve`), and only approved flows are
//      used in a video
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { detectApp, findTestAccounts, runCommand, startApp } from "./app.js";
import { assertSafeUrl, redactSecrets } from "./guardrails.js";
import { DEFAULT_VIEWPORT, planDemo, rebasePlanPaths, uploadFileProblems, validateDemoPlan } from "./plan.js";
import { recordPlan } from "./record.js";

export const DEMO_RECEIPT_SCHEMA = "launchclip.demo-record.v1";
export const RECEIPT_FILE = "demo-record.json";

const list = (value) => (value === undefined || value === true ? [] : String(value).split(",").map((item) => item.trim()).filter(Boolean));

/** Ask a yes/no question on a TTY. → boolean (false when stdin is not a TTY). */
export async function askYesNo(question, { input = process.stdin, output = process.stderr } = {}) {
  if (!input.isTTY) return false;
  const rl = createInterface({ input, output });
  try { return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim()); } finally { rl.close(); }
}

/**
 * Ask before anything runs code from the repo: the seed and start commands,
 * and the plan's fixtures module (code the recorder imports). `items` is
 * [[kind, what]]; --approve (`approve`) skips the question. Throws when the
 * person says no. `tool` names the command in the messages.
 */
export async function askConsent(items, { repo, url, approve = false, ask = askYesNo, log = () => {}, tool = "demo autopilot" } = {}) {
  if (!items.length || approve) return;
  log(`${tool} will run these in ${repo}:\n${items.map(([kind, what]) => `  ${kind.padEnd(5)} ${redactSecrets(what)}`).join("\n")}\nand ${tool === "demo autopilot" ? "record" : "check"} ${url}`);
  if (!(await ask("Run them?"))) {
    throw new Error(`not approved: ${tool} runs ${items.map(([, what]) => `\`${redactSecrets(what)}\``).join(" and ")} in the repo, which can have side effects. Re-run with --approve once you are happy with them, or pass --no-seed, or --no-start with --url for an app that is already running`);
  }
}

/** The fixtures module a plan imports, as a consent item, or null. */
export function fixturesConsent(plan, planDir) {
  return plan?.app?.fixtures ? ["code", `${path.resolve(planDir, plan.app.fixtures)} (the plan's fixtures module)`] : null;
}

/**
 * The commands autopilot would run and the URL it would record, without
 * running anything. → {repo, start, url, seed, accounts: [{email, source}], plan, notes}
 */
export async function autopilotPreview(repoPath, flags = {}) {
  const repo = path.resolve(repoPath);
  const app = await detectApp(repo);
  const start = flags["no-start"] ? null : (typeof flags.start === "string" ? flags.start : app.recommended?.command ?? null);
  const url = typeof flags.url === "string" ? flags.url : app.recommended?.url ?? null;
  const seed = flags["no-seed"] ? null : (typeof flags.seed === "string" ? flags.seed : app.seed[0]?.command ?? null);
  const accounts = await findTestAccounts(repo);
  return { repo, start, url, seed, app, accounts: accounts.map(({ email, source }) => ({ email, source })), notes: app.notes };
}

/** Frames at each action of a recorded flow, tiled into one PNG with ffmpeg. → path | null */
export async function contactSheet(flow, out, { columns = 4, width = 480 } = {}) {
  const times = [0.05, ...flow.record.actions.filter((action) => action.type !== "pause").map((action) => action.end ?? action.start), flow.duration - 0.1]
    .map((t) => Math.max(0, Math.min(flow.duration - 0.05, t)));
  const picks = [...new Set(times.map((t) => Math.round(t * 10) / 10))].slice(0, 12);
  const ffmpeg = (args) => new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "ignore" });
    child.on("error", () => resolve(-1));
    child.on("close", resolve);
  });
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-sheet-"));
  try {
    let count = 0;
    for (const t of picks) {
      if (await ffmpeg(["-ss", String(t), "-i", flow.video, "-frames:v", "1", "-vf", `scale=${width}:-2`, path.join(dir, `s${String(count).padStart(2, "0")}.png`)]) === 0) count += 1;
    }
    if (!count) return null;
    const cols = Math.min(columns, count), rows = Math.ceil(count / cols);
    const code = await ffmpeg(["-framerate", "1", "-i", path.join(dir, "s%02d.png"), "-vf", `tile=${cols}x${rows}:padding=8:margin=8:color=0x111111`, "-frames:v", "1", out]);
    return code === 0 ? out : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function reviewMarkdown(receipt) {
  const lines = [
    "# Recorded demo flows: review before use",
    "",
    `Recorded from ${receipt.app.url} on ${receipt.recorded_at}. Nothing is used in a video until you approve it:`,
    "",
    "```bash",
    `launchclip demo approve ${receipt.out} [--flows ${receipt.flows.map((flow) => flow.id).join(",")}]`,
    "```",
    ""
  ];
  for (const flow of receipt.flows) {
    lines.push(`## ${flow.title} (\`${flow.id}\`), ${flow.duration.toFixed(1)} s, ${flow.review}`, "");
    if (flow.sheet) lines.push(`![${flow.id}](${flow.sheet})`, "");
    lines.push(`- Clip: \`${flow.video}\``, `- Action log: \`${flow.log}\``, `- Actions: ${flow.actions.join(" → ")}`, "");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Run demo autopilot end to end. Options:
 *   out (dir for clips, logs, sheets, plan and receipt), plan (DEMO-PLAN.json path),
 *   start, url, seed, no-seed, no-start, approve (consent to run the commands),
 *   allow-host, headed, flows (only these ids), plan-only, prompt, client (model)
 * → the receipt object (also written to <out>/demo-record.json).
 */
export async function runAutopilot(repoPath, flags = {}, { log = () => {}, ask = askYesNo, client = null } = {}) {
  const out = path.resolve(flags.out ?? path.join(".launchclip", "demo"));
  await mkdir(out, { recursive: true });
  const preview = await autopilotPreview(repoPath, flags);
  const { repo, start, url, seed } = preview;
  if (!url) throw new Error(`could not tell which URL the app serves; pass --url http://localhost:<port>${preview.notes.length ? ` (${preview.notes.join("; ")})` : ""}`);
  const allowHosts = list(flags["allow-host"]);
  assertSafeUrl(url, { allowHosts });

  // Plan first when it is given: a bad plan should fail before anything runs.
  let planSource = "file", plan = null, planWarnings = [], fixtures = null, planDir = out;
  if (typeof flags.plan === "string") {
    plan = JSON.parse(await readFile(path.resolve(flags.plan), "utf8"));
    const check = validateDemoPlan(plan);
    if (check.errors.length) throw new Error(`${flags.plan} has errors:\n- ${check.errors.join("\n- ")}`);
    planWarnings = check.warnings;
    planDir = path.dirname(path.resolve(flags.plan));
    const missing = await uploadFileProblems(plan, planDir);
    if (missing.length) throw new Error(`${flags.plan} has errors:\n- ${missing.join("\n- ")}`);
    fixtures = fixturesConsent(plan, planDir);
    // The copy saved in `out` points at the same fixtures and HAR as the original.
    plan = rebasePlanPaths(plan, planDir, out);
  }

  // --plan-only plans from the code alone: nothing runs.
  const planOnly = Boolean(flags["plan-only"]);
  const sideEffects = planOnly ? [] : [seed && ["seed", seed], start && ["start", start], fixtures].filter(Boolean);
  await askConsent(sideEffects, { repo, url, approve: Boolean(flags.approve), ask, log });

  const accounts = await findTestAccounts(repo);
  const account = accounts[0] ? { email: accounts[0].email, password: accounts[0].password, username: accounts[0].email.split("@")[0] } : null;
  const commands = [];
  if (seed && !planOnly) {
    log(`seeding: ${redactSecrets(seed)}`);
    const result = await runCommand(seed, { cwd: repo });
    commands.push({ kind: "seed", command: result.command, exit_code: result.code });
    if (result.code !== 0) throw new Error(`seed command failed (exit ${result.code}):\n${result.output.slice(-2000)}`);
  }
  let app = null;
  try {
    if (start && !planOnly) {
      app = await startApp({ command: start, cwd: repo, url, allowHosts, timeout: Number(flags.timeout ?? 90000), log });
      commands.push({ kind: "start", command: redactSecrets(start), pid: app.pid });
    }
    if (!plan) {
      const planned = await planDemo({ prompt: flags.prompt ?? "", repo, url, client, accounts, log });
      plan = planned.plan;
      planSource = planned.source;
      planWarnings = planned.warnings;
    }
    if (flags.viewport === "4k") plan.viewport = { ...DEFAULT_VIEWPORT, ...(plan.viewport ?? {}), deviceScaleFactor: 2 };
    const planPath = path.join(out, "DEMO-PLAN.json");
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    for (const warning of planWarnings) log(`plan: ${warning}`);
    if (planOnly) return { schema: DEMO_RECEIPT_SCHEMA, out, plan: planPath, plan_source: planSource, flows: [], recorded: false };

    const recorded = await recordPlan(plan, { out, url, repo, planDir: out, uploadRoot: planDir, headed: Boolean(flags.headed), account, allowHosts, only: list(flags.flows).length ? list(flags.flows) : null, log });
    const flows = [];
    for (const flow of recorded.flows) {
      const sheet = await contactSheet(flow, path.join(out, `${flow.id}.sheet.png`));
      flows.push({
        id: flow.id, title: flow.record.flow.title, duration: flow.duration, review: "pending",
        video: path.basename(flow.video), log: path.basename(flow.log), poster: path.basename(flow.poster), sheet: sheet ? path.basename(sheet) : null,
        actions: flow.record.actions.filter((action) => action.type !== "pause").map((action) => `${action.type}${action.label ? ` "${action.label}"` : action.path ? ` ${action.path}` : ""}`)
      });
    }
    const receipt = {
      schema: DEMO_RECEIPT_SCHEMA,
      out,
      recorded_at: new Date().toISOString(),
      app: { repo, url, start: start ? redactSecrets(start) : null, seed: seed ? redactSecrets(seed) : null },
      browser: recorded.executablePath,
      account: account ? { email: account.email, source: accounts[0].source } : null,
      plan: "DEMO-PLAN.json",
      plan_source: planSource,
      commands,
      flows
    };
    await writeFile(path.join(out, RECEIPT_FILE), `${JSON.stringify(receipt, null, 2)}\n`);
    await writeFile(path.join(out, "REVIEW.md"), reviewMarkdown(receipt));
    return receipt;
  } finally {
    if (app) {
      await app.stop();
      log("stopped the app");
    }
  }
}

/** Mark recorded flows approved (all, or `flows`). → the updated receipt. */
export async function approveFlows(outDir, { flows = null, reject = false } = {}) {
  const file = path.join(path.resolve(outDir), RECEIPT_FILE);
  if (!existsSync(file)) throw new Error(`no ${RECEIPT_FILE} in ${outDir}; run launchclip demo record first`);
  const receipt = JSON.parse(await readFile(file, "utf8"));
  const ids = flows?.length ? flows : receipt.flows.map((flow) => flow.id);
  for (const id of ids) {
    const flow = receipt.flows.find((entry) => entry.id === id);
    if (!flow) throw new Error(`no flow "${id}" (recorded: ${receipt.flows.map((entry) => entry.id).join(", ")})`);
    flow.review = reject ? "rejected" : "approved";
    flow.reviewed_at = new Date().toISOString();
  }
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(path.join(path.resolve(outDir), "REVIEW.md"), reviewMarkdown(receipt));
  return receipt;
}

/** Approved flows of a recording dir with their action logs: [{id, title, video, record}]. */
export async function approvedFlows(outDir) {
  const dir = path.resolve(outDir);
  const receipt = JSON.parse(await readFile(path.join(dir, RECEIPT_FILE), "utf8"));
  const out = [];
  for (const flow of receipt.flows.filter((entry) => entry.review === "approved")) {
    out.push({ id: flow.id, title: flow.title, video: path.join(dir, flow.video), record: JSON.parse(await readFile(path.join(dir, flow.log), "utf8")) });
  }
  return out;
}
