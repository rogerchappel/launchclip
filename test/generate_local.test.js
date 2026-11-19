// The local provider (src/generate/providers/local.js) against a stubbed
// ComfyUI server: no network, no ComfyUI, no model weights.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProviders } from '../src/generate/generator.js';
import { createLocalProvider, fill } from '../src/generate/providers/local.js';

const PNG = path.resolve('test/fixtures/parity/assets/testsrc.png');
const BRIEF = {
  id: 's3', kind: 'footage', steps: ['image', 'video'],
  image: { prompt: 'a bakery at dawn', negative: 'no text', width: 1280, height: 704 },
  video: { prompt: 'slow push in', seconds: 4, pad_seconds: 0.5, fps: 30 },
  brief_hash: 'sha256:abc'
};
const IMAGE_WORKFLOW = {
  launchclip: { model: 'FLUX.1 [schnell]', licence: 'apache-2.0 (model card)', seconds_per_image: 20 },
  6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
  3: { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: 4 } },
  9: { class_type: 'SaveImage', inputs: { filename_prefix: 'launchclip' } }
};
const VIDEO_WORKFLOW = {
  launchclip: { model: 'Wan2.2-TI2V-5B', licence: 'apache-2.0 (model card)', seconds_per_second: 600, fps: 24 },
  56: { class_type: 'LoadImage', inputs: { image: '{{start_frame}}' } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
  55: { class_type: 'Wan22ImageToVideoLatent', inputs: { width: '{{width}}', height: '{{height}}', length: '{{frames}}' } },
  58: { class_type: 'SaveVideo', inputs: { filename_prefix: 'video/launchclip' } }
};

async function workdir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lc-local-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'image.json'), JSON.stringify(IMAGE_WORKFLOW));
  await writeFile(path.join(dir, 'video.json'), JSON.stringify(VIDEO_WORKFLOW));
  return dir;
}

// A ComfyUI stand-in: /prompt queues, /history answers after `runningPolls` empty polls.
function mockComfy({ runningPolls = 1, error = null, down = false } = {}) {
  const requests = [];
  const polls = new Map();
  let next = 0;
  const prompts = new Map();
  const fetch = async (url, init = {}) => {
    if (down) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const u = new URL(url);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    requests.push({ method: init.method ?? 'GET', path: u.pathname, query: u.searchParams, body });
    const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value, text: async () => JSON.stringify(value) });
    if (u.pathname === '/prompt') {
      const id = `p${++next}`;
      prompts.set(id, body.prompt);
      return json({ prompt_id: id, number: next, node_errors: {} });
    }
    if (u.pathname === '/upload/image') return json({ name: body.get('image').name, subfolder: '', type: 'input' });
    if (u.pathname.startsWith('/history/')) {
      const id = u.pathname.split('/').pop();
      const count = (polls.get(id) ?? 0) + 1;
      polls.set(id, count);
      if (count <= runningPolls) return json({});
      if (error) return json({ [id]: { outputs: {}, status: { status_str: 'error', completed: false, messages: [['execution_error', { node_type: 'KSampler', exception_message: 'MPS backend out of memory' }]] } } });
      const isVideo = Object.values(prompts.get(id)).some((node) => node.class_type === 'SaveVideo');
      const outputs = isVideo
        ? { 58: { images: [{ filename: 'launchclip_00001_.mp4', subfolder: 'video', type: 'output' }], animated: [true] } }
        : { 9: { images: [{ filename: 'launchclip_00001_.png', subfolder: '', type: 'output' }] } };
      return json({ [id]: { outputs, status: { status_str: 'success', completed: true, messages: [] } } });
    }
    if (u.pathname === '/view') return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`bytes of ${u.searchParams.get('filename')}`).buffer };
    if (u.pathname === '/queue' && init.method === 'POST') return json({});
    if (u.pathname === '/queue') return json({ queue_running: [[0, 'p1']], queue_pending: [] });
    if (u.pathname === '/interrupt') return json({});
    throw new Error(`unexpected ${init.method ?? 'GET'} ${url}`);
  };
  return { fetch, requests, prompts };
}

async function run(provider, step, out, opts) {
  const job = await provider.submit(BRIEF, step, 'final', opts);
  let state;
  do state = await provider.poll(job); while (state.state === 'running');
  assert.equal(state.state, 'done', state.error);
  return provider.fetch(job, out);
}

