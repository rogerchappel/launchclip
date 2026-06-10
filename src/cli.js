import { initWorkspace, runDemo, planVideo, writeCaptions, renderDryRun, submitReview, writeReview } from "./pipeline.js";

const COMMANDS = new Set(["init", "demo", "plan", "captions", "render", "submit-review", "review"]);

export async function runCli(argv, io = {}) {
  const { stdout = process.stdout } = io;
  const [command, firstArg, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    stdout.write(help());
    return;
  }
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}\n\n${help()}`);
  }

  const flags = parseFlags(rest);
  let result;
  if (command === "init") {
    result = await initWorkspace(required(firstArg, "repo path"), flags);
  } else if (command === "demo") {
    result = await runDemo(required(firstArg, "repo path"), flags);
  } else if (command === "plan") {
    result = await planVideo(required(firstArg, "workspace path"), flags);
  } else if (command === "captions") {
    result = await writeCaptions(required(firstArg, "workspace path"), flags);
  } else if (command === "render") {
    result = await renderDryRun(required(firstArg, "workspace path"), flags);
  } else if (command === "submit-review") {
    result = await submitReview(required(firstArg, "workspace path"), flags);
  } else if (command === "review") {
    result = await writeReview(required(firstArg, "workspace path"), flags);
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "dry-run" || name === "submit") {
      flags[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    flags[name] = value;
    index += 1;
  }
  return flags;
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function help() {
  return `launchclip creates dry-run-first OSS promotion packets.

Usage:
  launchclip init <repo> --out <workspace>
  launchclip demo <repo> --out <workspace> --demo-cmd "npm run smoke" --capture terminal
  launchclip plan <workspace> --format short-30 --renderer none
  launchclip captions <workspace> --platforms x,linkedin,tiktok,bluesky
  launchclip render <workspace> --provider product-videogen --dry-run
  launchclip submit-review <workspace> --provider product-videogen --dry-run
  launchclip review <workspace>
`;
}
