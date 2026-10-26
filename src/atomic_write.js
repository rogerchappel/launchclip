// Several launchclip processes share the voice, music, SFX and segment caches
// (docs/COLLECTIONS_RFC.md §5.4). A cache file is written to a temporary name
// in the same folder and renamed into place, so a reader sees the whole file
// or none, and an interrupted write never leaves a truncated file that later
// looks like a cache hit. The temporary name is unique per call, so two
// processes writing the same entry never write into each other's file.
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** The temporary name beside file: <name>.<uuid>.tmp<ext>, keeping the extension for tools that read it. */
export function temporaryBeside(file) {
  const extension = path.extname(file);
  return `${file.slice(0, file.length - extension.length)}.${randomUUID()}.tmp${extension}`;
}

/** writeFile, then rename into place. */
export async function writeFileAtomic(file, data, options) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = temporaryBeside(file);
  try {
    await writeFile(temporary, data, options);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** copyFile, then rename into place. */
export async function copyFileAtomic(source, file) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = temporaryBeside(file);
  try {
    await copyFile(source, temporary);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
