// launchclip score <action>: the stages built on the scorer (docs/SCORING_ROADMAP.md).
//
//   score hooks <topic|brief.md>                      write many hooks, keep a varied shortlist
//   score batch <topic|brief.md>                      the day's carousel plans, each held to the rubric
//   score library import|fetch|tag|map <target>       a library of real posts, tagged, and its niche map
//   score fit <library.tagged.jsonl>                  a small model of which answers go with above-normal results
//   score predict <scored.json|tagged.jsonl>          that model's guess for new items
//
// Plain `launchclip score <project|file>` is the rubric gate (src/score_cli.js).

export const SCORE_ACTIONS = Object.freeze(["hooks", "batch", "library", "fit", "predict"]);

/** The funnel's summary as lines a person reads. */
export function formatFunnel(summary) {
  const { counts, seconds, cost_usd: cost } = summary;
  const lines = [`${counts.candidates} hooks on "${summary.topic}" (${counts.written} written, ${counts.assembled} assembled): ${counts.passed} passed, ${counts.review} to review, ${counts.failed} failed`];
  for (const item of summary.shortlist) lines.push(`  ${String(item.type).padEnd(12)} ${item.text}${item.wildcard ? "  (wildcard)" : ""}`);
  for (const warning of summary.warnings) lines.push(`warning: ${warning}`);
  lines.push(`${counts.shortlisted} shortlisted in ${summary.out}/shortlist.txt${summary.ranked_by_results ? ", ordered by the fitted model" : ""}. ${seconds.total} s, $${cost.total}. A spread to pick from, not a ranking.`);
  return `${lines.join("\n")}\n`;
}

export async function runScoreCommand(action, args, flags, io) {
  const write = (text) => io.stdout.write(text);
  const json = (value) => write(`${JSON.stringify(value, null, 2)}\n`);
  if (action === "hooks") {
    const { runFunnel } = await import("./funnel.js");
    const summary = await runFunnel(args[0], flags);
    return flags.json ? json(summary) : write(formatFunnel(summary));
  }
  if (action === "batch") {
    const { runBatch, formatBatch } = await import("./batch.js");
    const summary = await runBatch(args[0], flags, { stderr: io.stderr });
    return flags.json ? json(summary) : write(formatBatch(summary));
  }
  if (action === "library") {
    const { runLibrary } = await import("./library.js");
    const result = await runLibrary(args[0], args[1], flags, { stdout: io.stdout });
    if (args[0] === "map") return undefined; // map prints itself
    return flags.json ? json(result) : write(`${args[0] === "tag" ? `${result.count} posts tagged${result.media_skipped ? ` (${result.media_skipped} from their words alone)` : ""}` : `${result.added} posts read, ${result.count} in the library`}: ${result.out}\n`);
  }
  const { runFit } = await import("./fit.js");
  const result = await runFit(action, args[0], flags, { write: flags.json ? () => {} : write });
  if (flags.json) json(result);
  return undefined;
}
