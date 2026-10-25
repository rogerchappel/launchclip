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
// references/storyboard-modules.md, subject-effects.md and direction-map.md are
// generated from kit/core/planning-prompt.mjs, long-form.md from
// kit/core/long-form.mjs, and profiles.md from the shipped
// profiles in kit/profiles/ (GENERATED_REFERENCES), into skills-src/references/
// and both skills.
//
// The renderer-neutral scripts are maintained in
// skills/launchclip-create-video/scripts/ and copied into the Remotion skill.
// kit/core/*.mjs (and kit/core/<folder>/*.mjs) is canonical for its files and
// is copied into both skills.
// kit/hyperframes/*.mjs (the HyperFrames emitters, including
// editorial-ui-modules.mjs, and the story compiler) is canonical too: both
// skills get copies whose ../core/ imports are rewritten to ./.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { directionMapReference, profilesReference, storyboardModulesReference, subjectEffectsReference } from '../kit/core/planning-prompt.mjs';
import { shippedProfiles } from '../src/profile_store.js';
import { longFormReference } from '../kit/core/long-form.mjs';
import { usageMarkdown } from '../src/cli_usage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'skills-src');
const RENDERERS = ['hyperframes', 'remotion'];

const SHARED_REFERENCES = [
  'cinematic-production.md',
  'demo-setup.md',
  'editorial-ui-modules.md',
  'finishing-in-an-nle.md',
  'recorded-treatment-check.md',
  'recorded-video.md',
  'sfx-library.md',
  'shorts-delivery.md',
  'workflow.md'
];

// References generated from code rather than written by hand. Each is written
// to skills-src/references/ (so the source tree shows it) and into both
// skills; --check fails when either copy drifts from the generator. The
// generator always reads this checkout's kit/core registry.
export const GENERATED_REFERENCES = {
  'storyboard-modules.md': storyboardModulesReference,
  'subject-effects.md': subjectEffectsReference,
  'direction-map.md': directionMapReference,
  'long-form.md': longFormReference,
  'profiles.md': () => profilesReference(shippedProfiles())
};

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

// Skill file name of a kit/hyperframes file. Skills keep kit/core and
// kit/hyperframes side by side in scripts/, so a HyperFrames file whose name
// is also a kit/core file (catalog-a.mjs) ships as hyperframes-<name>.
export function hyperframesSkillName(file, kitCore) {
  return kitCore.includes(file) ? `hyperframes-${file}` : file;
}

// A kit/hyperframes file as shipped in a skill's scripts/: imports of
// ../core/<file> point at the sibling copies of kit/core, and imports of a
// renamed sibling (./catalog-a.mjs) follow the rename.
export function hyperframesCopy(root, file, kitCore = []) {
  const source = readFileSync(path.join(root, 'kit/hyperframes', file), 'utf8')
    .replace(/(['"])\.\/([A-Za-z0-9_.-]+\.mjs)\1/g, (match, quote, name) => `${quote}./${hyperframesSkillName(name, kitCore)}${quote}`);
  return source.replace(/(['"])\.\.\/core\//g, '$1./');
}

// → { files: Map<repo-relative path, Buffer|string>, managedDirs: repo-relative dirs owned wholesale }
export function planOutputs({ root = ROOT } = {}) {
  const srcRoot = path.join(root, 'skills-src');
  const files = new Map();
  const managedDirs = [];
  // kit/core/*.mjs plus its subfolders of modules (kit/core/characters/),
  // copied with their folder so relative imports keep working.
  const kitCore = listFiles(path.join(root, 'kit/core')).filter((file) => file.endsWith('.mjs') && file.split(path.sep).length <= 2).map((file) => file.split(path.sep).join('/'));
  const kitRemotion = listFiles(path.join(root, 'kit/remotion'));
  const kitHyperframes = listFiles(path.join(root, 'kit/hyperframes')).filter((file) => !file.includes(path.sep) && file.endsWith('.mjs'));
  const hyperframesScripts = path.join(root, 'skills/launchclip-create-video/scripts');
  const generated = Object.entries(GENERATED_REFERENCES).map(([name, build]) => [name, build()]);
  for (const [name, content] of generated) files.set(`skills-src/references/${name}`, content);

  for (const skill of SKILLS) {
    const dir = `skills/${skill.name}`;
    const render = (relative) => renderTemplate(relative, skill.renderer, { srcRoot });
    files.set(`${dir}/SKILL.md`, render('SKILL.md'));
    files.set(`${dir}/agents/openai.yaml`, render(`agents/${skill.renderer}/openai.yaml`));
    managedDirs.push(`${dir}/references`, `${dir}/agents`);
    // A reference that includes SKILL.md sections (workflow.md) links its
    // siblings directly, not through references/.
    for (const reference of skill.references) files.set(`${dir}/references/${reference}`, render(`references/${reference}`).replaceAll('](references/', ']('));
    for (const [name, content] of generated) files.set(`${dir}/references/${name}`, content);
    if (skill.sharedScripts) {
      managedDirs.push(`${dir}/scripts`);
      for (const script of SHARED_SCRIPTS) files.set(`${dir}/scripts/${script}`, readFileSync(path.join(hyperframesScripts, script)));
    }
    for (const file of kitCore) {
      if (SHARED_SCRIPTS.includes(file)) throw new Error(`kit/core/${file} collides with a shared skill script`);
      files.set(`${dir}/scripts/${file}`, readFileSync(path.join(root, 'kit/core', file)));
    }
    // kit/hyperframes is canonical for the HyperFrames emitters and the story
    // compiler (including editorial-ui-modules.mjs, which therefore overrides
    // the shared-script copy). Skills keep core beside them in scripts/.
    for (const file of kitHyperframes) {
      const name = hyperframesSkillName(file, kitCore);
      if (name !== file && kitHyperframes.includes(name)) throw new Error(`kit/hyperframes/${name} collides with the skill copy of kit/hyperframes/${file}`);
      files.set(`${dir}/scripts/${name}`, hyperframesCopy(root, file, kitCore));
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
  // The CLI reference's "Command usage" section is generated from the usage
  // table behind every `launchclip <command> --help` (src/cli_usage.js).
  const cliReference = 'skills/launchclip-cli/references/cli-reference.md';
  if (existsSync(path.join(root, cliReference))) files.set(cliReference, withUsageSection(readFileSync(path.join(root, cliReference), 'utf8')));
  return { files, managedDirs };
}

export const USAGE_START = '<!-- usage:start -->';
export const USAGE_END = '<!-- usage:end -->';

/** The CLI reference with its generated usage block replaced (or appended as "## Command usage"). */
export function withUsageSection(text) {
  const block = `${USAGE_START}\n${usageMarkdown()}${USAGE_END}`;
  const start = text.indexOf(USAGE_START), end = text.indexOf(USAGE_END);
  if (start >= 0 && end > start) return `${text.slice(0, start)}${block}${text.slice(end + USAGE_END.length)}`;
  return `${text.trimEnd()}\n\n## Command usage\n\n${block}\n`;
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
