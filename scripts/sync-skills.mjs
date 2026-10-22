#!/usr/bin/env node
// Generate the two create-video entry skills from the shared sources in
// skills-src/.
//
//   node scripts/sync-skills.mjs           write every generated file
//   node scripts/sync-skills.mjs --check   exit 1 when anything would change
//
// Template syntax (each directive sits alone on its own line, and the
// directive line itself never reaches the output):
//
//   <!-- include: shared/intake.md -->        insert another source file;
//                                             "{renderer}" in the path is
//                                             replaced by the skill's renderer
//   <!-- renderer: hyperframes -->            keep the lines up to the closing
//   ...                                       marker only for that renderer;
//   <!-- /renderer -->                        "a|b" lists several renderers
//
// Includes may nest; renderer blocks may not. Every source ends with a newline,
// so an included file replaces its include line exactly.
//
// Outputs:
//   skills/launchclip-create-video/            HyperFrames (SKILL.md, references/,
//                                              agents/, plus kit/core copies in scripts/)
//   skills/launchclip-create-video-remotion/   Remotion (fully generated: SKILL.md,
//                                              references/, agents/, scripts/,
//                                              assets/remotion-kit/ and assets/core/)
//
// The renderer-neutral scripts are maintained in
// skills/launchclip-create-video/scripts/ and copied into the Remotion skill.
// kit/core/*.mjs is canonical for its files and is copied into both skills.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'skills-src');
const RENDERERS = ['hyperframes', 'remotion'];

const SHARED_REFERENCES = [
  'cinematic-production.md',
  'editorial-ui-modules.md',
  'recorded-treatment-check.md',
  'recorded-video.md',
  'shorts-delivery.md'
];

// Renderer-neutral scripts, maintained in the HyperFrames skill.
export const SHARED_SCRIPTS = [
  'build-evidence.mjs',
  'build-mix.mjs',
  'check-recorded-treatment.mjs',
  'editorial-ui-modules.mjs',
  'master-loudness.mjs',
  'synth-audio-kit.mjs',
  'word-captions.mjs'
];

export const SKILLS = [
  {
    name: 'launchclip-create-video',
    renderer: 'hyperframes',
    references: [...SHARED_REFERENCES, 'standalone-hyperframes.md'],
    sharedScripts: false,
    remotionKit: false
  },
  {
    name: 'launchclip-create-video-remotion',
    renderer: 'remotion',
    references: [...SHARED_REFERENCES, 'standalone-remotion.md'],
    sharedScripts: true,
    remotionKit: true
  }
];

const INCLUDE = /^<!-- include: (\S+) -->$/;
const BLOCK_OPEN = /^<!-- renderer: ([a-z|]+) -->$/;
const BLOCK_CLOSE = /^<!-- \/renderer -->$/;

export function renderTemplate(relativePath, renderer, { srcRoot = SRC, stack = [] } = {}) {
  if (!RENDERERS.includes(renderer)) throw new Error(`unknown renderer: ${renderer}`);
  const resolved = relativePath.replaceAll('{renderer}', renderer);
  if (stack.includes(resolved)) throw new Error(`include cycle: ${[...stack, resolved].join(' -> ')}`);
  const file = path.join(srcRoot, resolved);
  if (!existsSync(file)) throw new Error(`missing source ${resolved}${stack.length ? ` (included from ${stack.at(-1)})` : ''}`);
  const source = readFileSync(file, 'utf8');
  if (source.length && !source.endsWith('\n')) throw new Error(`${resolved} must end with a newline`);
  const lines = source.split('\n');
  lines.pop();
  let out = '';
  let block = null;
  lines.forEach((line, index) => {
    const where = `${resolved}:${index + 1}`;
    const open = line.match(BLOCK_OPEN);
    if (open) {
      if (block) throw new Error(`${where}: renderer blocks cannot nest`);
      const names = open[1].split('|');
      for (const name of names) if (!RENDERERS.includes(name)) throw new Error(`${where}: unknown renderer "${name}"`);
      block = { keep: names.includes(renderer), line: index + 1 };
      return;
    }
    if (BLOCK_CLOSE.test(line)) {
      if (!block) throw new Error(`${where}: closing marker without an open renderer block`);
      block = null;
      return;
    }
    if (block && !block.keep) return;
    const include = line.match(INCLUDE);
    if (include) {
      out += renderTemplate(include[1], renderer, { srcRoot, stack: [...stack, resolved] });
      return;
    }
    if (/<!-- (include|renderer|\/renderer)\b/.test(line)) throw new Error(`${where}: malformed directive "${line.trim()}"`);
    out += `${line}\n`;
  });
  if (block) throw new Error(`${resolved}:${block.line}: renderer block is never closed`);
  return out;
}

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, base));
    else if (entry.isFile()) files.push(path.relative(base, full));
  }
  return files;
}

