import { access, lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PACKAGE_ROOT } from "./runtime_paths.js";

export const BUNDLED_SKILLS = [
  {
    name: "launchclip-create-video",
    description: "Create a cinematic LaunchClip video with the active subscription agent."
  },
  {
    name: "launchclip-cli",
    description: "Operate LaunchClip CLI production and promotion-packet workflows."
  }
];

export const SKILL_AGENTS = {
  codex: {
    relativeRoot: path.join(".agents", "skills"),
    invocation: "$launchclip-create-video"
  },
  claude: {
    relativeRoot: path.join(".claude", "skills"),
    invocation: "/launchclip-create-video"
  }
};

export function listBundledSkills(options = {}) {
  const packageRoot = path.resolve(options.packageRoot ?? PACKAGE_ROOT);
  return {
    stage: "skills",
    action: "list",
    status: "ready",
    root: path.join(packageRoot, "skills"),
    skills: BUNDLED_SKILLS.map((skill) => ({
      ...skill,
      path: path.join(packageRoot, "skills", skill.name)
    })),
    agents: Object.entries(SKILL_AGENTS).map(([name, agent]) => ({
      name,
      personal_root: path.join(options.home ?? os.homedir(), agent.relativeRoot),
      invocation: agent.invocation
    }))
  };
}

export function bundledSkillPath(name, options = {}) {
  const root = path.join(path.resolve(options.packageRoot ?? PACKAGE_ROOT), "skills");
  if (!name) return root;
  assertSkillName(name);
  return path.join(root, name);
}

export async function installBundledSkills(options = {}) {
  const agentName = options.agent;
  const agent = SKILL_AGENTS[agentName];
  if (!agent) throw new Error(`Unsupported agent: ${agentName ?? "missing"}. Use codex or claude.`);

  const packageRoot = path.resolve(options.packageRoot ?? PACKAGE_ROOT);
  const home = path.resolve(options.home ?? os.homedir());
  const destinationRoot = path.join(home, agent.relativeRoot);
  const selectedSkills = selectSkills(options.skill);
  const planned = [];

  for (const skill of selectedSkills) {
    const source = path.join(packageRoot, "skills", skill.name);
    const destination = path.join(destinationRoot, skill.name);
    await access(path.join(source, "SKILL.md"));
    planned.push({
      name: skill.name,
      source,
      destination,
      ...await destinationState(source, destination, skill.name)
    });
  }

  const conflict = planned.find((entry) => entry.state === "conflict");
  if (conflict) {
    throw new Error(`Skill destination already exists and is not managed by LaunchClip: ${conflict.destination}`);
  }
  const stale = planned.find((entry) => entry.state === "stale-managed");
  if (stale && !options.force) {
    throw new Error(`Skill destination points at an older LaunchClip package: ${stale.destination}. Re-run with --force to refresh managed symlinks.`);
  }

  await mkdir(destinationRoot, { recursive: true });
  for (const entry of planned) {
    if (entry.state === "missing") {
      await symlink(entry.source, entry.destination, process.platform === "win32" ? "junction" : "dir");
      entry.state = "installed";
    } else if (entry.state === "stale-managed" && options.force) {
      await replaceManagedSymlink(entry);
      entry.state = "updated";
    }
  }

  return {
    stage: "skills",
    action: "install",
    status: "ready",
    agent: agentName,
    root: destinationRoot,
    invocation: agent.invocation,
    skills: planned.map(({ name, source, destination, state }) => ({
      name,
      source,
      destination,
      status: state
    }))
  };
}

function selectSkills(selection) {
  if (!selection || selection === "all") return BUNDLED_SKILLS;
  const names = Array.isArray(selection) ? selection : [selection];
  for (const name of names) assertSkillName(name);
  return BUNDLED_SKILLS.filter((skill) => names.includes(skill.name));
}

function assertSkillName(name) {
  if (!BUNDLED_SKILLS.some((skill) => skill.name === name)) {
    throw new Error(`Unknown bundled skill: ${name}. Use launchclip-create-video, launchclip-cli, or all.`);
  }
}

async function destinationState(source, destination, skillName) {
  let stat;
  try {
    stat = await lstat(destination);
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "missing" };
    throw error;
  }
  if (!stat.isSymbolicLink()) return { state: "conflict" };
  const target = await readlink(destination);
  const resolvedTarget = path.resolve(path.dirname(destination), target);
  if (resolvedTarget === path.resolve(source)) return { state: "already-installed", previousTarget: target };
  const managed = path.basename(resolvedTarget) === skillName && path.basename(path.dirname(resolvedTarget)) === "skills";
  return managed
    ? { state: "stale-managed", previousTarget: target }
    : { state: "conflict", previousTarget: target };
}

async function replaceManagedSymlink(entry) {
  const type = process.platform === "win32" ? "junction" : "dir";
  await unlink(entry.destination);
  try {
    await symlink(entry.source, entry.destination, type);
  } catch (error) {
    await symlink(entry.previousTarget, entry.destination, type);
    throw error;
  }
}
