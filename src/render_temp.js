// Remotion (frames, downloaded assets, the Chrome profile), HyperFrames and
// the tools finish runs write their temporary files to os.tmpdir(). A render
// onto an external drive then still fills the internal disk
// (docs/COLLECTIONS_RFC.md §5.1). useProjectTemp() points TMPDIR at a folder
// beside the project for the length of a render, so temporary files land on
// the project's drive and go when it ends; os.tmpdir() and every child
// process read the variable at call time. The folder sits next to the project,
// not inside it: Remotion serves the project as its public folder and lists
// it, and a Chrome profile changing under that listing is not wanted.
//
// Caches that outlive one render (Remotion bundles and webpack roots) keep
// using the system temp folder through systemTempDir().
import { mkdir, mkdtemp, readdir, rm, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Captured at load, before any useProjectTemp().
const SYSTEM_TMPDIR = os.tmpdir();
const VARIABLES = ["TMPDIR", "TMP", "TEMP"];

export const TEMP_FOLDER = ".launchclip-tmp";

/** The temp folder the process started with, for caches shared across renders. */
export function systemTempDir() {
  return SYSTEM_TMPDIR;
}

/**
 * Point TMPDIR, TMP and TEMP at a fresh <project>/../.launchclip-tmp/<pid>-*
 * folder. Folders left by processes that are gone are removed first.
 * → {dir, release()}: release() restores the variables and removes the folder
 * (and .launchclip-tmp when nothing else is using it).
 */
export async function useProjectTemp(project, env = process.env) {
  const root = path.join(path.dirname(path.resolve(project)), TEMP_FOLDER);
  // A parent that cannot be written (a drive's root folder): keep the system temp folder.
  try { await mkdir(root, { recursive: true }); } catch { return { dir: null, async release() {} }; }
  await pruneAbandoned(root);
  const dir = await mkdtemp(path.join(root, `${process.pid}-`));
  const saved = VARIABLES.map((name) => [name, Object.hasOwn(env, name) ? env[name] : undefined]);
  for (const name of VARIABLES) env[name] = dir;
  let released = false;
  return {
    dir,
    async release() {
      if (released) return;
      released = true;
      for (const [name, value] of saved) {
        if (value === undefined) delete env[name];
        else env[name] = value;
      }
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      // rmdir fails while another render's folder is in there, which is fine.
      await rmdir(root).catch(() => {});
    }
  };
}

async function pruneAbandoned(root) {
  let names;
  try { names = await readdir(root); } catch { return; }
  for (const name of names) {
    const pid = Number(/^(\d+)-/.exec(name)?.[1]);
    if (!pid || pid === process.pid || alive(pid)) continue;
    await rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}