// → { files: Map<repo-relative path, Buffer|string>, managedDirs: repo-relative dirs owned wholesale }
export function planOutputs({ root = ROOT } = {}) {
  const srcRoot = path.join(root, 'skills-src');
  const files = new Map();
  const managedDirs = [];
  const kitCore = listFiles(path.join(root, 'kit/core')).filter((file) => !file.includes(path.sep) && file.endsWith('.mjs'));
  const kitRemotion = listFiles(path.join(root, 'kit/remotion'));
  const hyperframesScripts = path.join(root, 'skills/launchclip-create-video/scripts');

  for (const skill of SKILLS) {
    const dir = `skills/${skill.name}`;
    const render = (relative) => renderTemplate(relative, skill.renderer, { srcRoot });
    files.set(`${dir}/SKILL.md`, render('SKILL.md'));
    files.set(`${dir}/agents/openai.yaml`, render(`agents/${skill.renderer}/openai.yaml`));
    managedDirs.push(`${dir}/references`, `${dir}/agents`);
    for (const reference of skill.references) files.set(`${dir}/references/${reference}`, render(`references/${reference}`));
    if (skill.sharedScripts) {
      managedDirs.push(`${dir}/scripts`);
      for (const script of SHARED_SCRIPTS) files.set(`${dir}/scripts/${script}`, readFileSync(path.join(hyperframesScripts, script)));
    }
    for (const file of kitCore) {
      if (SHARED_SCRIPTS.includes(file)) throw new Error(`kit/core/${file} collides with a shared skill script`);
      files.set(`${dir}/scripts/${file}`, readFileSync(path.join(root, 'kit/core', file)));
    }
    if (skill.remotionKit) {
      managedDirs.push(`${dir}/assets`);
      for (const file of kitRemotion) {
        files.set(`${dir}/assets/remotion-kit/${file.split(path.sep).join('/')}`, readFileSync(path.join(root, 'kit/remotion', file)));
      }
      // The TSX imports ../core/*.mjs, so ship core beside it: a project copies
      // assets/remotion-kit → kit/remotion and assets/core → kit/core.
      if (kitRemotion.length) {
        for (const file of kitCore) files.set(`${dir}/assets/core/${file}`, readFileSync(path.join(root, 'kit/core', file)));
      }
    }
  }
  return { files, managedDirs };
}

// → { changed: [{path, action: "write"|"delete"}] }
export function syncSkills({ root = ROOT, check = false } = {}) {
  const { files, managedDirs } = planOutputs({ root });
  const changed = [];
  for (const [relative, content] of files) {
    const target = path.join(root, relative);
    const next = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    if (existsSync(target) && statSync(target).isFile() && readFileSync(target).equals(next)) continue;
    changed.push({ path: relative, action: 'write' });
    if (!check) {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, next);
    }
  }
  for (const dir of managedDirs) {
    for (const file of listFiles(path.join(root, dir))) {
      const relative = `${dir}/${file.split(path.sep).join('/')}`;
      if (files.has(relative)) continue;
      changed.push({ path: relative, action: 'delete' });
      if (!check) rmSync(path.join(root, relative));
    }
  }
  return { changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  try {
    const { changed } = syncSkills({ check });
    if (check) {
      if (changed.length) {
        console.error(`skills are out of date with skills-src/ (run npm run skills:sync):`);
        for (const entry of changed) console.error(`  ${entry.action} ${entry.path}`);
        process.exit(1);
      }
      console.log('skills are in sync with skills-src/');
    } else {
      for (const entry of changed) console.log(`${entry.action} ${entry.path}`);
      console.log(changed.length ? `updated ${changed.length} file(s)` : 'skills already in sync');
    }
  } catch (error) {
    console.error(`sync-skills: ${error.message}`);
    process.exit(2);
  }
}
