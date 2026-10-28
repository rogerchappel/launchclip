// Where LaunchClip keeps state that outlives a project: the user state folder
// (styles, skeletons, the SFX library, matting models, the slot queue, model
// selection state, brand assets) and the cache (voice, music, Kokoro models,
// audio isolation). The CLI uses ~/.launchclip and ~/.cache/launchclip, or
// LAUNCHCLIP_HOME and LAUNCHCLIP_CACHE (plus the narrower LAUNCHCLIP_*
// variables each caller documents).
//
// An app that embeds the engine (@launchclip/engine) runs each call inside
// withStateDirs({home, cache}): everything under that call (and every promise
// it starts) resolves state there, ignores those variables and never reaches
// the user's home folder. The scope is per async context (AsyncLocalStorage),
// so concurrent engine calls with different folders do not see each other's,
// and process.env is never changed.
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

const scope = new AsyncLocalStorage();

/** Runs fn with LaunchClip's state folders pinned to {home, cache} (and project temp left to the app). */
export function withStateDirs({ home, cache }, fn) {
  if (!home || !cache) throw new Error("withStateDirs needs {home, cache}");
  return scope.run(Object.freeze({ home: path.resolve(home), cache: path.resolve(cache) }), fn);
}

/** The pinned {home, cache} of the current engine call, or null (the CLI). */
export function stateScope() {
  return scope.getStore() ?? null;
}

/** <home>/<sub> of the current engine call, or null outside one (callers then apply their own variables and defaults). */
export function pinnedHome(sub) {
  const pinned = stateScope();
  return pinned ? path.join(pinned.home, sub) : null;
}

/** <cache>/<sub> of the current engine call, or null outside one. */
export function pinnedCache(sub) {
  const pinned = stateScope();
  return pinned ? path.join(pinned.cache, sub) : null;
}
