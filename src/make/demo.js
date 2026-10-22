// `launchclip make --repo <path>`: demo autopilot as a make stage.
//
// Records the repo's key flows into <project>/assets/demo (src/demo/autopilot.js),
// then hands the approved flows to the script and storyboard as manifest
// lines that carry ready-made product-demo params (built from each flow's
// action log), so the model places the clips and never invents action boxes.
//
// Consent, as in `launchclip demo record`: the repo's seed and start commands
// run only after a yes on a TTY or --approve-demo, and flows are used only once
// approved (a yes on a TTY after the contact sheets are listed,
// --approve-demo, or `launchclip demo approve`). Headless without approval,
// the stage stops with the review as the next step; a re-run reuses the
// recording.
import { existsSync } from "node:fs";
import path from "node:path";
import { productDemoParams } from "../../kit/core/catalog-d.mjs";
import { RECEIPT_FILE, approveFlows, approvedFlows, askYesNo, runAutopilot } from "../demo/autopilot.js";

export const DEMO_DIR = "assets/demo";
// A product-demo scene longer than this drags; longer flows are trimmed from the end.
export const MAX_DEMO_SCENE = 14;

export class DemoReviewNeeded extends Error {}

/** The make stage. ctx: the make context (project, options, adapters, model, say, report, text). */
export async function stageDemo(ctx) {
  const { project, options, adapters, report, say } = ctx;
  if (!options.repo) return { status: "skipped", reason: "no --repo" };
  const out = path.join(project, DEMO_DIR);
  const ask = adapters.ask ?? ((question) => askYesNo(question));
  const receiptFile = path.join(out, RECEIPT_FILE);
  let recorded = false;
  if (!existsSync(receiptFile) || options.redemo) {
    // The make model plans the flows when there is one (one PAID call); otherwise the heuristic tour.
    if (ctx.model?.client) say(`model: PAID call to ${ctx.model.provider} ${ctx.model.model} (demo flow plan)`);
    const receipt = await (adapters.autopilot ?? runAutopilot)(path.resolve(options.repo), {
      out, prompt: ctx.text, approve: Boolean(options.approveDemo), start: options.start, url: options.url,
      "allow-host": options.allowHost, ...(options.demoPlan ? { plan: options.demoPlan } : {})
    }, { log: (line) => say(`demo: ${line}`), ask, client: ctx.model?.client ?? null });
    recorded = true;
    say(`demo: recorded ${receipt.flows.length} flow(s) into ${path.relative(project, out)}; review ${path.relative(project, path.join(out, "REVIEW.md"))}`);
  }
  let flows = await approvedFlows(out);
  if (!flows.length) {
    const review = path.relative(project, path.join(out, "REVIEW.md"));
    if (options.approveDemo) await approveFlows(out);
    else if (await ask(`demo: ${recorded ? "recorded" : "found"} flows in ${path.relative(project, out)}; contact sheets are listed in ${review}. Use them all in the video?`)) await approveFlows(out);
    else throw new DemoReviewNeeded(`no approved demo flows: look at the contact sheets in ${review}, run launchclip demo approve ${out} [--flows a,b], then re-run make (the recording is reused)`);
    flows = await approvedFlows(out);
  }
  ctx.demo = flows.map((flow) => {
    const duration = Math.round(Math.min(flow.record.duration, MAX_DEMO_SCENE) * 1000) / 1000;
    const src = `${DEMO_DIR}/${path.basename(flow.video)}`;
    return { id: flow.id, title: flow.title, src, duration, params: productDemoParams(flow.record, { src, sourceStart: 0, duration }), actions: flow.record.actions.filter((action) => ["click", "type"].includes(action.type)).map((action) => `${action.type} ${action.label ?? action.text ?? ""}`.trim()) };
  });
  report.demo = { dir: path.relative(project, out), recorded, flows: ctx.demo.map(({ id, title, duration }) => ({ id, title, duration })) };
  return { status: recorded ? "done" : "cached", ...(recorded ? {} : { reason: "reused the recording in assets/demo (pass --redemo to record again)" }) };
}

/** Manifest lines (assetManifestLines shape) for the approved demo flows. */
export function demoManifestLines(ctx) {
  return (ctx.demo ?? []).map((flow) => ({
    src: flow.src,
    kind: "video",
    line: `${flow.src} — product demo recording "${flow.title}" (${flow.duration}s; ${flow.actions.join(" → ") || "a page tour"}). Use as a product-demo scene of at most ${flow.duration}s with exactly these params (copy unchanged; to shorten the scene, keep media.sourceStart and drop actions and callouts past the new end): ${JSON.stringify(flow.params)}`
  }));
}
