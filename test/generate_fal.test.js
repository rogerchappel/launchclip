// The fal.ai provider adapter (src/generate/providers/fal.js) against a
// mocked fetch: no network, no real key.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFalProvider, pickDuration } from '../src/generate/providers/fal.js';
import { createFakeProvider } from './fixtures/generate/fake-provider.js';

const KEY = 'test-key-not-real';
const PNG = path.resolve('test/fixtures/parity/assets/testsrc.png');
const BRIEF = {
  id: 's3', kind: 'footage', steps: ['image', 'video'],
  image: { prompt: 'a bakery at dawn', negative: 'no text', width: 1920, height: 1080, references: [PNG] },
  video: { prompt: 'slow push in', seconds: 4, pad_seconds: 0.5, fps: 30 },
  brief_hash: 'sha256:abc'
};
const OPENAPI = {
  'fal-ai/flux/dev': { components: { schemas: { FluxInput: { properties: { prompt: {}, image_size: {} } } } } },
  'fal-ai/nano-banana': { components: { schemas: { NanoInput: { properties: { prompt: {}, aspect_ratio: { enum: ['1:1', '16:9', '9:16'] } } } } } },
  'fal-ai/veo3.1/image-to-video': { components: { schemas: { VeoInput: { properties: {
    prompt: {}, image_url: {}, negative_prompt: {}, duration: { enum: ['4s', '6s', '8s'] }, aspect_ratio: { enum: ['auto', '16:9', '9:16'] } } } } } }
};

// A fal stand-in: records requests, answers queue, models, pricing and CDN calls.
function mockFal({ statuses = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'], error, prices = {}, license } = {}) {
  const requests = [];
  let polls = 0;
  const fetch = async (url, init = {}) => {
    requests.push({ url, ...init, body: init.body && JSON.parse(init.body) });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    const u = new URL(url);
    if (u.host === 'api.fal.ai' && u.pathname === '/v1/models') {
      const id = u.searchParams.get('endpoint_id');
      return json({ models: [{ endpoint_id: id, metadata: { license_type: license }, openapi: OPENAPI[id] }] });
    }
    if (u.pathname === '/v1/models/pricing') {
      const id = u.searchParams.get('endpoint_id');
      return json({ prices: prices[id] ? [{ endpoint_id: id, currency: 'USD', ...prices[id] }] : [] });
    }
    if (u.host === 'queue.fal.run' && init.method === 'POST') {
      const app = u.pathname.split('/').slice(1, 3).join('/');
      const base = `https://queue.fal.run/${app}/requests/req-1`;
      return json({ request_id: 'req-1', status_url: `${base}/status`, response_url: base, cancel_url: `${base}/cancel` });
    }
    if (u.pathname.endsWith('/status')) {
      const status = statuses[Math.min(polls++, statuses.length - 1)];
      return json({ status, ...(status === 'COMPLETED' && error && { error, error_type: 'runner_server_error' }) });
    }
    if (u.pathname.endsWith('/cancel')) return json({ status: 'CANCELLATION_REQUESTED' }, 202);
    if (u.host === 'queue.fal.run') {
      return json(u.pathname.includes('flux') || u.pathname.includes('nano')
        ? { images: [{ url: 'https://v3.fal.media/files/a/img.png', content_type: 'image/png' }], seed: 7 }
        : { video: { url: 'https://v3.fal.media/files/b/clip.mp4' } });
    }
    if (u.host === 'v3.fal.media') return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`bytes of ${u.pathname}`).buffer };
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, requests };
}

const provider = (mock, extra = {}) => createFalProvider({
  imageModel: 'fal-ai/flux/dev', videoModel: 'fal-ai/veo3.1/image-to-video', fetch: mock.fetch, env: { FAL_KEY: KEY }, ...extra
});

async function run(fal, step, options) {
  const job = await fal.submit(BRIEF, step, 'final', options);
  let status;
  do status = await fal.poll(job); while (status.state === 'queued' || status.state === 'running');
  return { job, status };
}

