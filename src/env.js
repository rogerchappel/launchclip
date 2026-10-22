// .env loading for the launchclip CLI.
//
// At startup the CLI reads `.env` from the current working directory and,
// for commands that take a project or workspace directory, from that
// directory and then each parent up to the repository root (the first
// directory holding `.git`, a directory or a worktree's file), at most
// MAX_ENV_WALK levels above the project, or the filesystem root. Variables already set (in the shell, or by an earlier file)
// always win: a .env file never overrides them. Values are never printed.
//
// Node 20.12+/22 ships process.loadEnvFile, which already keeps existing
// variables, and util.parseEnv. Both are used when present; otherwise a small
// parser handles KEY=value, export KEY=value, quotes and # comments.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import util from "node:util";

/**
 * Load one directory's .env into env without overriding variables already set.
 * Returns the names (never the values) of the variables it set, or null when
 * there is no .env file.
 */
export function loadDotEnv(directory, { env = process.env, file = ".env" } = {}) {
  const target = path.resolve(directory, file);
  if (!isFile(target)) return null;
  const before = new Set(Object.keys(env));
  if (env === process.env && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(target);
      return Object.keys(process.env).filter((key) => !before.has(key));
    } catch {
      // Fall through to the portable parser (for example a malformed line).
    }
  }
  const parsed = parseDotEnv(readFileSync(target, "utf8"));
  const set = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (Object.hasOwn(env, key) && env[key] !== undefined) continue;
    env[key] = value;
    set.push(key);
  }
  return set;
}

/** Parse .env text into {KEY: value}. Prefers util.parseEnv when available. */
export function parseDotEnv(text, { native = true } = {}) {
  if (native && typeof util.parseEnv === "function") {
    try { return { ...util.parseEnv(String(text)) }; } catch { /* fall back */ }
  }
  const result = {};
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key] = match;
    let value = match[2];
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      // A quoted value may span lines until its closing quote.
      let body = value.slice(1);
      while (!body.includes(quote) && index + 1 < lines.length) body += `\n${lines[++index]}`;
      const end = body.indexOf(quote);
      value = end >= 0 ? body.slice(0, end) : body;
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    result[key] = value;
  }
  return result;
}

// Commands whose first argument is a project or workspace directory.
const PROJECT_COMMANDS = new Set(["finish", "voice", "layout-check", "cinematic-check", "init", "demo", "plan", "captions", "render", "analyze-render", "submit-review", "review", "validate", "run", "script", "align", "motion-render", "music", "direct", "produce"]);

// How many parent directories above a project the .env walk visits.
export const MAX_ENV_WALK = 6;

/**
 * The directories whose .env a project command reads, nearest first: the
 * project directory, then its parents until one holds `.git` (inclusive),
 * the filesystem root, or MAX_ENV_WALK levels up.
 */
export function envSearchDirectories(projectDir, { maxLevels = MAX_ENV_WALK } = {}) {
  const directories = [];
  let current = path.resolve(projectDir);
  for (let level = 0; level <= maxLevels; level += 1) {
    directories.push(current);
    if (existsSync(path.join(current, ".git"))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

/**
 * Load .env for one CLI invocation: the working directory first, then the
 * project directory of a project command and its parents up to the repo root
 * (see envSearchDirectories). Earlier files win; none overrides a variable
 * that is already set. Returns the files that were read.
 */
export function loadCliEnv(argv = [], { cwd = process.cwd(), env = process.env } = {}) {
  const loaded = [];
  const directories = [path.resolve(cwd)];
  const [command, firstArg] = argv;
  if (command && firstArg && !String(firstArg).startsWith("-") && PROJECT_COMMANDS.has(command)) {
    const candidate = path.resolve(cwd, String(firstArg));
    const directory = isDirectory(candidate) ? candidate : path.dirname(candidate);
    for (const entry of envSearchDirectories(directory)) {
      if (!directories.includes(entry)) directories.push(entry);
    }
  }
  for (const directory of directories) {
    if (loadDotEnv(directory, { env }) !== null) loaded.push(path.join(directory, ".env"));
  }
  return loaded;
}

function isFile(file) {
  try { return existsSync(file) && statSync(file).isFile(); } catch { return false; }
}

function isDirectory(file) {
  try { return existsSync(file) && statSync(file).isDirectory(); } catch { return false; }
}
