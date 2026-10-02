import { mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const source = require.resolve("gsap/dist/gsap.min.js");
for (const project of ["starter", "finished"]) {
  const assets = new URL(`../${project}/assets/`, import.meta.url);
  await mkdir(assets, { recursive: true });
  await copyFile(source, new URL("gsap.min.js", assets));
  console.log(`Prepared local GSAP: ${fileURLToPath(assets)}`);
}
