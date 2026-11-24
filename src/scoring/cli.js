// launchclip score <action>: the stages built on the scorer (docs/SCORING_ROADMAP.md).
//
//   score hooks <topic|brief.md>                      write many hooks, keep a varied shortlist
//   score batch <topic|brief.md>                      the day's carousel plans, each held to the rubric
//   score library discover "<keywords>"               find a niche's creators by keyword, collect their posts
//   score library import|fetch|tag|map <target>       a library of real posts, tagged, and its niche map
//   score rubric draft <library.jsonl>                draft a rubric from what separates a library's winners
//   score fit <library.tagged.jsonl>                  a small model of which answers go with above-normal results
//   score predict <scored.json|tagged.jsonl>          that model's guess for new items
//
// Plain `launchclip score <project|file>` is the rubric gate (src/score_cli.js).

export const SCORE_ACTIONS = Object.freeze(["hooks", "batch", "library", "rubric", "fit", "predict", "niche"]);

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
  if (action === "library" && args[0] === "discover") {
    const { runDiscover } = await import("./discover.js");
    const result = await runDiscover(args[1], flags, { stderr: io.stderr });
    if (flags.json) return json(result);
    for (const warning of result.warnings) write(`warning: ${warning}\n`);
    return write(`${result.creators} creators found, ${result.added} posts collected, ${result.count} in the library: ${result.out}\nNext: launchclip score rubric draft ${result.out}\n`);
  }
  if (action === "niche") {
    const { runNiche, formatNiche } = await import("./niche.js");
    const summary = await runNiche(args[0], flags, { stderr: io.stderr });
    return flags.json ? json(summary) : write(formatNiche(summary));
  }
  if (action === "rubric") {
    if (args[0] !== "draft") throw new Error("usage: launchclip score rubric draft <library.jsonl> [--niche \"<a few words>\"] [--questions <n>] [--out rubric.draft.json]");
    const { runRubricDraft, formatRubricDraft } = await import("./rubric.js");
    const summary = await runRubricDraft(args[1], flags);
    return flags.json ? json(summary) : write(formatRubricDraft(summary));
  }
  if (action === "library" && args[0] === "evidence") {
    const { runEvidence } = await import("./evidence.js");
    const result = await runEvidence(args[1], flags, { stdout: io.stderr });
    return flags.json ? json(result) : write(`${result.counts.posts} posts read: ${result.counts.transcripts} transcripts, ${result.counts.thumbs} covers and ${result.counts.slides} slide sheets kept (${result.counts.subtitle_failures + result.counts.thumb_failures + result.counts.slide_failures} could not be fetched): ${result.out}\n`);
  }
  if (action === "library" && args[0] === "keywords") {
    const { runKeywords, formatKeywords } = await import("./keywords.js");
    const result = await runKeywords(args[1], flags);
    return flags.json ? json(result) : write(formatKeywords(result));
  }
  if (action === "library" && args[0] === "compare") {
    const { runCompare } = await import("./compare.js");
    await runCompare(args.slice(1), flags, { stdout: io.stdout }); // prints itself
    return undefined;
  }
  if (action === "library" && args[0] === "video") {
    const { runVideo } = await import("./video.js");
    const result = await runVideo(args[1], flags, { stdout: io.stderr });
    return flags.json ? json(result) : write(`${result.counts.done} of ${result.counts.sampled} videos read, ${result.counts.failed} failed: ${result.out}\n`);
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
