#!/usr/bin/env tsx
/**
 * CLI for managing the node-queue daemon
 */

import { program } from "commander";
import { connect } from "net";
import { spawn, execSync } from "child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  mkdirSync,
  renameSync,
  realpathSync,
  lstatSync,
  chmodSync,
} from "fs";
import { homedir } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import * as prompts from "@clack/prompts";
import {
  config,
  SHIM_BIN_DIR,
  NODE_QUEUE_DIR_PATH,
  INTERCEPTED_BINARIES,
} from "./config.js";
import type { StatusResponse } from "./types.js";
import { readRegistry, walkForBinDirs, writeRegistry } from "./patch-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJsonPath = join(__dirname, "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };

function isDaemonRunning(): boolean {
  if (!existsSync(config.pidFile)) return false;

  try {
    const pid = parseInt(readFileSync(config.pidFile, "utf8").trim(), 10);
    process.kill(pid, 0); // Check if process exists
    return true;
  } catch {
    // Process not running, clean up stale PID file
    try {
      unlinkSync(config.pidFile);
    } catch {
      // Ignore
    }
    return false;
  }
}

function getDaemonPid(): number | null {
  if (!existsSync(config.pidFile)) return null;
  try {
    return parseInt(readFileSync(config.pidFile, "utf8").trim(), 10);
  } catch {
    return null;
  }
}

async function getStatus(): Promise<StatusResponse | null> {
  return new Promise((resolve) => {
    if (!existsSync(config.socketPath)) {
      resolve(null);
      return;
    }

    const socket = connect(config.socketPath);
    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, 5000);

    socket.on("connect", () => {
      socket.write(JSON.stringify({ type: "status" }) + "\n");
    });

    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          clearTimeout(timeout);
          socket.destroy();
          resolve(JSON.parse(line) as StatusResponse);
          return;
        } catch {
          // Ignore parse errors
        }
      }
    });

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

function detectShell(): { name: string; rcFile: string } | null {
  const shell = process.env["SHELL"] || "";

  if (shell.includes("zsh")) {
    return { name: "zsh", rcFile: join(homedir(), ".zshrc") };
  } else if (shell.includes("bash")) {
    // Check for .bash_profile first (common on macOS)
    const bashProfile = join(homedir(), ".bash_profile");
    if (existsSync(bashProfile)) {
      return { name: "bash", rcFile: bashProfile };
    }
    return { name: "bash", rcFile: join(homedir(), ".bashrc") };
  } else if (shell.includes("fish")) {
    return {
      name: "fish",
      rcFile: join(homedir(), ".config", "fish", "config.fish"),
    };
  }

  return null;
}

const PATH_EXPORT_MARKER = "# node-queue PATH";
const ALIASES_MARKER = "# node-queue aliases";
const WRAPPERS_MARKER = "# node-queue auto-patch wrappers";
const WRAPPERS_END_MARKER = "# node-queue auto-patch wrappers end";

function isPathInstalled(rcFile: string): boolean {
  if (!existsSync(rcFile)) return false;
  const content = readFileSync(rcFile, "utf8");
  return content.includes(PATH_EXPORT_MARKER);
}

function areAliasesInstalled(rcFile: string): boolean {
  if (!existsSync(rcFile)) return false;
  const content = readFileSync(rcFile, "utf8");
  return content.includes(ALIASES_MARKER);
}

function areWrappersInstalled(rcFile: string): boolean {
  if (!existsSync(rcFile)) return false;
  const content = readFileSync(rcFile, "utf8");
  return content.includes(WRAPPERS_MARKER);
}

