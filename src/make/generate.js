// make --generate: the footage generator (src/generate/generator.js) as make's
// asset provider, behind the app's own provider when there is one.
import { askYesNo } from "../demo/autopilot.js";
import { lookParagraph } from "../generate/brief.js";
import { createGenerator, createProviders, generateSpecs, parseBudget, visionKeyframeCheck } from "../generate/generator.js";

/** The --generate* flags as specs, or null when generation is off. */
export function makeGenerateSpecs(options = {}) {
  return generateSpecs({ generate: options.generate, image: options.generateImage, video: options.generateVideo, draftVideo: options.generateDraftVideo });
}

/** → a generator over `library`, or null when no --generate flag is set. */
export async function makeGenerator(ctx, { library = null, brand = null } = {}) {
  const specs = makeGenerateSpecs(ctx.options);
  if (!specs) return null;
  const providers = await createProviders(specs, { env: ctx.env, notice: ctx.say, cwd: ctx.project });
  // An attended run asks about the quote, as make's other approval points do.
  const attended = Boolean(ctx.adapters.ask) || Boolean(process.stdin.isTTY && process.stderr.isTTY);
  const vision = Boolean(ctx.model?.vision && ctx.model?.client?.runStructured);
  ctx.say(`generate: footage shots the ${library ? "library has no match for" : "plan asks for"} are made with ${[specs.image, specs.video].filter(Boolean).map((spec) => `${spec.provider}${spec.provider !== "cmd" && spec.model ? `:${spec.model}` : ""}`).join(" → ")} (PAID unless local; quoted first)`);
  return createGenerator({
    project: ctx.project,
    image: providers.image,
    video: providers.video,
    budget: parseBudget(ctx.options.budget),
    daily: parseBudget(ctx.options.budgetDaily, "--budget-daily"),
    tier: specs.draftVideo ? "draft" : "final",
    maxCalls: parseMaxGenerations(ctx.options.maxGenerations),
    library,
    check: vision ? visionKeyframeCheck(ctx.model.client) : null,
    approve: attended ? (question) => (ctx.adapters.ask ?? askYesNo)(question) : null,
    look: lookParagraph({ brand }),
    fps: Number(ctx.format?.fps) || undefined,
    notice: ctx.say
  });
}

/** --max-generations <n>: the cap on paid calls to a provider that gives no price; nothing → null. */
export function parseMaxGenerations(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--max-generations must be a whole number of calls from 1; got ${value}`);
  return n;
}
