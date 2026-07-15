import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_PUBLIC_ROOT = path.join(PACKAGE_ROOT, "public");

export function workspacePublicRoot(workspacePath) {
  return path.join(path.resolve(workspacePath), "video", "public");
}

export async function stageBundledPublicAssets(workspacePath, options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot ?? PACKAGE_PUBLIC_ROOT);
  const targetRoot = workspacePublicRoot(workspacePath);
  await mkdir(targetRoot, { recursive: true });
  await cp(sourceRoot, targetRoot, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) => path.basename(source) !== ".gitignore"
  });
  return targetRoot;
}