function buildWrappersBlock(shellName: string): string {
  if (shellName === "fish") {
    return `${WRAPPERS_MARKER}
function pnpm
  command pnpm $argv
  set -l code $status
  if contains -- $argv[1] install i add; and test -d node_modules/.bin
    echo "[node-queue] Auto-patching project..."
    env NODE_QUEUE_BYPASS=1 node-queue install-project -p . 2>/dev/null
  end
  return $code
end

function npm
  command npm $argv
  set -l code $status
  if contains -- $argv[1] install i add; and test -d node_modules/.bin
    echo "[node-queue] Auto-patching project..."
    env NODE_QUEUE_BYPASS=1 node-queue install-project -p . 2>/dev/null
  end
  return $code
end
${WRAPPERS_END_MARKER}
`;
  }

  // bash / zsh
  return `${WRAPPERS_MARKER}
pnpm() {
  command pnpm "$@"
  local code=$?
  if [[ "$1" =~ ^(install|i|add)$ ]] && [[ -d "node_modules/.bin" ]]; then
    echo "[node-queue] Auto-patching project..."
    NODE_QUEUE_BYPASS=1 node-queue install-project -p . 2>/dev/null
  fi
  return $code
}

npm() {
  command npm "$@"
  local code=$?
  if [[ "$1" =~ ^(install|i|add)$ ]] && [[ -d "node_modules/.bin" ]]; then
    echo "[node-queue] Auto-patching project..."
    NODE_QUEUE_BYPASS=1 node-queue install-project -p . 2>/dev/null
  fi
  return $code
}
${WRAPPERS_END_MARKER}
`;
}


program
  .name("node-queue")
  .description("Manage the node process queue daemon")
  .version(packageJson.version);

program
  .command("start")
  .description("Start the daemon")
  .option("-f, --foreground", "Run in foreground (default: background)")
  .action(async (options: { foreground?: boolean }) => {
    if (isDaemonRunning()) {
      const pid = getDaemonPid();
      console.log(`Daemon already running (pid=${pid})`);
      return;
    }

    // Ensure directory exists
    if (!existsSync(NODE_QUEUE_DIR_PATH)) {
      mkdirSync(NODE_QUEUE_DIR_PATH, { recursive: true });
    }

    if (options.foreground) {
      // Run in foreground - import and run directly
      const { startDaemon } = await import("./daemon.js");
      await startDaemon();
    } else {
      // Run in background
      const daemonPath = join(__dirname, "daemon.ts");
      const child = spawn("tsx", [daemonPath], {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        cwd: process.cwd(),
      });
      child.unref();

      // Wait for daemon to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (isDaemonRunning()) {
        const pid = getDaemonPid();
        console.log(`Daemon started (pid=${pid})`);
        console.log(`Log: ${config.logPath}`);
      } else {
        console.error("Failed to start daemon. Check logs:", config.logPath);
        process.exit(1);
      }
    }
  });

