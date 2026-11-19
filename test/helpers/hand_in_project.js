// A character story with a frozen show bible for the hand-in and story-generation
// tests: test/fixtures/animation-first-run, its cast frozen into a bible with
// test/fixtures/generate-story/BIBLE.json's world and rules, sheets on disk,
// and (animatic: true) an ANIMATIC.json naming every shot.
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bibleCharacter, bibleHash, withBible } from "@launchclip/core/bible.mjs";
import { resolveStoryCast } from "@launchclip/core/characters/cues.mjs";
import { ANIMATIC_SCHEMA, animaticInputs } from "../../src/animatic.js";
import { readProjectStory } from "../../src/story_loader.js";
import { storyShotsCommand } from "../../src/story_shots.js";

const FIXTURES = new URL("../fixtures/", import.meta.url);
export const PNG = new URL("parity/assets/testsrc.png", FIXTURES);

export async function storyProject({ animatic = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "hand-in-"));
  await cp(new URL("animation-first-run/", FIXTURES), dir, { recursive: true });
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  const draft = JSON.parse(await readFile(new URL("generate-story/BIBLE.json", FIXTURES), "utf8"));
  const { members } = resolveStoryCast(story);
  const frozen = { ...draft, cast: { style: story.cast.style, characters: story.cast.characters.map(({ id }) => bibleCharacter(members.get(id), { sheet: `bible/sheets/${id}.png` })) } };
  const bible = { ...frozen, hash: bibleHash(frozen) };
  await writeFile(path.join(dir, "BIBLE.json"), JSON.stringify(bible));
  await mkdir(path.join(dir, "bible/sheets"), { recursive: true });
  for (const member of bible.cast.characters) await cp(PNG, path.join(dir, member.sheet));
  await writeFile(path.join(dir, "storyboard.json"), JSON.stringify({ ...withBible(story, bible), audio: { words: "NARRATION.json" } }));
  if (animatic) {
    await mkdir(path.join(dir, "renders"), { recursive: true });
    await writeFile(path.join(dir, "renders", "animatic.mp4"), "");
    const { shots } = await storyShotsCommand(dir);
    await writeFile(path.join(dir, "ANIMATIC.json"), JSON.stringify({ schema: ANIMATIC_SCHEMA, ...(await animaticInputs(dir)), video: "renders/animatic.mp4", fps: 30, shots: shots.map(({ id, start, end, frames, first_frame, last_frame }) => ({ id, start, end, frames, first_frame, last_frame })) }));
  }
  return { dir, bible, story: (await readProjectStory(dir)).resolved };
}

// ffprobe/ffmpeg stand-ins for the hand-in check: every clip is the story's size and rate and long enough; plates are 1920×1080.
export const probeFakes = (overrides = {}) => ({
  probe: async (file) => (/\.(png|jpe?g|webp)$/.test(file) ? { width: 1920, height: 1080, fps: 25, frames: 1 } : { width: 1920, height: 1080, fps: 30, frames: 400, ...(overrides.clip?.(file) ?? {}) }),
  measure: async (file) => ({ peak: 0.8, motion: overrides.frozen?.(file) ? 0 : 0.05, frames: 4 }),
  still: async (_video, _at, target) => cp(PNG, target)
});
