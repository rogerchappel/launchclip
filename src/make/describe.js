// `launchclip make`'s use of asset understanding (src/asset_understanding.js).
//
//   describeMakeAssets(ctx, inventory) → describeInventory()'s result
//   featuredForMake(ctx, media)        → [{src, reason, shows?}]
//
// --asset-descriptions auto (default) asks the run's model when it can take
// images and guesses locally otherwise; local never calls a model; off leaves
// the inventory as the heuristics and the caller's notes made it.
// adapters.describeAssets(inventory, options) replaces the whole pass.
import { describeInventory, featuredAssets } from "../asset_understanding.js";
import { storySrc } from "../constraints.js";

export async function describeMakeAssets(ctx, inventory) {
  const { adapters, options, report } = ctx;
  const mode = String(options.assetDescriptions ?? "auto").toLowerCase();
  const settings = { root: ctx.assetsDir, mode, client: ctx.model?.client ?? null, vision: Boolean(ctx.model?.vision), model: ctx.model?.spec ?? null, env: ctx.env, notice: ctx.say, concurrency: ctx.gate?.limit ?? 1 };
  let result;
  try {
    result = await (adapters.describeAssets ?? describeInventory)(inventory, settings);
  } catch (error) {
    // Descriptions are advisory: a failure costs them, never the video.
    report.warnings.push(`assets: the files were not described (${String(error?.message ?? error).split("\n")[0]})`);
    return { described: [], results: [], warnings: [], counts: { notes: 0, vision: 0, local: 0 } };
  }
  for (const warning of result.warnings ?? []) report.warnings.push(`assets: ${warning}`);
  return { described: [], results: [], warnings: [], counts: { notes: 0, vision: 0, local: 0 }, ...result };
}

/** The handed-in files the plan must not leave out; must_use files are the constraints' to enforce. */
export function featuredForMake(ctx, media) {
  if (String(ctx.options.assetDescriptions ?? "auto").toLowerCase() === "off") return [];
  const pinned = new Set((ctx.constraints?.must_use ?? []).map((entry) => storySrc(entry.src)));
  return featuredAssets(media, { prompt: ctx.text }).filter((item) => !pinned.has(item.src));
}
