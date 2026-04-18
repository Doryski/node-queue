import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  readRegistry,
  walkForBinDirs,
  writeRegistry,
} from "../patch-utils.js";

function makeBin(dir: string) {
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".bin", "vitest"), "#!/bin/sh\n");
}

describe("walkForBinDirs", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nq-walk-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds .bin in the root project", () => {
    makeBin(root);
    expect(walkForBinDirs(root)).toEqual([
      join(root, "node_modules", ".bin"),
    ]);
  });

  it("finds .bin in nested workspace packages", () => {
    makeBin(join(root, "apps", "web"));
    makeBin(join(root, "packages", "core"));
    const result = walkForBinDirs(root).sort();
    expect(result).toEqual(
      [
        join(root, "apps", "web", "node_modules", ".bin"),
        join(root, "packages", "core", "node_modules", ".bin"),
      ].sort(),
    );
  });

  it("does not descend into node_modules (skips transitive dep bins)", () => {
    makeBin(root);
    // Simulate a transitive dep with its own .bin
    mkdirSync(
      join(root, "node_modules", "some-dep", "node_modules", ".bin"),
      { recursive: true },
    );
    writeFileSync(
      join(root, "node_modules", "some-dep", "node_modules", ".bin", "vitest"),
      "#!/bin/sh\n",
    );
    expect(walkForBinDirs(root)).toEqual([
      join(root, "node_modules", ".bin"),
    ]);
  });

  it("skips .pnpm, .git, and other noisy directories", () => {
    makeBin(join(root, "project-a"));
    mkdirSync(join(root, ".pnpm", "fake", "node_modules", ".bin"), {
      recursive: true,
    });
    mkdirSync(join(root, ".git", "node_modules", ".bin"), { recursive: true });
    const result = walkForBinDirs(root);
    expect(result).toEqual([
      join(root, "project-a", "node_modules", ".bin"),
    ]);
  });

  it("handles missing roots gracefully", () => {
    expect(walkForBinDirs(join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("registry", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nq-reg-"));
    path = join(dir, "config.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty registry when file does not exist", () => {
    expect(readRegistry(path)).toEqual({ patchAllBases: [] });
  });

  it("round-trips bases", () => {
    writeRegistry({ patchAllBases: ["/a", "/b"] }, path, dir);
    expect(readRegistry(path)).toEqual({ patchAllBases: ["/a", "/b"] });
  });

  it("falls back to empty on corrupt JSON", () => {
    writeFileSync(path, "{not json");
    expect(readRegistry(path)).toEqual({ patchAllBases: [] });
  });

  it("filters non-string entries defensively", () => {
    writeFileSync(
      path,
      JSON.stringify({ patchAllBases: ["/a", 42, null, "/b"] }),
    );
    expect(readRegistry(path)).toEqual({ patchAllBases: ["/a", "/b"] });
  });

  it("creates the parent directory on write", () => {
    const nestedDir = join(dir, "nested");
    const nestedPath = join(nestedDir, "config.json");
    writeRegistry({ patchAllBases: ["/x"] }, nestedPath, nestedDir);
    expect(existsSync(nestedPath)).toBe(true);
    expect(readRegistry(nestedPath)).toEqual({ patchAllBases: ["/x"] });
  });
});
