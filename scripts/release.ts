import { execSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const PACKAGE_JSON = path.join(root, "package.json");

const sh = (cmd: string) => execSync(cmd, { encoding: "utf8" }).trim();

const parseSemver = (tag: string) => {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(tag);
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ?? null,
  };
};

const bumpPatch = (v: { major: number; minor: number; patch: number }) =>
  `v${v.major}.${v.minor}.${v.patch + 1}`;

const stripV = (tag: string) => (tag.startsWith("v") ? tag.slice(1) : tag);

const getRecentTags = () => {
  try {
    const out = sh("git tag --sort=-v:refname");
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
};

const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(file, "utf8")) as T;

// Preserve trailing newline so Prettier stays happy.
const writeJson = async (file: string, data: unknown) => {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const updateVersionFile = async (file: string, newVersion: string) => {
  const json = await readJson<Record<string, unknown>>(file);
  if (json.version === newVersion) return false;
  json.version = newVersion;
  await writeJson(file, json);
  return true;
};

const ensureCleanTree = () => {
  const status = sh("git status --porcelain");
  if (status) {
    console.error(
      "\n✗ Working tree is not clean. Commit or stash changes first:\n",
    );
    console.error(status);
    process.exit(1);
  }
};

const ensureOnDefaultBranch = () => {
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  if (branch !== "main" && branch !== "master") {
    console.warn(`\n⚠ You are on branch "${branch}", not main/master.`);
  }
  return branch;
};

const runStep = (label: string, cmd: string, args: string[]) => {
  console.log(`→ ${label}`);
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const main = async () => {
  ensureCleanTree();
  const branch = ensureOnDefaultBranch();

  const tags = getRecentTags();
  const pkg = await readJson<{ name: string; version: string }>(PACKAGE_JSON);

  console.log("\n📦 node-queue — release\n");
  console.log(`Package:           ${pkg.name}`);
  console.log(`Current branch:    ${branch}`);
  console.log(`package.json:      ${pkg.version}`);
  console.log(
    `Recent tags:       ${tags.length ? tags.slice(0, 5).join(", ") : "(none)"}`,
  );

  const latest = tags.find((t) => parseSemver(t));
  const latestParsed = latest ? parseSemver(latest) : null;

  const proposed = latestParsed
    ? bumpPatch(latestParsed)
    : `v${stripV(pkg.version)}`;

  console.log(`Proposed new tag:  ${proposed}\n`);

  const rl = createInterface({ input: stdin, output: stdout });
  const input = (
    await rl.question(`Enter version (press Enter to accept ${proposed}): `)
  ).trim();
  const chosen = input || proposed;

  const normalized = chosen.startsWith("v") ? chosen : `v${chosen}`;
  const bareVersion = stripV(normalized);

  if (!parseSemver(normalized)) {
    console.error(`\n✗ Invalid semver tag: ${normalized}`);
    rl.close();
    process.exit(1);
  }

  if (tags.includes(normalized)) {
    console.error(`\n✗ Tag ${normalized} already exists.`);
    rl.close();
    process.exit(1);
  }

  console.log(`\nThis will:`);
  console.log(`  1. Bump package.json   ${pkg.version}  →  ${bareVersion}`);
  console.log(`  2. Commit on ${branch}`);
  console.log(`  3. Tag ${normalized} and push ${branch} + tag`);
  console.log(`  4. GitHub Actions will build, test, and publish to npm\n`);

  const confirm = (await rl.question(`Proceed? [y/N] `)).trim().toLowerCase();
  rl.close();

  if (confirm !== "y" && confirm !== "yes") {
    console.log("Aborted.");
    process.exit(0);
  }

  const pkgChanged = await updateVersionFile(PACKAGE_JSON, bareVersion);

  if (!pkgChanged) {
    console.warn("\n⚠ package.json already at target version.");
  } else {
    runStep(`git add package.json`, "git", ["add", "package.json"]);
    runStep(`git commit -m "release: ${normalized}"`, "git", [
      "commit",
      "-m",
      `release: ${normalized}`,
    ]);
  }

  runStep(`git tag ${normalized}`, "git", ["tag", normalized]);

  // Push the commit first so the tag resolves on the remote.
  runStep(`git push origin ${branch}`, "git", ["push", "origin", branch]);

  const pushTag = spawnSync("git", ["push", "origin", normalized], {
    stdio: "inherit",
  });
  if (pushTag.status !== 0) {
    console.error("\n✗ Tag push failed. Clean up local tag with:");
    console.error(`  git tag -d ${normalized}`);
    process.exit(pushTag.status ?? 1);
  }

  console.log(
    `\n✓ Tag ${normalized} pushed. GitHub Actions will build, test, and publish to npm.`,
  );
  console.log(`  Watch: https://github.com/doryski/node-queue/actions`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
