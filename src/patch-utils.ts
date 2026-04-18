import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { NODE_QUEUE_DIR_PATH, REGISTRY_PATH } from "./config.js";
import type { RegistryFile } from "./types.js";

export function readRegistry(path: string = REGISTRY_PATH): RegistryFile {
  try {
    if (!existsSync(path)) return { patchAllBases: [] };
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<RegistryFile>;
    return {
      patchAllBases: Array.isArray(parsed.patchAllBases)
        ? parsed.patchAllBases.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return { patchAllBases: [] };
  }
}

export function writeRegistry(
  data: RegistryFile,
  path: string = REGISTRY_PATH,
  dir: string = NODE_QUEUE_DIR_PATH,
): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

const SKIP_DIR_NAMES = new Set([
  ".pnpm",
  ".git",
  ".svn",
  ".hg",
  ".cache",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
]);

/**
 * True recursive walk for node_modules/.bin directories under a root.
 * Never descends into node_modules (we only patch each project's top-level
 * .bin). Skips .pnpm and other noisy build/VCS directories.
 */
export function walkForBinDirs(root: string): string[] {
  const results: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const binDir = join(dir, "node_modules", ".bin");
    if (existsSync(binDir)) {
      results.push(binDir);
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name === "node_modules") continue;
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      stack.push(join(dir, entry.name));
    }
  }

  return results;
}
