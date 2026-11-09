#!/usr/bin/env node
import { loadCliEnv } from "../src/env.js";
import { runCli } from "../src/cli.js";

// .env from the working directory (and a project command's directory) fills
// in variables that are not already set; it never overrides the shell.
const argv = process.argv.slice(2);
try { loadCliEnv(argv); } catch (error) { console.error(`warning: could not read .env: ${error.message}`); }

runCli(argv).catch((error) => {
  console.error(error.message);
  if (error.costs) console.error(`Cost tally:\n${JSON.stringify(error.costs, null, 2)}`);
  // launchclip make exits 2 for a rendered video that failed a gate (needs-repair); every other failure is 1.
  process.exitCode = error.exitCode ?? 1;
});
