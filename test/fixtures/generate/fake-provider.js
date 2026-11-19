// A deterministic, offline provider for generation tests
// (docs/GENERATED_FOOTAGE_RFC.md §5). Same contract as a real adapter:
// the image step copies a small PNG fixture, the video step a small MP4.
//
//   const fake = createFakeProvider({price: 0.05, fail: ['video'], pollsUntilDone: 2});
//   fake.calls   // [['quote', brief.id, step, tier], ['submit', …], …]
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'parity', 'assets');
const SOURCE = { image: path.join(ASSETS, 'testsrc.png'), video: path.join(ASSETS, 'shots', 'blocks-static.mp4') };

export function createFakeProvider({ id = 'fake', price = 0, unit = 'usd', fail = [], pollsUntilDone = 1, steps = ['image', 'video'] } = {}) {
  const calls = [];
  const polls = new Map();
  return {
    id,
    steps,
    calls,
    async quote(brief, step, tier) {
      calls.push(['quote', brief.id, step, tier]);
      return { amount: price, unit };
    },
    async submit(brief, step, tier, { startFrame, signal } = {}) {
      signal?.throwIfAborted();
      if (step === 'video' && !startFrame) throw new Error('fake: the video step needs a startFrame');
      calls.push(['submit', brief.id, step, tier]);
      return { provider: id, model: `${id}-${step}-${tier}`, step, request_id: `${id}-${brief.id}-${step}-${tier}` };
    },
    async poll(job) {
      calls.push(['poll', job.request_id]);
      const count = (polls.get(job.request_id) ?? 0) + 1;
      polls.set(job.request_id, count);
      if (count < pollsUntilDone) return { state: count === 1 ? 'queued' : 'running' };
      return fail.includes(job.step) ? { state: 'failed', error: `fake: ${job.step} failed` } : { state: 'done' };
    },
    async fetch(job, outDir) {
      calls.push(['fetch', job.request_id]);
      await mkdir(outDir, { recursive: true });
      const file = path.join(outDir, `${job.request_id}${path.extname(SOURCE[job.step])}`);
      await copyFile(SOURCE[job.step], file);
      return { file, seed: 42, model: job.model, licence: 'test fixture', cost: { amount: price, unit } };
    }
  };
}
