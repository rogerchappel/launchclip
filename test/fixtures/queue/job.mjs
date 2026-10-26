// A job for test/queue.test.js: takes a slot, says when, holds it, lets go.
//   node job.mjs <kind> <label> <hold-ms>
// stdout: "acquired <epoch-ms>" then "released <epoch-ms>"; stderr: the queue's waiting lines.
import { withSlot } from "../../../src/queue.js";

const [kind, label, hold] = process.argv.slice(2);
// node --test also runs this file, with no arguments: nothing to do then.
if (kind) await withSlot(kind, { label, log: (line) => process.stderr.write(`${line}\n`) }, async () => {
  process.stdout.write(`acquired ${Date.now()}\n`);
  await new Promise((resolve) => setTimeout(resolve, Number(hold)));
  process.stdout.write(`released ${Date.now()}\n`);
});
