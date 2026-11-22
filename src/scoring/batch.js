// `launchclip score batch <topic|brief.md>` (docs/SCORING_ROADMAP.md, stage 7):
// the day's carousels from one topic. The hook funnel writes and shortlists
// (src/scoring/funnel.js), each of the first --carousels picks becomes a
// carousel plan (src/carousel/make.js) led by its hook, and every plan's
// slides are held to the rubric (src/scorer.js).
//
// --model is the hook writer's; the carousel planner is make's own model, or
// --make-model. Plans only by default: --render also renders, checks and exports each one,
// which is heavy. Posting and scheduling are not done here.
//
// io: {client (make's model client), funnel ({client, fetch, apiKey}), make
// (a stand-in for carousel make's run), fetch, apiKey, stderr}, for tests.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readItems } from "../score_cli.js";
import { parseRubric, scoreItems } from "../scorer.js";
import { runFunnel } from "./funnel.js";

const skipped = async () => null;

/** → {topic, out, funnel (its summary), carousels: [{hook, type, project, status, failed, review}], cost_usd} and writes batch.json */
export async function runBatch(target, flags = {}, io = {}) {
  const out = path.resolve(String(flags.out ?? "batch"));
  const carousels = flags.carousels == null ? 5 : Number(flags.carousels);
  if (!Number.isInteger(carousels) || carousels < 1) throw new Error(`--carousels must be a whole number, 1 or more; got ${flags.carousels}`);
  const funnel = await runFunnel(target, { ...flags, out: path.join(out, "funnel") }, io.funnel ?? { fetch: io.fetch, apiKey: io.apiKey });
  const rubricFile = JSON.parse(await readFile(path.join(out, "funnel", "scored.json"), "utf8")).rubric;
  const rubric = parseRubric(JSON.parse(await readFile(rubricFile, "utf8")));
  // Loaded here, not at the top: carousel make pulls in the renderers, which scoring a list never needs.
  const make = io.make ?? (await import("../carousel/make.js")).run;
  const made = [];
  let cost = funnel.cost_usd.total;
  // One at a time: each plan is a long model call, and a render (with --render) must not share the machine.
  // The day's picks go round the hook types (each type's first pick, then each type's second), so a small batch is still a spread.
  const nth = funnel.shortlist.map((pick, index) => funnel.shortlist.slice(0, index).filter((before) => before.type === pick.type).length);
  const picks = funnel.shortlist.map((pick, index) => ({ pick, index })).sort((a, b) => nth[a.index] - nth[b.index] || a.index - b.index).map((entry) => entry.pick);
  for (const [index, pick] of picks.slice(0, carousels).entries()) {
    const project = path.join(out, `${String(index + 1).padStart(2, "0")}-${pick.type}`);
    const entry = { hook: pick.text, type: pick.type, project, ...(pick.wildcard ? { wildcard: true } : {}) };
    try {
      const brief = `${pick.text}\n\nOpen the carousel on that line, word for word, as the cover.\n\nTopic: ${funnel.topic}`;
      const makeFlags = { ...(flags.dest ? { dest: flags.dest } : {}), ...(flags.style ? { style: flags.style } : {}), ...(flags.slides ? { slides: flags.slides } : {}), ...(flags["make-model"] ? { model: flags["make-model"] } : {}), out: project, json: true };
      await make(brief, makeFlags, { stdout: { write() {} }, stderr: io.stderr, ...(io.client ? { client: io.client } : {}), ...(flags.render ? {} : { stages: { render: skipped, check: skipped, export: skipped } }) });
      const report = await scoreItems(await readItems(project), rubric, { model: flags["scorer-model"], context: { topic: funnel.topic }, ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.apiKey ? { apiKey: io.apiKey } : {}) });
      await writeFile(path.join(project, "score.json"), `${JSON.stringify(report, null, 2)}\n`);
      cost += report.cost_usd;
      Object.assign(entry, { status: report.status, failed: report.items.filter((item) => item.status === "failed").map((item) => item.id), review: report.items.filter((item) => item.status === "review").map((item) => item.id) });
    } catch (error) {
      // One plan that fails does not lose the rest of the day's batch.
      Object.assign(entry, { status: "error", error: String(error?.message ?? error).split("\n")[0] });
    }
    made.push(entry);
  }
  const summary = { topic: funnel.topic, out, rendered: Boolean(flags.render), funnel, carousels: made, cost_usd: Math.round(cost * 1e6) / 1e6 };
  await writeFile(path.join(out, "batch.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

/** The batch as lines a person reads. */
export function formatBatch(summary) {
  const lines = [`${summary.funnel.counts.candidates} hooks on "${summary.topic}": ${summary.funnel.counts.passed} passed, ${summary.funnel.counts.shortlisted} shortlisted (${path.join(summary.funnel.out, "shortlist.txt")})`];
  for (const entry of summary.carousels) {
    const state = entry.status === "error" ? `ERROR  ${entry.error}` : entry.status === "passed" ? "passed" : `${entry.status}: ${[...entry.failed.map((id) => `${id} failed`), ...entry.review.map((id) => `${id} to review`)].join(", ")}`;
    lines.push(`${path.basename(entry.project)}  "${entry.hook}"\n    ${state}`);
  }
  lines.push(`${summary.carousels.filter((entry) => entry.status !== "error").length} of ${summary.carousels.length} carousel plan(s) written in ${summary.out}${summary.rendered ? ", rendered" : "; render one with launchclip carousel render <project>"}. Cost $${summary.cost_usd}.`);
  return `${lines.join("\n")}\n`;
}
