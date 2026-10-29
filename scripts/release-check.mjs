#!/usr/bin/env node
// Pack, scan and publish LaunchClip's npm packages (.github/workflows/release.yml).
//
//   node scripts/release-check.mjs pack [core remotion engine launchclip]
//   node scripts/release-check.mjs publish [core remotion engine launchclip]
//
// pack builds each tarball into release/ and refuses it when it holds
// anything that must not ship: a credential-shaped string, a key or .env
// file, an install script, a reference to a dependency version the other
// packages don't match, or one of RELEASE_FORBIDDEN_TERMS (comma separated,
// set as a repository variable so the terms themselves stay out of the repo).
// publish publishes the packed tarballs in dependency order with provenance,
// skipping any version already on npm.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "release");
// Dependency order: each package only depends on the ones before it.
const PACKAGES = [
  ["core", "kit/core"],
  ["remotion", "kit/remotion"],
  ["engine", "packages/engine"],
  ["launchclip", "."]
];
const SECRET_PATTERNS = [
  /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /npm_[A-Za-z0-9]{30,}/,
  /tvly-[A-Za-z0-9]{20,}/,
  /xox[abpr]-[A-Za-z0-9-]{20,}/
];
const FORBIDDEN_FILES = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|\.npmrc)$/;
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
}

function selected(names) {
  const wanted = names.length ? names : PACKAGES.map(([name]) => name);
  for (const name of wanted) if (!PACKAGES.some(([id]) => id === name)) throw new Error(`unknown package "${name}" (use ${PACKAGES.map(([id]) => id).join(", ")})`);
  return PACKAGES.filter(([name]) => wanted.includes(name));
}

function manifest(dir) {
  return JSON.parse(readFileSync(path.join(ROOT, dir, "package.json"), "utf8"));
}

function tarballName(pkg) {
  return `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

export function scanPackage(dir, { forbiddenTerms = [] } = {}) {
  const problems = [];
  for (const file of walk(dir)) {
    const rel = path.relative(dir, file);
    if (FORBIDDEN_FILES.test(rel)) problems.push(`${rel}: a key, .env or .npmrc file`);
    if (statSync(file).size > 5_000_000) continue;
    const text = readFileSync(file, "latin1");
    for (const pattern of SECRET_PATTERNS) if (pattern.test(text)) problems.push(`${rel}: looks like a credential (${pattern.source.slice(0, 24)}…)`);
    for (const term of forbiddenTerms) if (text.toLowerCase().includes(term)) problems.push(`${rel}: names a forbidden term`);
  }
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  for (const script of INSTALL_SCRIPTS) if (pkg.scripts?.[script]) problems.push(`package.json: has a ${script} script`);
  return problems;
}

function pack(names) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const forbiddenTerms = String(process.env.RELEASE_FORBIDDEN_TERMS ?? "").split(",").map((term) => term.trim().toLowerCase()).filter(Boolean);
  const versions = Object.fromEntries(PACKAGES.map(([, dir]) => [manifest(dir).name, manifest(dir).version]));
  let failed = false;
  for (const [name, dir] of selected(names)) {
    const pkg = manifest(dir);
    // The packages pin each other exactly; a mismatch would publish a package that installs the wrong sibling.
    for (const [dep, range] of Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      if (dep in versions && range !== versions[dep]) {
        console.error(`✖ ${pkg.name}: depends on ${dep}@${range}, but the repo has ${versions[dep]}`);
        failed = true;
      }
    }
    run("npm", ["pack", "--pack-destination", OUT], { cwd: path.join(ROOT, dir) });
    const tarball = path.join(OUT, tarballName(pkg));
    const unpacked = mkdtempSync(path.join(os.tmpdir(), `launchclip-${name}-`));
    run("tar", ["-xzf", tarball, "-C", unpacked]);
    const problems = scanPackage(path.join(unpacked, "package"), { forbiddenTerms });
    rmSync(unpacked, { recursive: true, force: true });
    if (problems.length) {
      failed = true;
      console.error(`✖ ${pkg.name}@${pkg.version}:\n  ${problems.slice(0, 20).join("\n  ")}`);
    } else {
      console.log(`✔ ${pkg.name}@${pkg.version} (${(statSync(tarball).size / 1e6).toFixed(2)} MB) packed and clean`);
    }
  }
  if (failed) process.exit(1);
}

function published(name, version) {
  try {
    return run("npm", ["view", `${name}@${version}`, "version"]).trim() === version;
  } catch {
    return false;
  }
}

function publish(names) {
  for (const [, dir] of selected(names)) {
    const pkg = manifest(dir);
    if (published(pkg.name, pkg.version)) {
      console.log(`- ${pkg.name}@${pkg.version} is already on npm; skipped`);
      continue;
    }
    run("npm", ["publish", path.join(OUT, tarballName(pkg)), "--provenance", "--access", "public"], { stdio: "inherit" });
    console.log(`✔ published ${pkg.name}@${pkg.version}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...names] = process.argv.slice(2);
  if (command === "pack") pack(names);
  else if (command === "publish") publish(names);
  else {
    console.error("usage: node scripts/release-check.mjs pack|publish [core remotion engine launchclip]");
    process.exit(2);
  }
}