test('image step: submit, poll, fetch writes the still and returns seed, model and licence', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const mock = mockFal();
  const fal = provider(mock);
  const { job, status } = await run(fal, 'image');
  assert.equal(status.state, 'done');
  const submit = mock.requests.find((r) => r.method === 'POST');
  assert.equal(submit.url, 'https://queue.fal.run/fal-ai/flux/dev');
  assert.equal(submit.headers.Authorization, `Key ${KEY}`);
  // flux dev takes neither negative_prompt nor image_urls, so neither is sent.
  assert.deepEqual(submit.body, { prompt: 'a bakery at dawn', image_size: { width: 1920, height: 1080 } });
  assert.equal(JSON.stringify(job).includes('signal'), false);
  const out = await fal.fetch(job, dir);
  assert.equal(out.file, path.join(dir, 'req-1.png'));
  assert.equal(await readFile(out.file, 'utf8'), 'bytes of /files/a/img.png');
  assert.equal(out.seed, 7);
  assert.equal(out.model, 'fal-ai/flux/dev');
  assert.equal(out.licence, 'see provider terms: https://fal.ai/models/fal-ai/flux/dev');
  // The key goes to fal's API, never to the media CDN.
  assert.equal(mock.requests.find((r) => r.url.startsWith('https://v3.fal.media')).headers, undefined);
});

test('video step: start frame inline, padded duration rounded to the model enum, aspect and negative where taken', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const mock = mockFal({ license: 'commercial' });
  const fal = provider(mock);
  await assert.rejects(fal.submit(BRIEF, 'video', 'final'), /needs a startFrame/);
  const { job, status } = await run(fal, 'video', { startFrame: PNG });
  assert.equal(status.state, 'done');
  const { body } = mock.requests.find((r) => r.method === 'POST');
  assert.equal(body.prompt, 'slow push in');
  assert.match(body.image_url, /^data:image\/png;base64,/);
  assert.equal(body.duration, '6s'); // 4 s + 0.5 s each end = 5 s → 6s
  assert.equal(body.aspect_ratio, '16:9');
  assert.equal(body.negative_prompt, 'no text');
  const out = await fal.fetch(job, dir);
  assert.equal(path.basename(out.file), 'req-1.mp4');
  assert.equal(out.seed, undefined);
  assert.equal(out.licence, 'commercial (fal metadata); see provider terms: https://fal.ai/models/fal-ai/veo3.1/image-to-video');
});

test('draft tier uses draftVideoModel', async () => {
  const mock = mockFal();
  const fal = provider(mock, { draftVideoModel: 'fal-ai/kling-video/o3/standard/image-to-video' });
  await fal.submit(BRIEF, 'video', 'draft', { startFrame: PNG });
  const submit = mock.requests.find((r) => r.method === 'POST');
  assert.equal(submit.url, 'https://queue.fal.run/fal-ai/kling-video/o3/standard/image-to-video');
  assert.equal(submit.body.duration, '5'); // no schema: whole seconds
});

test('quote reads fal pricing; unknown unit or no price is null', async () => {
  const mock = mockFal({ prices: { 'fal-ai/flux/dev': { unit: 'megapixels', unit_price: 0.02 }, 'fal-ai/veo3.1/image-to-video': { unit: 'seconds', unit_price: 0.1 } } });
  const fal = provider(mock);
  assert.deepEqual(await fal.quote(BRIEF, 'image', 'final'), { amount: 0.02 * 1920 * 1080 / 1e6, unit: 'usd' });
  const video = await fal.quote(BRIEF, 'video', 'final');
  assert.equal(video.unit, 'usd');
  assert.ok(Math.abs(video.amount - 0.6) < 1e-9); // billed on the 6s the model will make
  assert.deepEqual(await provider(mockFal()).quote(BRIEF, 'image', 'final'), { amount: null, unit: 'usd' });
  const odd = provider(mockFal({ prices: { 'fal-ai/flux/dev': { unit: 'compute', unit_price: 1 } } }));
  assert.deepEqual(await odd.quote(BRIEF, 'image', 'final'), { amount: null, unit: 'usd' });
});

