#!/usr/bin/env node
// What running independent work at the same time changes in `launchclip make`,
// on a recorded run: the answers are fixed (test/helpers/make_recorded_run.js)
// and every model call and still takes a set time, so the only thing that
// differs between the two columns is what overlaps.
//
//   node benchmarks/make-concurrency/run.mjs [--call-ms 400] [--still-ms 100] [--json]
//
// It runs two briefs (a prompt with one clip, and the same with six
// screenshots handed in), each at --model-concurrency 1 --concurrency 1 (one
// thing at a time, as before) and at --model-concurrency 4 --concurrency 2.
// No model, voice or renderer is called. Results: benchmarks/MAKE_CONCURRENCY.md.
import { SCREENSHOTS, recordedRun } from "../../test/helpers/make_recorded_run.js";

const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? Number(process.argv[index + 1]) : fallback;
};
const callMs = flag("call-ms", 400);
const stillMs = flag("still-ms", 100);
const STAGES = ["inventory", "prepare", "storyboard", "candidates", "total"];

async function measure(screenshots, options) {
  const recorded = await recordedRun({ callMs, stillMs, screenshots });
  try {
    const { report, calls } = await recorded.run(options);
    if (report.status !== "ready") throw new Error(`the recorded run ended ${report.status}: ${JSON.stringify(report.stages)}`);
    return { timings: report.timings, calls: calls.length, model_calls: report.model_calls };
  } finally {
    await recorded.cleanup();
  }
}

const briefs = [["a prompt and one clip", []], [`the same with ${SCREENSHOTS.length} screenshots`, SCREENSHOTS]];
const results = [];
for (const [name, screenshots] of briefs) {
  const before = await measure(screenshots, { modelConcurrency: 1, concurrency: 1 });
  const after = await measure(screenshots, { modelConcurrency: 4, concurrency: 2 });
  results.push({ brief: name, calls: after.calls, before: before.timings, after: after.timings, peak: after.model_calls?.peak ?? 1, overlapped: after.model_calls?.overlapped ?? 0 });
}

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ call_ms: callMs, still_ms: stillMs, results }, null, 2)}\n`);
} else {
  process.stdout.write(`Recorded run: every model call takes ${callMs} ms and every still ${stillMs} ms.\n\n`);
  for (const result of results) {
    process.stdout.write(`${result.brief} (${result.calls} model calls, ${result.overlapped} of them beside another, ${result.peak} at most at once)\n\n`);
    process.stdout.write("| stage | one at a time (s) | overlapping (s) | change |\n|---|---|---|---|\n");
    for (const stage of STAGES) {
      const [a, b] = [result.before[stage], result.after[stage]];
      process.stdout.write(`| ${stage} | ${a.toFixed(1)} | ${b.toFixed(1)} | ${a > 0 ? `${Math.round((b - a) / a * 100)}%` : "0%"} |\n`);
    }
    process.stdout.write("\n");
  }
}
