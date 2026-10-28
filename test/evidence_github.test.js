// GitHub evidence helper (src/evidence/github.js): reference parsing, the
// cache, rate-limit errors, patch excerpts, and the mapping from real API
// responses (test/fixtures/github, trimmed copies of rogerchappel/launchclip
// PR #82 and commit c3ec4a11) straight into module params that resolve.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {commitCardParams, diffViewParams, githubEvidence, githubGet, parseGithubRef, patchExcerpt, prCardParams, sourceParams} from '../src/evidence/github.js';
import {MODULES} from '@launchclip/core/catalog-h.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/github/', import.meta.url));
const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const resolve = (id, params) => MODULES[id].resolve(params, {id: 'scene', start: 0, duration: 8, format: {width: 1920, height: 1080, fps: 30}, brand, aspect: '16:9', hits: []});
const fixture = async name => JSON.parse(await readFile(path.join(FIXTURES, name), 'utf8')).data;

async function project() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'launchclip-github-'));
  await cp(FIXTURES, path.join(dir, 'assets', 'evidence'), {recursive: true});
  return dir;
}

const offline = () => { throw new Error('no network in tests'); };

test('parseGithubRef reads URLs and short forms', () => {
  assert.deepEqual(parseGithubRef('https://github.com/rogerchappel/launchclip/pull/88/files'), {repo: 'rogerchappel/launchclip', kind: 'pull', number: 88});
  assert.deepEqual(parseGithubRef('rogerchappel/launchclip#82'), {repo: 'rogerchappel/launchclip', kind: 'pull', number: 82});
  assert.deepEqual(parseGithubRef('github.com/rogerchappel/launchclip/commit/C3EC4A11'), {repo: 'rogerchappel/launchclip', kind: 'commit', sha: 'c3ec4a11'});
  assert.deepEqual(parseGithubRef('rogerchappel/launchclip@c3ec4a11'), {repo: 'rogerchappel/launchclip', kind: 'commit', sha: 'c3ec4a11'});
  assert.throws(() => parseGithubRef('https://example.com/x'), /not a GitHub pull request or commit/);
});

test('githubGet caches responses and explains the rate limit', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'launchclip-github-'));
  try {
    let calls = 0;
    const fetch = async url => { calls++; return {ok: true, status: 200, headers: new Map([['x-ratelimit-remaining', '3']]), json: async () => ({url})}; };
    const warnings = [];
    const first = await githubGet('/repos/a/b/pulls/1', 'github-a-b-pull-1.json', {dir, fetch, onWarn: w => warnings.push(w)});
    const again = await githubGet('/repos/a/b/pulls/1', 'github-a-b-pull-1.json', {dir, fetch});
    assert.deepEqual(first, again);
    assert.equal(calls, 1, 'the second read comes from assets/evidence');
    assert.match(warnings[0], /3 requests left/);
    const cached = JSON.parse(await readFile(path.join(dir, 'assets', 'evidence', 'github-a-b-pull-1.json'), 'utf8'));
    assert.equal(cached.url, 'https://api.github.com/repos/a/b/pulls/1');
    const limited = async () => ({ok: false, status: 403, statusText: 'Forbidden', headers: new Map([['x-ratelimit-remaining', '0'], ['x-ratelimit-reset', '1800000000']])});
    await assert.rejects(githubGet('/repos/a/b/pulls/2', 'x.json', {dir, fetch: limited, githubToken: ''}), /rate limit reached .* resets at 2027-01-15T08:00:00.000Z/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('patchExcerpt keeps two rows above the anchor (its removed line among them) and numbers the window', () => {
  const patch = '@@ -10,6 +10,6 @@ x\n a\n b\n c\n-model: sol\n+model: terra\n d';
  assert.deepEqual(patchExcerpt(patch, {token: 'terra', max: 4}), {lines: [' c', '-model: sol', '+model: terra', ' d'], start: {old: 12, new: 12}, anchor: 2});
  assert.equal(patchExcerpt(patch, {token: 'nowhere'}), null);
});

test('a real PR maps to repo-pr-card params that resolve', async () => {
  const pull = await fixture('github-rogerchappel-launchclip-pull-82.json');
  const files = await fixture('github-rogerchappel-launchclip-pull-82-files.json');
  const params = prCardParams({pull, files}, {token: 'openrouter/free'});
  assert.equal(params.repo, 'rogerchappel/launchclip');
  assert.equal(params.number, 82);
  assert.equal(params.state, 'merged');
  assert.equal(params.date, '2026-07-16');
  assert.equal(params.file, 'src/model_provider.js');
  assert.ok(params.lines.some(line => line.startsWith('+') && line.includes('openrouter/free')));
  const model = resolve('repo-pr-card', params);
  assert.equal(model.content.card.code.tokens.length, 1);
  // As an evidence-chain source, trimmed to the rows round the token.
  const source = sourceParams('pr', params, {lines: 2});
  assert.equal(source.kind, 'pr');
  assert.equal(source.lines.length, 2);
  assert.ok(resolve('evidence-chain', {sources: [source, {...source, number: 83}]}).content.cards.length === 2);
});

test('a real commit maps to commit-card and diff-view params that resolve', async () => {
  const commit = await fixture('github-rogerchappel-launchclip-commit-c3ec4a11.json');
  const params = commitCardParams(commit, {token: 'gpt-5.5', repo: 'rogerchappel/launchclip'});
  assert.equal(params.message, 'direct: default OpenAI model to gpt-5.5');
  assert.deepEqual(params.authors, ['rogerchappel', 'Claude Fable 5']);
  assert.equal(params.sha, 'c3ec4a1198b8');
  assert.equal(params.verified, false);
  assert.equal(params.file, 'src/director.js');
  assert.ok(resolve('commit-card', params).content.card.code.tokens.length === 1);
  const diff = diffViewParams(commit.files, {token: 'gpt-5.5'});
  assert.ok(diff.focus.length >= 1);
  assert.ok(resolve('diff-view', diff).content.focus.length === diff.focus.length);
  assert.throws(() => commitCardParams(commit, {token: 'gpt-9'}), /no file in this change contains "gpt-9"/);
});

test('githubEvidence reads the cache under assets/evidence without the network', async () => {
  const dir = await project();
  try {
    const pr = await githubEvidence('https://github.com/rogerchappel/launchclip/pull/82', {dir, fetch: offline, avatars: false, token: 'openrouter/free'});
    assert.equal(pr.module, 'repo-pr-card');
    assert.equal(pr.params.author, 'rogerchappel');
    const commit = await githubEvidence('rogerchappel/launchclip@c3ec4a11', {dir, fetch: offline, avatars: false, module: 'source', token: 'gpt-5.5'});
    assert.equal(commit.params.kind, 'commit');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
