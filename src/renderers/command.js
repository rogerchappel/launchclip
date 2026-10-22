import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Default command runner shared by the renderer adapters. It rejects on a
// non-zero exit, like the runners in production_render.js and cinematic_check.js.
export async function runCommand(command, args, options = {}) {
  return execFileAsync(command, args, { ...options, maxBuffer: 1024 * 1024 * 128 });
}

// Runs a command and never throws: returns {ok, exit_code, stdout, stderr}
// with stdout parsed as JSON when possible.
export async function captureCommand(run, command, args, options = {}) {
  try {
    const result = await run(command, args, options);
    return {
      ok: true,
      exit_code: Number(result?.exitCode ?? result?.exit_code ?? 0),
      stdout: parseOutput(result?.stdout),
      stderr: String(result?.stderr ?? "")
    };
  } catch (error) {
    return {
      ok: false,
      exit_code: Number(error?.code ?? error?.exitCode ?? 1) || 1,
      stdout: parseOutput(error?.stdout),
      stderr: String(error?.stderr ?? error?.message ?? "")
    };
  }
}

export function parseOutput(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text.slice(0, 40_000); }
}

// True when a structured CLI report carries no failure, error count or
// blocking severity anywhere in its tree.
export function structuredOk(value) {
  if (!value || typeof value !== "object") return false;
  let failed = value.ok === false || Number(value.errorCount ?? value.error_count ?? 0) > 0;
  const visit = (entry) => {
    if (failed || entry == null || typeof entry !== "object") return;
    if (entry.ok === false || Number(entry.errorCount ?? entry.error_count ?? 0) > 0) failed = true;
    if (new Set(["error", "blocking", "fatal"]).has(String(entry.severity ?? "").toLowerCase())) failed = true;
    for (const child of Object.values(entry)) visit(child);
  };
  visit(value);
  return !failed;
}

export function adapterError(label, result) {
  const detail = String(result?.stderr || (typeof result?.stdout === "string" ? result.stdout : "") || "").trim().split("\n").slice(-12).join("\n");
  const error = new Error(`${label} failed (exit ${result?.exit_code ?? "?"})${detail ? `:\n${detail}` : ""}`);
  error.result = result;
  return error;
}
