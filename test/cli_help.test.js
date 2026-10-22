// Every command answers --help / -h with its own usage, from one table
// (src/cli_usage.js) that also generates the CLI reference's usage section.
// Blind test 2: `finish --help` said "finish needs …/--help/storyboard.json"
// and `voice --help` said "Missing value for --help".
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { commandHelp, helpText, SUMMARIES, USAGE, USAGE_GROUPS, usageMarkdown, usageNames } from "../src/cli_usage.js";

const ROOT = path.resolve(import.meta.dirname, "..");

async function cli(argv) {
  const out = [];
  await runCli(argv, { stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} } });
  return out.join("");
}

test("every command and group action answers --help and -h with its own usage", async () => {
  for (const name of usageNames()) {
    if (name === "--version") continue;
    const argv = name.split(" ");
    for (const flag of ["--help", "-h"]) {
      const text = await cli([...argv, flag]);
      assert.match(text, /^Usage:\n/, `${name} ${flag}`);
      assert.ok(text.includes(`launchclip ${name}`), `${name} ${flag}: ${text}`);
      assert.ok(SUMMARIES[name], `${name} has a summary`);
      assert.ok(text.includes(SUMMARIES[name]), `${name} ${flag} prints its summary`);
    }
  }
});

test("--help wins over arguments, wherever it sits", async () => {
  assert.match(await cli(["finish", "--help"]), /launchclip finish <project>/);
  assert.match(await cli(["finish", "some/project", "--help"]), /launchclip finish <project>/);
  assert.match(await cli(["voice", "--help"]), /launchclip voice <project/);
  assert.match(await cli(["voice", "--text", "hello", "-h"]), /launchclip voice <project/);
  assert.match(await cli(["layout-check", "--help"]), /launchclip layout-check <project>/);
  assert.match(await cli(["cinematic-check", "--help"]), /launchclip cinematic-check <project>/);
  assert.match(await cli(["export", "--help"]), /launchclip export <project>/);
  assert.match(await cli(["music", "--help"]), /launchclip music <workspace>/);
});

test("a group answers with all its actions; an action with only its own", async () => {
  for (const group of USAGE_GROUPS) {
    const all = await cli([group, "--help"]);
    for (const [name] of USAGE.filter(([row]) => row.startsWith(`${group} `))) assert.ok(all.includes(`launchclip ${name}`), `${group} --help lists ${name}`);
    assert.match(all, new RegExp(`Run launchclip ${group} <action> --help`));
  }
  const one = await cli(["story", "validate", "--help"]);
  assert.ok(one.includes("launchclip story validate"));
  assert.ok(!one.includes("launchclip story compile"));
  assert.equal(commandHelp("sfx", "nope").includes("launchclip sfx seed"), true, "an unknown action falls back to the group");
});

test("the top-level help is generated from the same table and still lists every command", async () => {
  const text = await cli(["--help"]);
  assert.equal(text, helpText());
  for (const [, usage, options = {}] of USAGE) if (!options.continuation) assert.ok(text.includes(`launchclip ${usage}`), usage);
  assert.match(text, /Run launchclip <command> --help/);
});

test("every CLI command has usage, and the CLI reference carries the generated usage section", async () => {
  const cliSource = await readFile(path.join(ROOT, "src/cli.js"), "utf8");
  const commands = JSON.parse(`[${/const COMMANDS = new Set\(\[(.*?)\]\)/s.exec(cliSource)[1].replace(/\.\.\.PRODUCTION_COMMANDS,?/, "")}]`);
  const production = JSON.parse(`[${/const PRODUCTION_COMMANDS = new Set\(\[(.*?)\]\)/s.exec(cliSource)[1]}]`);
  const top = new Set(usageNames().map((name) => name.split(" ")[0]));
  for (const command of [...commands, ...production]) assert.ok(top.has(command), `${command} has a usage row`);
  const reference = await readFile(path.join(ROOT, "skills/launchclip-cli/references/cli-reference.md"), "utf8");
  assert.ok(reference.includes(usageMarkdown()), "cli-reference.md is in sync with src/cli_usage.js (npm run skills:sync)");
});
