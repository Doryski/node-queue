#!/usr/bin/env tsx
/**
 * Build script to compile shims for all intercepted binaries using esbuild.
 * Creates standalone executables in ~/.node-queue/bin/
 */

import { build } from "esbuild";
import { mkdirSync, chmodSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { INTERCEPTED_BINARIES, SHIM_BIN_DIR } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Find absolute path to node binary (works with nvm, homebrew, etc.)
 */
function findNodePath(): string {
  try {
    // process.execPath gives us the current node binary path
    return process.execPath;
  } catch {
    // Fallback to which
    try {
      return execSync("which node", { encoding: "utf8" }).trim();
    } catch {
      return "/usr/bin/env node"; // Last resort fallback
    }
  }
}

async function buildShims() {
  const nodePath = findNodePath();
  console.log(`Using node: ${nodePath}\n`);
  console.log("Building node-queue shims...\n");

  // Ensure output directory exists
  if (!existsSync(SHIM_BIN_DIR)) {
    mkdirSync(SHIM_BIN_DIR, { recursive: true });
  }

  const shimSource = join(__dirname, "shim.ts");

  for (const binary of INTERCEPTED_BINARIES) {
    const outfile = join(SHIM_BIN_DIR, binary);

    try {
      await build({
        entryPoints: [shimSource],
        bundle: true,
        platform: "node",
        target: "node18",
        format: "esm",
        outfile,
        minify: true,
        define: {
          TARGET_BINARY: JSON.stringify(binary),
        },
        banner: {
          js: `#!${nodePath}`,
        },
        // External node builtins are available in the target environment
        external: [],
      });

      // Make executable
      chmodSync(outfile, 0o755);

      console.log(`  ✓ ${binary} -> ${outfile}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${binary}: ${message}`);
      process.exit(1);
    }
  }

  console.log(`\nShims built to: ${SHIM_BIN_DIR}`);
  console.log("\nTo activate, add this to your shell config:");
  console.log(`  export PATH="${SHIM_BIN_DIR}:$PATH"`);
}

buildShims().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
