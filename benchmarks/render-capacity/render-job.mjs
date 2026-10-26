// One render, as finish runs it, for benchmarks/render-capacity/run.mjs to
// measure from outside. node render-job.mjs <prepared-dir> <renderer> <quality> <concurrency> <out.mp4>
// <prepared-dir> is the project (remotion) or its compiled HyperFrames folder.
import { getRenderer } from "../../src/renderers/index.js";

const [dir, renderer, quality, concurrency, out] = process.argv.slice(2);
const options = renderer === "hyperframes" ? { quality, workers: Number(concurrency) } : { quality, concurrency: Number(concurrency) };
await getRenderer(renderer).render(dir, out, options);