program
  .command("stop")
  .description("Stop the daemon")
  .action(() => {
    if (!isDaemonRunning()) {
      console.log("Daemon is not running");
      return;
    }

    const pid = getDaemonPid();
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
        console.log(`Sent SIGTERM to daemon (pid=${pid})`);

        // Wait for it to stop
        let attempts = 0;
        const checkStopped = () => {
          if (!isDaemonRunning()) {
            console.log("Daemon stopped");
            return;
          }
          if (attempts++ < 10) {
            setTimeout(checkStopped, 200);
          } else {
            console.log("Daemon still running, sending SIGKILL");
            process.kill(pid, "SIGKILL");
          }
        };
        checkStopped();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to stop daemon: ${message}`);
      }
    }
  });

program
  .command("status")
  .description("Show daemon status and queue")
  .action(async () => {
    const running = isDaemonRunning();
    const pid = getDaemonPid();

    console.log("\n=== Node Queue Daemon ===\n");
    console.log(`Status: ${running ? "🟢 Running" : "🔴 Stopped"}`);

    if (running && pid) {
      console.log(`PID: ${pid}`);

      const status = await getStatus();
      if (status) {
        console.log(`\n--- CPU ---`);
        console.log(
          `Overall: ${status.cpuStats.overall.toFixed(1)}% (threshold: ${status.thresholds.maxOverallCpu}%)`,
        );
        console.log(
          `System:  ${status.cpuStats.system.toFixed(1)}% (threshold: ${status.thresholds.maxSystemCpu}%)`,
        );
        console.log(`User:    ${status.cpuStats.user.toFixed(1)}%`);

        console.log(`\n--- Queue ---`);
        console.log(`Length: ${status.queueLength}`);

        if (status.queuedProcesses.length > 0) {
          console.log("\nQueued processes:");
          for (const p of status.queuedProcesses) {
            console.log(
              `  ${p.id}: ${p.targetBinary} (waiting ${p.waitingMs}ms)`,
            );
          }
        }

        console.log(`\n--- Session Metrics ---`);
        console.log(`Total queued:    ${status.metrics.totalQueued}`);
        console.log(`Total processed: ${status.metrics.totalProcessed}`);
        console.log(`Total rejected:  ${status.metrics.totalRejected}`);
        console.log(`Total timed out: ${status.metrics.totalTimedOut}`);
        console.log(`Peak queue:      ${status.metrics.peakQueueDepth}`);

        const avgWait =
          status.metrics.totalProcessed > 0
            ? status.metrics.totalWaitTimeMs / status.metrics.totalProcessed
            : 0;
        console.log(`Avg wait time:   ${avgWait.toFixed(0)}ms`);

        const uptime = Date.now() - status.metrics.startTime;
        const uptimeMin = Math.floor(uptime / 60000);
        const uptimeSec = Math.floor((uptime % 60000) / 1000);
        console.log(`Uptime:          ${uptimeMin}m ${uptimeSec}s`);
      }
    }

    // Check PATH installation
    const shell = detectShell();
    if (shell && isPathInstalled(shell.rcFile)) {
      console.log(`\n--- PATH ---`);
      console.log(`Installed in: ${shell.rcFile}`);
    } else {
      console.log(`\n--- PATH ---`);
      console.log(`Not installed. Run 'node-queue install' to add to PATH.`);
    }

    console.log("");
  });

program
  .command("install")
  .description("Install PATH modification and build shims")
  .action(async () => {
    prompts.intro("Node Queue Installation");

    // Build shims first
    const buildSpinner = prompts.spinner();
    buildSpinner.start("Building shims...");

    try {
      execSync("tsx " + join(__dirname, "build.ts"), {
        stdio: "pipe",
        cwd: dirname(__dirname),
      });
      buildSpinner.stop("Shims built");
    } catch (err) {
      buildSpinner.stop("Failed to build shims");
      console.error(err);
      process.exit(1);
    }

    // Detect shell
    const shell = detectShell();
    if (!shell) {
      prompts.log.error("Could not detect shell type");
      prompts.outro("Installation incomplete");
      process.exit(1);
    }

    prompts.log.info(`Detected shell: ${shell.name}`);

    // Check if already installed
    if (isPathInstalled(shell.rcFile)) {
      prompts.log.warn("PATH already configured");
    } else {
      // Add PATH export
      const exportLine =
        shell.name === "fish"
          ? `${PATH_EXPORT_MARKER}\nset -gx PATH "${SHIM_BIN_DIR}" $PATH\n`
          : `${PATH_EXPORT_MARKER}\nexport PATH="${SHIM_BIN_DIR}:$PATH"\n`;

      appendFileSync(shell.rcFile, "\n" + exportLine);
      prompts.log.success(`Added PATH to ${shell.rcFile}`);
    }

    // Add aliases (with NODE_QUEUE_BYPASS=1 to avoid recursive interception)
    if (areAliasesInstalled(shell.rcFile)) {
      prompts.log.warn("Aliases already configured");
    } else {
      const projectRoot = dirname(dirname(__dirname));
      const aliasesBlock =
        shell.name === "fish"
          ? `${ALIASES_MARKER}
alias nqstart="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue start"
alias nqstop="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue stop"
alias nqrestart="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue stop && NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue start"
alias nqstatus="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue status"
alias nqinstall="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue install"
alias nqlogs="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue logs"
alias nqkillall="killall node 2>/dev/null; echo 'Killed all node processes'"
`
          : `${ALIASES_MARKER}
alias nqstart="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue start"
alias nqstop="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue stop"
alias nqrestart="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue stop && NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue start"
alias nqstatus="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue status"
alias nqinstall="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue install"
alias nqlogs="NODE_QUEUE_BYPASS=1 pnpm --dir ${projectRoot} node-queue logs"
alias nqkillall="killall node 2>/dev/null; echo 'Killed all node processes'"
`;

      appendFileSync(shell.rcFile, "\n" + aliasesBlock);
      prompts.log.success(
        "Added aliases: nqstart, nqstop, nqrestart, nqstatus, nqinstall, nqlogs, nqkillall",
      );
    }

    // Ask about LaunchAgent
    const installLaunchAgent = await prompts.confirm({
      message: "Install LaunchAgent to start daemon on login?",
      initialValue: true,
    });

    if (prompts.isCancel(installLaunchAgent)) {
      prompts.outro("Installation cancelled");
      process.exit(0);
    }

    if (installLaunchAgent) {
      const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
      const plistPath = join(launchAgentsDir, "com.user.node-queue.plist");

      if (!existsSync(launchAgentsDir)) {
        mkdirSync(launchAgentsDir, { recursive: true });
      }

      // Get absolute path to daemon
      const projectRoot = dirname(dirname(__dirname));
      const daemonPath = join(projectRoot, "src", "node-queue", "daemon.ts");

      // Find global tsx path - avoid node_modules/.bin which has permission issues with launchd
      let tsxPath = "";

      // Try which first (most reliable way to find globally installed tsx)
      try {
        const whichResult = execSync("which tsx", { encoding: "utf8" }).trim();
        // Only use if it's not in a local node_modules (launchd can't access project dirs)
        if (whichResult && !whichResult.includes("/node_modules/.bin/")) {
          tsxPath = whichResult;
        }
      } catch {
        // Not found via which
      }

      // Fallback: check common global paths
      if (!tsxPath) {
        const globalPaths = [
          "/opt/homebrew/bin/tsx",
          "/usr/local/bin/tsx",
        ];

        // Dynamically find tsx in nvm if available
        const nvmDir = join(homedir(), ".nvm/versions/node");
        if (existsSync(nvmDir)) {
          try {
            const versions = execSync(`ls -1 "${nvmDir}"`, { encoding: "utf8" })
              .trim()
              .split("\n")
              .filter(Boolean)
              .reverse(); // newest first
            for (const version of versions) {
              globalPaths.push(join(nvmDir, version, "bin", "tsx"));
            }
          } catch {
            // Ignore - nvm dir not readable
          }
        }

        for (const p of globalPaths) {
          if (existsSync(p)) {
            tsxPath = p;
            break;
          }
        }
      }

      if (!tsxPath) {
        prompts.log.error(
          "Global tsx not found. Install it: npm install -g tsx",
        );
        prompts.log.message("  LaunchAgent requires globally installed tsx");
        prompts.outro("Installation incomplete");
        process.exit(1);
      }

      // Get node binary directory for PATH
      const nodeBinDir = dirname(tsxPath);
      // Build a PATH that includes node, homebrew, and common locations
      const launchAgentPath = [
        nodeBinDir,
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ].join(":");

      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.node-queue</string>
    <key>ProgramArguments</key>
    <array>
        <string>${tsxPath}</string>
        <string>${daemonPath}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${launchAgentPath}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${config.logPath}</string>
    <key>StandardErrorPath</key>
    <string>${config.logPath}</string>
    <key>WorkingDirectory</key>
    <string>${homedir()}</string>
</dict>
</plist>`;

      writeFileSync(plistPath, plistContent);
      prompts.log.success(`Created LaunchAgent at ${plistPath}`);

      // Load the LaunchAgent
      try {
        execSync(`launchctl load "${plistPath}"`, { stdio: "pipe" });
        prompts.log.success("LaunchAgent loaded");
      } catch {
        prompts.log.warn("Could not load LaunchAgent. Run manually:");
        prompts.log.message(`  launchctl load "${plistPath}"`);
      }
    }

    // Ask about auto-patch wrappers (pnpm/npm shell functions)
    if (areWrappersInstalled(shell.rcFile)) {
      prompts.log.warn("Auto-patch wrappers already configured");
    } else {
      const installWrappers = await prompts.confirm({
        message:
          "Install pnpm/npm wrappers that auto-patch node_modules/.bin after install?",
        initialValue: true,
      });

      if (prompts.isCancel(installWrappers)) {
        prompts.outro("Installation cancelled");
        process.exit(0);
      }

      if (installWrappers) {
        appendFileSync(
          shell.rcFile,
          "\n" + buildWrappersBlock(shell.name),
        );
        prompts.log.success(
          `Added pnpm/npm auto-patch wrappers to ${shell.rcFile}`,
        );
      }
    }

    prompts.outro("Installation complete! Restart your shell to activate.");
    console.log("\nIntercepted commands:", INTERCEPTED_BINARIES.join(", "));
    console.log("To test: node -e \"console.log('test')\"");
  });

