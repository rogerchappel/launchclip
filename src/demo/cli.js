// `launchclip demo record <repo>` and `launchclip demo approve <dir>`.
import path from "node:path";
import { createPlannerClient } from "../storyboard_planner.js";
import { approveFlows, askYesNo, runAutopilot } from "./autopilot.js";

const list = (value) => (typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : []);

export async function runDemoCommand(action, target, flags = {}, { log = () => {}, stdin = process.stdin, ask } = {}) {
  if (action === "approve") {
    if (!target) throw new Error("launchclip demo approve needs the recording dir (the --out of demo record)");
    const receipt = await approveFlows(target, { flows: list(flags.flows), reject: Boolean(flags.reject) });
    return { stage: "demo-approve", out: receipt.out, flows: receipt.flows.map(({ id, review }) => ({ id, review })) };
  }
  if (!target) throw new Error("launchclip demo record needs the app repo path");
  // A model writes the plan only when one is named; otherwise the heuristic
  // tour (or --plan) is used, so recording never needs an API key.
  const modelSpec = flags.model ?? null;
  const client = modelSpec && !flags.plan ? createPlannerClient(modelSpec).client : null;
  // Default: assets/demo in the current story project, as `make` expects.
  const out = path.resolve(flags.out ?? path.join("assets", "demo"));
  const receipt = await runAutopilot(target, { ...flags, out }, { log, client, ask: ask ?? ((question) => askYesNo(question, { input: stdin })) });
  if (receipt.recorded === false) return { stage: "demo-plan", plan: receipt.plan, plan_source: receipt.plan_source, next: `edit ${receipt.plan}, then run launchclip demo record ${target} --plan ${receipt.plan}` };
  return {
    stage: "demo-record",
    out: receipt.out,
    plan: path.join(receipt.out, receipt.plan),
    plan_source: receipt.plan_source,
    flows: receipt.flows.map(({ id, duration, review, video, sheet }) => ({ id, duration, review, video, sheet })),
    review: path.join(receipt.out, "REVIEW.md"),
    next: `look at each contact sheet (or clip) in ${receipt.out}, then run launchclip demo approve ${receipt.out}`
  };
}
