import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PRODUCTION_PATHS } from "./production_contracts.js";

const execFileAsync = promisify(execFile);
const DEFAULT_PORT = 3002;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const CONTEXT_POLL_INTERVAL_MS = 200;

export async function openProductionPreview(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const project = path.join(workspace, PRODUCTION_PATHS.hyperframes);
  await (adapters.assertProject ?? assertPreviewProject)(project);
  const port = normalizePort(options.port);
  const studio = await (adapters.launchStudio ?? launchHyperFramesStudio)(project, {
    port,
    open: options.open !== false,
    timeoutMs: options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
  }, adapters);
  const finalRenderCommand = `launchclip production-render ${workspace} --approve --quality high`;
  return {
    stage: "production-preview",
    status: "awaiting-approval",
    workspace,
    project,
    studio,
    final_render_command: finalRenderCommand,
    next: `Review and edit the video in ${studio.url}. Do not use Studio Export as the LaunchClip final. After explicit approval, run: ${finalRenderCommand}`
  };
}

export async function launchHyperFramesStudio(project, options = {}, adapters = {}) {
  const startProcess = adapters.spawnProcess ?? spawnPreviewProcess;
  const readContext = adapters.readContext ?? readPreviewContext;
  const openUrl = adapters.openUrl ?? openExternalUrl;
  const wait = adapters.wait ?? waitFor;
  const settings = {
    port: normalizePort(options.port),
    open: options.open !== false,
    timeoutMs: options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
  };
  const existing = await readContext(project);
  if (isProjectServer(existing, project)) {
    const url = studioProjectUrl(existing.port, existing.projectName);
    if (settings.open) await openUrl(url);
    return studioResult(existing, url, settings.open, true);
  }

  const child = startProcess(project, settings);
  let spawnError = null;
  child.once?.("error", (error) => { spawnError = error; });

  const deadline = Date.now() + settings.timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`Could not start HyperFrames Studio: ${spawnError.message}`);
    const server = await readContext(project);
    if (isProjectServer(server, project)) {
      child.unref?.();
      const url = studioProjectUrl(server.port, server.projectName);
      return studioResult(server, url, settings.open, false);
    }
    if (child.exitCode != null && child.exitCode !== 0) {
      throw new Error(`HyperFrames Studio exited before it became ready (exit ${child.exitCode}). Run npx hyperframes preview ${project} directly for diagnostics.`);
    }
    await wait(CONTEXT_POLL_INTERVAL_MS);
  }

  child.kill?.();
  throw new Error(`Timed out waiting for HyperFrames Studio after ${settings.timeoutMs}ms. Run npx hyperframes preview ${project} directly for diagnostics.`);
}

function spawnPreviewProcess(project, options) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["hyperframes", "preview", "--port", String(options.port)];
  if (options.open === false) args.push("--no-open");
  args.push(project);
  return spawn(executable, args, {
    cwd: project,
    detached: process.platform !== "win32",
    stdio: "ignore"
  });
}

async function readPreviewContext(project) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["hyperframes", "preview", "--context", "--json", "--context-fields", "server", project];
  try {
    const { stdout } = await execFileAsync(executable, args, { cwd: project, timeout: 5_000, maxBuffer: 1024 * 1024 });
    const payload = JSON.parse(stdout);
    return payload.ok ? payload.server ?? null : null;
  } catch (error) {
    const payload = parseJson(error?.stdout);
    return payload?.ok ? payload.server ?? null : null;
  }
}

function openExternalUrl(url) {
  const command = browserOpenCommand(url);
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function browserOpenCommand(url) {
  if (process.platform === "darwin") return { executable: "open", args: [url] };
  if (process.platform === "win32") return { executable: "cmd.exe", args: ["/c", "start", "", url] };
  return { executable: "xdg-open", args: [url] };
}

async function assertPreviewProject(project) {
  try {
    await access(path.join(project, "index.html"));
  } catch {
    throw new Error(`Assembled HyperFrames project is missing: ${path.join(project, "index.html")}. Run launchclip assemble first.`);
  }
}

function normalizePort(value) {
  const port = value == null ? DEFAULT_PORT : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid Studio port: ${value}. Expected an integer from 1 to 65535.`);
  }
  return port;
}

function isProjectServer(server, project) {
  return Boolean(server?.projectDir && path.resolve(server.projectDir) === path.resolve(project));
}

function studioResult(server, url, openedBrowser, reusedServer) {
  return {
    port: server.port,
    project_name: server.projectName,
    url,
    opened_browser: openedBrowser,
    reused_server: reusedServer
  };
}

function studioProjectUrl(port, projectName) {
  return `http://localhost:${port}/#project/${encodeURIComponent(projectName)}`;
}

function parseJson(value) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return null;
  }
}

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
