import { access } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const MENU = `[A] Approve and render
[C] Request changes
[R] Run automatic repair
[O] Reopen Studio
[Q] Save and exit\n`;

export async function runProductionReview(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const output = adapters.output ?? process.stderr;
  const prompt = createPrompt(adapters, output);
  let preview = null;
  let latest = options.initial ?? await adapters.getStatus?.(workspace) ?? null;

  try {
    preview = await requiredAdapter(adapters.openPreview, "openPreview")(workspace);
    output.write(`\nLaunchClip review\nStudio: ${preview.studio?.url ?? preview.project ?? workspace}\n`);
    while (true) {
      output.write(`\n${formatStatus(latest)}\n${MENU}`);
      const action = String(await prompt.ask("Choose an action: ")).trim().toUpperCase();
      if (action === "A") {
        output.write("\nRunning final verification and render...\n");
        const render = await requiredAdapter(adapters.approve, "approve")(workspace);
        latest = render;
        if (render?.status === "awaiting-human-review") {
          return reviewResult(workspace, "approved-and-rendered", preview, latest, render);
        }
        output.write("Final render still needs repair. Review the updated findings before approving again.\n");
        continue;
      }
      if (action === "C") {
        const request = String(await prompt.ask("Describe the changes you want: ")).trim();
        if (!request) {
          output.write("No change request entered.\n");
          continue;
        }
        output.write("\nScoping the request, repairing, and rebuilding the draft...\n");
        latest = await requiredAdapter(adapters.revise, "revise")(workspace, { humanReviewRequest: request });
        output.write("Revision complete. Studio will refresh the assembled project automatically.\n");
        continue;
      }
      if (action === "R") {
        output.write("\nRepairing the current QA findings and rebuilding the draft...\n");
        latest = await requiredAdapter(adapters.revise, "revise")(workspace, {});
        output.write("Repair pass complete. Studio will refresh the assembled project automatically.\n");
        continue;
      }
      if (action === "O") {
        preview = await requiredAdapter(adapters.openPreview, "openPreview")(workspace);
        output.write(`Studio: ${preview.studio?.url ?? preview.project ?? workspace}\n`);
        continue;
      }
      if (action === "Q") {
        return reviewResult(workspace, "saved", preview, latest, null);
      }
      output.write("Choose A, C, R, O, or Q.\n");
    }
  } finally {
    prompt.close();
  }
}

export async function isProductionReviewWorkspace(workspacePath) {
  const workspace = path.resolve(workspacePath);
  try {
    await access(path.join(workspace, "production", "intake.json"));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function createPrompt(adapters, output) {
  if (adapters.ask) return { ask: adapters.ask, close: () => {} };
  const input = adapters.input ?? process.stdin;
  if (!input.isTTY || !output.isTTY) {
    const error = new Error("Interactive production review requires a terminal. Run launchclip production-preview for non-interactive review, then launchclip production-render --approve when ready.");
    error.code = "LAUNCHCLIP_INTERACTIVE_REVIEW_REQUIRES_TTY";
    throw error;
  }
  const readline = createInterface({ input, output });
  return { ask: (question) => readline.question(question), close: () => readline.close() };
}

function formatStatus(value) {
  const status = value?.status ?? "awaiting-approval";
  const verdict = value?.critique?.verdict ?? value?.draft?.critique?.verdict ?? null;
  const findings = value?.critique?.findings ?? value?.draft?.critique?.findings ?? null;
  const details = [verdict ? `critic: ${verdict}` : null, Number.isInteger(findings) ? `findings: ${findings}` : null].filter(Boolean);
  return `Status: ${status}${details.length ? ` (${details.join(", ")})` : ""}`;
}

function reviewResult(workspace, action, preview, latest, render) {
  return {
    stage: "production-review",
    status: render?.status ?? "awaiting-approval",
    action,
    workspace,
    studio: preview?.studio ?? null,
    latest: latest ? { stage: latest.stage ?? null, status: latest.status ?? null, video: latest.video ?? latest.draft?.video ?? null, critique: latest.critique ?? latest.draft?.critique ?? null } : null,
    render,
    next: render
      ? `Review the final render at ${render.video}. LaunchClip does not publish it.`
      : `Resume with: launchclip review ${workspace}`
  };
}

function requiredAdapter(value, name) {
  if (typeof value !== "function") throw new Error(`Production review requires the ${name} adapter`);
  return value;
}
