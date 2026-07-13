#!/usr/bin/env node
import { runCli } from "../src/cli.js";

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  if (error.costs) console.error(`Cost tally:\n${JSON.stringify(error.costs, null, 2)}`);
  process.exitCode = 1;
});
