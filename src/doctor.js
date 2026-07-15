import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { PACKAGE_ROOT } from "./runtime_paths.js";
import { hyperframesToolInfo } from "./toolchain.js";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const PACKAGE = require("../package.json");
const REMOTION = require("remotion/package.json");
const MINIMUM_NODE_MAJOR = Number(PACKAGE.engines.node.match(/\d+/)?.[0] ?? 22);
const REQUIRED_PACKAGE_FILES = [
  ".codex-plugin/plugin.json",
  "examples/motion/golden-timeline.json",
  "motion-engine/schema.js",
  "public/icons/check.svg",
  "remotion/index.jsx",
  "skills/launchclip-cli/SKILL.md",
  "skills/launchclip-create-video/SKILL.md"
];

export const VERSION = PACKAGE.version;

export async function diagnoseInstallation(options = {}) {
  const env = options.env ?? process.env;
  const nodeVersion = options.nodeVersion ?? process.version;
  const commandAvailable = options.commandAvailable ?? hasCommand;
  const fileAvailable = options.fileAvailable ?? hasFile;
  const nodeMajor = Number(nodeVersion.match(/^v?(\d+)/)?.[1] ?? 0);
  const missingPackageFiles = [];
  for (const relativePath of REQUIRED_PACKAGE_FILES) {
    if (!(await fileAvailable(path.join(PACKAGE_ROOT, relativePath)))) missingPackageFiles.push(relativePath);
  }

  const ffmpeg = await commandAvailable("ffmpeg");
  const ffprobe = await commandAvailable("ffprobe");
  const ytDlp = await commandAvailable("yt-dlp");
  const whisper = await commandAvailable("whisper");
  const rasterizer = await firstAvailable(["magick", "convert", "sips"], commandAvailable);
  const nodeSupported = nodeMajor >= MINIMUM_NODE_MAJOR;
  const coreReady = nodeSupported && missingPackageFiles.length === 0;
  const renderToolsReady = ffmpeg && ffprobe;
  const apiCredentialConfigured = Boolean(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY);
  const issues = [];
  if (!nodeSupported) issues.push(`Node.js ${MINIMUM_NODE_MAJOR} or newer is required.`);
  if (missingPackageFiles.length) issues.push(`Installed package is missing ${missingPackageFiles.length} required file(s).`);
  if (!ffmpeg) issues.push("ffmpeg is required for local video rendering.");
  if (!ffprobe) issues.push("ffprobe is required for media inspection.");

  return {
    stage: "doctor",
    status: coreReady ? (renderToolsReady ? "ready" : "limited") : "not-ready",
    version: VERSION,
    runtime: {
      node: nodeVersion,
      minimum_node_major: MINIMUM_NODE_MAJOR,
      supported: nodeSupported
    },
    package: {
      root: PACKAGE_ROOT,
      complete: missingPackageFiles.length === 0,
      missing: missingPackageFiles
    },
    renderers: {
      hyperframes: hyperframesToolInfo(),
      remotion: { version: REMOTION.version }
    },
    tools: {
      ffmpeg: { available: ffmpeg, required_for_rendering: true },
      ffprobe: { available: ffprobe, required_for_rendering: true },
      rasterizer: { available: Boolean(rasterizer), command: rasterizer, required_for_rendering: false },
      whisper: { available: whisper, required_for_rendering: false },
      yt_dlp: { available: ytDlp, required_for_rendering: false }
    },
    credentials: {
      openai_api_key: Boolean(env.OPENAI_API_KEY),
      anthropic_api_key: Boolean(env.ANTHROPIC_API_KEY),
      elevenlabs_api_key: Boolean(env.ELEVENLABS_API_KEY)
    },
    modes: {
      subscription_agent: {
        available: coreReady,
        requires_api_key: false,
        skills: ["launchclip-create-video", "launchclip-cli"]
      },
      model_directed_cli: {
        available: coreReady && apiCredentialConfigured,
        requires_api_key: true
      },
      deterministic_packet: {
        available: coreReady,
        requires_api_key: false
      }
    },
    issues
  };
}

async function hasFile(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function hasCommand(command) {
  try {
    await execFileAsync(command, ["--version"], { timeout: 5000 });
    return true;
  } catch (error) {
    return error?.code !== "ENOENT";
  }
}

async function firstAvailable(commands, commandAvailable) {
  for (const command of commands) {
    if (await commandAvailable(command)) return command;
  }
  return null;
}