test('missing FAL_KEY is a clear error and nothing is sent', async () => {
  const mock = mockFal();
  const fal = provider(mock, { env: {} });
  await assert.rejects(fal.submit(BRIEF, 'image', 'final'), /FAL_KEY is not set/);
  await assert.rejects(fal.quote(BRIEF, 'image', 'final'), /FAL_KEY is not set/);
  assert.equal(mock.requests.length, 0);
  assert.throws(() => createFalProvider({ fetch: mock.fetch }), /name a model/);
});

test('a failed job reports its error; errors never carry the key', async () => {
  const fal = provider(mockFal({ error: 'out of memory' }));
  const { status } = await run(fal, 'image');
  assert.deepEqual(status, { state: 'failed', error: 'runner_server_error: out of memory' });
  const denied = createFalProvider({ imageModel: 'fal-ai/flux/dev', env: { FAL_KEY: KEY },
    fetch: async () => ({ ok: false, status: 401, text: async () => 'unauthorized', json: async () => ({}) }) });
  const error = await denied.submit(BRIEF, 'image', 'final').catch((e) => e);
  assert.match(error.message, /401/);
  assert.equal(error.message.includes(KEY), false);
});

test('abort signal: refused before submit, cancels the job once aborted', async () => {
  const before = new AbortController();
  before.abort();
  const mock = mockFal();
  const fal = provider(mock);
  await assert.rejects(fal.submit(BRIEF, 'image', 'final', { signal: before.signal }), { name: 'AbortError' });
  assert.equal(mock.requests.length, 0);
  const controller = new AbortController();
  const job = await fal.submit(BRIEF, 'image', 'final', { signal: controller.signal });
  assert.equal(mock.requests.find((r) => r.method === 'POST').signal, controller.signal);
  controller.abort();
  assert.deepEqual(await fal.poll(job), { state: 'failed', error: 'aborted' });
  assert.equal(mock.requests.at(-1).method, 'PUT');
  assert.equal(mock.requests.at(-1).url, 'https://queue.fal.run/fal-ai/flux/requests/req-1/cancel');
});

test('pickDuration keeps the model spelling and caps at the longest', () => {
  assert.equal(pickDuration(5, ['4s', '6s', '8s']), '6s');
  assert.equal(pickDuration(12, ['5', '10']), '10');
  assert.equal(pickDuration(4.2), '5');
});

test('fake provider: deterministic files for both steps, scripted failure', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fake-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fake = createFakeProvider({ price: 0.05, fail: ['video'], pollsUntilDone: 2 });
  assert.deepEqual(await fake.quote(BRIEF, 'image', 'draft'), { amount: 0.05, unit: 'usd' });
  const image = await fake.submit(BRIEF, 'image', 'draft');
  assert.equal((await fake.poll(image)).state, 'queued');
  assert.equal((await fake.poll(image)).state, 'done');
  const still = await fake.fetch(image, dir);
  assert.equal(path.extname(still.file), '.png');
  assert.deepEqual(await readFile(still.file), await readFile(PNG));
  const video = await fake.submit(BRIEF, 'video', 'draft', { startFrame: still.file });
  await fake.poll(video);
  assert.equal((await fake.poll(video)).state, 'failed');
  assert.equal(path.extname((await fake.fetch(video, dir)).file), '.mp4');
});

test('image step: a model that takes only aspect_ratio gets the brief\'s ratio, not image_size', async () => {
  const mock = mockFal();
  const fal = provider(mock, { imageModel: 'fal-ai/nano-banana' });
  await run(fal, 'image');
  const submit = mock.requests.find((r) => r.method === 'POST');
  assert.equal(submit.body.aspect_ratio, '16:9');
  assert.equal(submit.body.image_size, undefined);
});
