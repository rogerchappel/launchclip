// The character-story fixture: four scenes of the first real `make --animation`
// run (a foal and a mare in a park), 9:16, with the narration's word timings.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "character-story");
export const characterStory = () => JSON.parse(readFileSync(path.join(FIXTURE, "storyboard.json"), "utf8"));
export const characterWords = () => JSON.parse(readFileSync(path.join(FIXTURE, "words.json"), "utf8"));
