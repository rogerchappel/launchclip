import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HYPERFRAMES_CLI = require.resolve("hyperframes/dist/cli.js");
const HYPERFRAMES_PACKAGE = require("hyperframes/package.json");

export function hyperframesInvocation(args = []) {
  return {
    command: process.execPath,
    args: [HYPERFRAMES_CLI, ...args],
    display: ["hyperframes", ...args]
  };
}

export function runHyperframes(run, args = [], options = {}) {
  const invocation = hyperframesInvocation(args);
  return run(invocation.command, invocation.args, options);
}

export function hyperframesToolInfo() {
  return {
    version: HYPERFRAMES_PACKAGE.version,
    cli: HYPERFRAMES_CLI
  };
}