test('local: quote in seconds, then submit → poll → fetch for the keyframe and the video', async (t) => {
  const dir = await workdir(t);
  const comfy = mockComfy({ runningPolls: 2 });
  const local = createLocalProvider({ imageModel: 'image.json', videoModel: 'video.json', cwd: dir, fetch: comfy.fetch, env: { COMFYUI_URL: 'http://studio.local:8188/' } });
  assert.deepEqual(local.steps, ['image', 'video']);
  assert.deepEqual(await local.quote(BRIEF, 'image', 'final'), { amount: 20, unit: 'seconds' });
  assert.deepEqual(await local.quote(BRIEF, 'video', 'final'), { amount: 3000, unit: 'seconds' }, '600 s per second × (4 + 2 × 0.5) s');

  const still = await run(local, 'image', path.join(dir, 'out'));
  assert.equal(path.extname(still.file), '.png');
  assert.equal(await readFile(still.file, 'utf8'), 'bytes of launchclip_00001_.png');
  assert.equal(still.model, 'FLUX.1 [schnell]');
  assert.equal(still.licence, 'apache-2.0 (model card)');
  assert.equal(still.cost.unit, 'seconds');
  const sent = comfy.prompts.get('p1');
  assert.equal(sent.launchclip, undefined, 'the launchclip block is not sent');
  assert.equal(sent[6].inputs.text, 'a bakery at dawn');
  assert.equal(sent[5].inputs.width, 1280, 'a placeholder becomes a number');
  assert.equal(sent[3].inputs.seed, still.seed);

  const clip = await run(local, 'video', path.join(dir, 'out'), { startFrame: PNG });
  assert.equal(path.extname(clip.file), '.mp4');
  assert.equal(clip.model, 'Wan2.2-TI2V-5B');
  const video = comfy.prompts.get('p2');
  assert.equal(video[56].inputs.image, 'launchclip-testsrc.png', 'the start frame is uploaded and named');
  assert.equal(video[6].inputs.text, 'slow push in');
  assert.equal(video[55].inputs.length, 121, '5 s at the workflow\'s 24 fps, as 4n + 1 frames');
  const view = comfy.requests.find((r) => r.path === '/view' && r.query.get('filename').endsWith('.mp4'));
  assert.equal(view.query.get('subfolder'), 'video');
  assert.ok(comfy.requests.every((r) => r.path), 'COMFYUI_URL is used');
});

test('local: ComfyUI not running is a clear error naming the address', async (t) => {
  const dir = await workdir(t);
  const local = createLocalProvider({ imageModel: 'image.json', cwd: dir, fetch: mockComfy({ down: true }).fetch, env: {} });
  await assert.rejects(local.submit(BRIEF, 'image', 'final'), /ComfyUI is not answering at http:\/\/127\.0\.0\.1:8188 \(ECONNREFUSED\).*COMFYUI_URL/);
});

test('local: a failed run reports the node error; abort drops the job and interrupts it', async (t) => {
  const dir = await workdir(t);
  const failing = createLocalProvider({ imageModel: 'image.json', cwd: dir, fetch: mockComfy({ runningPolls: 0, error: true }).fetch, env: {} });
  const job = await failing.submit(BRIEF, 'image', 'final');
  assert.deepEqual(await failing.poll(job), { state: 'failed', error: 'KSampler: MPS backend out of memory' });

  const comfy = mockComfy({ runningPolls: 99 });
  const local = createLocalProvider({ imageModel: 'image.json', cwd: dir, fetch: comfy.fetch, env: {} });
  const controller = new AbortController();
  const running = await local.submit(BRIEF, 'image', 'final', { signal: controller.signal });
  assert.equal((await local.poll(running)).state, 'running');
  controller.abort();
  assert.deepEqual(await local.poll(running), { state: 'failed', error: 'aborted' });
  assert.ok(comfy.requests.some((r) => r.path === '/queue' && r.method === 'POST' && r.body.delete[0] === 'p1'));
  assert.ok(comfy.requests.some((r) => r.path === '/interrupt'));
  await assert.rejects(local.submit(BRIEF, 'image', 'final', { signal: controller.signal }), { name: 'AbortError' });
});

test('local: a workflow without a model and licence, or not in API format, is refused', async (t) => {
  const dir = await workdir(t);
  await writeFile(path.join(dir, 'bare.json'), JSON.stringify({ 3: { class_type: 'KSampler', inputs: {} } }));
  await writeFile(path.join(dir, 'ui.json'), JSON.stringify({ launchclip: { model: 'x', licence: 'y' }, nodes: [], links: [] }));
  const quote = (file) => createLocalProvider({ imageModel: file, cwd: dir, fetch: mockComfy().fetch, env: {} }).quote(BRIEF, 'image', 'final');
  await assert.rejects(quote('bare.json'), /needs a "launchclip".*licence copied from the model card/);
  await assert.rejects(quote('ui.json'), /not a ComfyUI API-format workflow/);
  const unrated = { ...IMAGE_WORKFLOW, launchclip: { model: 'x', licence: 'y' } };
  await writeFile(path.join(dir, 'unrated.json'), JSON.stringify(unrated));
  assert.deepEqual(await quote('unrated.json'), { amount: null, unit: 'seconds' });
});

test('local: placeholders fill only exact matches; --generate local:<workflow> builds it', async (t) => {
  assert.deepEqual(fill({ a: '{{width}}', b: 'x {{width}}', c: ['{{other}}'], d: 3 }, { width: 640 }), { a: 640, b: 'x {{width}}', c: ['{{other}}'], d: 3 });
  const dir = await workdir(t);
  const providers = await createProviders({ image: { provider: 'local', model: 'image.json' }, video: { provider: 'local', model: 'video.json' } }, { env: {}, cwd: dir, fetch: mockComfy().fetch });
  assert.equal(providers.image, providers.video);
  assert.equal(providers.image.id, 'local');
});

test('local: the shipped example workflows load and fill', async () => {
  for (const name of ['flux-schnell.json', 'wan22-ti2v-5b.json']) {
    const local = createLocalProvider({ imageModel: name, cwd: path.resolve('docs/comfyui'), fetch: mockComfy().fetch, env: {} });
    assert.equal((await local.quote(BRIEF, 'image', 'final')).unit, 'seconds', name);
  }
});