program
  .command("uninstall")
  .description("Remove PATH modification and LaunchAgent")
  .action(async () => {
    prompts.intro("Node Queue Uninstallation");

    // Stop daemon if running
    if (isDaemonRunning()) {
      const pid = getDaemonPid();
      if (pid) {
        prompts.log.info("Stopping daemon...");
        process.kill(pid, "SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Unload and remove LaunchAgent
    const plistPath = join(
      homedir(),
      "Library",
      "LaunchAgents",
      "com.user.node-queue.plist",
    );
    if (existsSync(plistPath)) {
      try {
        execSync(`launchctl unload "${plistPath}"`, { stdio: "pipe" });
      } catch {
        // Ignore - might not be loaded
      }
      unlinkSync(plistPath);
      prompts.log.success("Removed LaunchAgent");
    }

    // Remove PATH, aliases, and wrappers from shell config
    const shell = detectShell();
    if (shell && existsSync(shell.rcFile)) {
      const content = readFileSync(shell.rcFile, "utf8");
      const lines = content.split("\n");
      const filtered: string[] = [];
      let skipAliasesUntilNonAlias = false;
      let skipWrappersUntilEnd = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const prev = lines[i - 1] ?? "";

        // Wrappers block: remove everything between marker and end marker (inclusive)
        if (line.includes(WRAPPERS_MARKER) && !line.includes(WRAPPERS_END_MARKER)) {
          skipWrappersUntilEnd = true;
          continue;
        }
        if (skipWrappersUntilEnd) {
          if (line.includes(WRAPPERS_END_MARKER)) {
            skipWrappersUntilEnd = false;
          }
          continue;
        }

        // PATH marker and following line
        if (line.includes(PATH_EXPORT_MARKER)) continue;
        if (prev.includes(PATH_EXPORT_MARKER)) continue;

        // Aliases block (marker + all alias lines until a non-alias line)
        if (line.includes(ALIASES_MARKER)) {
          skipAliasesUntilNonAlias = true;
          continue;
        }
        if (skipAliasesUntilNonAlias) {
          if (line.startsWith("alias nq")) continue;
          skipAliasesUntilNonAlias = false;
        }

        filtered.push(line);
      }
      writeFileSync(shell.rcFile, filtered.join("\n"));
      prompts.log.success(
        `Removed PATH, aliases, and wrappers from ${shell.rcFile}`,
      );
    }

    // Offer to clear the patch-all registry
    const registry = readRegistry();
    if (registry.patchAllBases.length > 0) {
      const forget = await prompts.confirm({
        message: `Forget ${registry.patchAllBases.length} registered patch-all base(s)?`,
        initialValue: false,
      });
      if (!prompts.isCancel(forget) && forget) {
        writeRegistry({ patchAllBases: [] });
        prompts.log.success("Cleared patch-all registry");
      }
    }

    prompts.outro("Uninstallation complete. Restart your shell.");
  });

program
  .command("build")
  .description("Build shims only (without PATH installation)")
  .action(() => {
    console.log("Building shims...\n");
    execSync("tsx " + join(__dirname, "build.ts"), {
      stdio: "inherit",
      cwd: dirname(__dirname),
    });
  });

program
  .command("logs")
  .description("Show daemon logs")
  .option("-f, --follow", "Follow log output")
  .option("-n, --lines <n>", "Number of lines to show", "50")
  .action((options: { follow?: boolean; lines: string }) => {
    if (!existsSync(config.logPath)) {
      console.log("No logs found");
      return;
    }

    if (options.follow) {
      const tail = spawn("tail", ["-f", config.logPath], { stdio: "inherit" });
      process.on("SIGINT", () => {
        tail.kill();
        process.exit(0);
      });
    } else {
      const tail = spawn("tail", ["-n", options.lines, config.logPath], {
        stdio: "inherit",
      });
      tail.on("close", () => process.exit(0));
    }
  });

/**
 * Patch a single bin directory
 */
function patchBinDir(binDir: string, verbose = true): number {
  let patched = 0;

  for (const binary of INTERCEPTED_BINARIES) {
    const binPath = join(binDir, binary);
    const originalPath = join(binDir, `.${binary}-original`);

    // Skip if already patched
    if (existsSync(originalPath)) {
      if (verbose) console.log(`  ✓ ${binary} (already patched)`);
      patched++;
      continue;
    }

    // Skip if binary doesn't exist
    if (!existsSync(binPath)) {
      if (verbose) console.log(`  - ${binary} (not installed)`);
      continue;
    }

    try {
      // Get the real path (resolve symlink)
      let realBinaryPath: string;
      const stat = lstatSync(binPath);
      if (stat.isSymbolicLink()) {
        realBinaryPath = realpathSync(binPath);
      } else {
        // Not a symlink, just rename it
        realBinaryPath = originalPath;
      }

      // Rename original to .{name}-original
      renameSync(binPath, originalPath);

      // Create wrapper script that calls global shim with LOCAL_BIN set
      const shimPath = join(SHIM_BIN_DIR, binary);
      const wrapperScript = `#!/bin/bash
# node-queue wrapper - calls global shim with local binary path
NODE_QUEUE_LOCAL_BIN="${realBinaryPath}" exec "${shimPath}" "$@"
`;
      writeFileSync(binPath, wrapperScript);
      chmodSync(binPath, 0o755);

      if (verbose) console.log(`  ✓ ${binary}`);
      patched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (verbose) console.error(`  ✗ ${binary}: ${msg}`);
    }
  }

  return patched;
}

/**
 * Find all node_modules/.bin directories (excluding .pnpm)
 */
function findAllBinDirs(rootPath: string): string[] {
  const binDirs: string[] = [];

  const findRecursive = (dir: string) => {
    const binDir = join(dir, "node_modules", ".bin");
    if (existsSync(binDir)) {
      binDirs.push(binDir);
    }

    // Check for workspace packages in common locations
    const checkDirs = ["packages", "apps", "libs", "modules"];
    for (const subdir of checkDirs) {
      const packagesDir = join(dir, subdir);
      if (existsSync(packagesDir)) {
        try {
          const entries = execSync(`ls -1 "${packagesDir}"`, {
            encoding: "utf8",
          })
            .trim()
            .split("\n")
            .filter(Boolean);
          for (const entry of entries) {
            const pkgBinDir = join(packagesDir, entry, "node_modules", ".bin");
            if (existsSync(pkgBinDir)) {
              binDirs.push(pkgBinDir);
            }
          }
        } catch {
          // Ignore errors
        }
      }
    }
  };

  findRecursive(rootPath);
  return binDirs;
}

program
  .command("install-project")
  .description(
    "Patch node_modules/.bin to use node-queue (run after pnpm install)",
  )
  .option("-p, --path <path>", "Project path (default: current directory)")
  .option("-r, --recursive", "Patch all workspace packages")
  .action((options: { path?: string; recursive?: boolean }) => {
    const projectPath = options.path ? resolve(options.path) : process.cwd();

    if (options.recursive) {
      const binDirs = findAllBinDirs(projectPath);

      if (binDirs.length === 0) {
        console.error("No node_modules/.bin directories found");
        process.exit(1);
      }

      console.log(`Found ${binDirs.length} bin directories\n`);
      let totalPatched = 0;

      for (const binDir of binDirs) {
        // Show relative path for readability
        const relPath = binDir
          .replace(projectPath, ".")
          .replace("/node_modules/.bin", "");
        console.log(`${relPath || "(root)"}:`);
        totalPatched += patchBinDir(binDir);
        console.log("");
      }

      console.log(
        `Total patched: ${totalPatched} binaries across ${binDirs.length} directories`,
      );
      console.log('\nNote: Re-run this after "pnpm install" to re-patch.');
    } else {
      const binDir = join(projectPath, "node_modules", ".bin");

      if (!existsSync(binDir)) {
        console.error(`node_modules/.bin not found in ${projectPath}`);
        console.log('Run "pnpm install" first');
        process.exit(1);
      }

      console.log(`Patching ${binDir}...\n`);
      const patched = patchBinDir(binDir);
      console.log(
        `\nPatched ${patched}/${INTERCEPTED_BINARIES.length} binaries`,
      );
      console.log('\nNote: Re-run this after "pnpm install" to re-patch.');
    }
  });

program
  .command("uninstall-project")
  .description("Remove node-queue patches from node_modules/.bin")
  .option("-p, --path <path>", "Project path (default: current directory)")
  .action((options: { path?: string }) => {
    const projectPath = options.path ? resolve(options.path) : process.cwd();
    const binDir = join(projectPath, "node_modules", ".bin");

    if (!existsSync(binDir)) {
      console.error(`node_modules/.bin not found in ${projectPath}`);
      process.exit(1);
    }

    console.log(`Restoring ${binDir}...\n`);
    let restored = 0;

    for (const binary of INTERCEPTED_BINARIES) {
      const binPath = join(binDir, binary);
      const originalPath = join(binDir, `.${binary}-original`);

      // Skip if not patched
      if (!existsSync(originalPath)) {
        continue;
      }

      try {
        // Remove wrapper
        if (existsSync(binPath)) {
          unlinkSync(binPath);
        }
        // Restore original
        renameSync(originalPath, binPath);
        console.log(`  ✓ ${binary} restored`);
        restored++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${binary}: ${msg}`);
      }
    }

    console.log(`\nRestored ${restored} binaries`);
  });

function runPatchAllForBase(base: string): { dirs: number; patched: number } {
  const binDirs = walkForBinDirs(base);
  if (binDirs.length === 0) {
    console.log(`  (no node_modules/.bin found under ${base})`);
    return { dirs: 0, patched: 0 };
  }
  let patched = 0;
  for (const binDir of binDirs) {
    const relPath = binDir
      .replace(base, ".")
      .replace("/node_modules/.bin", "");
    console.log(`${relPath || "(root)"}:`);
    patched += patchBinDir(binDir, false);
  }
  console.log(
    `\n  → ${binDirs.length} project(s), ${patched} binary patch(es) under ${base}\n`,
  );
  return { dirs: binDirs.length, patched };
}

program
  .command("patch-all")
  .description(
    "Recursively patch every node_modules/.bin under a base directory. Registers the base for re-runs.",
  )
  .option("-b, --base <dir>", "Base directory to walk and patch")
  .option("-f, --forget <dir>", "Remove a registered base directory")
  .action((options: { base?: string; forget?: string }) => {
    const registry = readRegistry();

    if (options.forget) {
      const abs = resolve(options.forget);
      const before = registry.patchAllBases.length;
      registry.patchAllBases = registry.patchAllBases.filter((b) => b !== abs);
      writeRegistry(registry);
      const after = registry.patchAllBases.length;
      console.log(
        before === after
          ? `Base not registered: ${abs}`
          : `Forgot base: ${abs}`,
      );
      console.log(`Registered bases: ${after}`);
      return;
    }

    if (options.base) {
      const abs = resolve(options.base);
      if (!existsSync(abs)) {
        console.error(`Base directory does not exist: ${abs}`);
        process.exit(1);
      }
      console.log(`Patching under ${abs}...\n`);
      const { dirs, patched } = runPatchAllForBase(abs);

      if (!registry.patchAllBases.includes(abs)) {
        registry.patchAllBases.push(abs);
        writeRegistry(registry);
        console.log(`Registered base: ${abs}`);
      }
      console.log(
        `Total: ${dirs} project(s), ${patched} binary patch(es). Registered bases: ${registry.patchAllBases.length}.`,
      );
      return;
    }

    // No args: run against all registered bases
    if (registry.patchAllBases.length === 0) {
      console.log(
        "No registered bases. Run 'node-queue patch-all --base <dir>' first.",
      );
      return;
    }

    console.log(
      `Re-running patch-all against ${registry.patchAllBases.length} registered base(s)...\n`,
    );
    let totalDirs = 0;
    let totalPatched = 0;
    for (const base of registry.patchAllBases) {
      if (!existsSync(base)) {
        console.log(`  (skipping missing base: ${base})\n`);
        continue;
      }
      console.log(`=== ${base} ===`);
      const { dirs, patched } = runPatchAllForBase(base);
      totalDirs += dirs;
      totalPatched += patched;
    }
    console.log(
      `Total: ${totalDirs} project(s), ${totalPatched} binary patch(es) across ${registry.patchAllBases.length} base(s).`,
    );
  });

program.parse();
