// Remotion's bundle() writes a ~30 MB webpack bundle to the system temp folder
// and never removes it. bundleForRun does the same bundle and removes it when
// the script exits, however it exits.
import {rmSync} from 'node:fs';

const bundles = new Set();
process.on('exit', () => {
  for (const serveUrl of bundles) rmSync(serveUrl, {recursive: true, force: true});
});

export async function bundleForRun(options) {
  const {bundle} = await import('@remotion/bundler');
  const serveUrl = await bundle(options);
  bundles.add(serveUrl);
  return serveUrl;
}
