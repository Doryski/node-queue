/**
 * Shim that intercepts node-based commands and queues them
 * through the daemon when CPU is high.
 *
 * This file is compiled by esbuild with TARGET_BINARY replaced.
 * Designed to be minimal for fast startup.
 */

import { connect, type Socket } from "net";
import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// Will be replaced by esbuild define
declare const TARGET_BINARY: string;

const SOCKET_PATH = join(homedir(), ".node-queue", "daemon.sock");
const DEFAULT_TIMEOUT = 60000;
const ENV_BYPASS = "NODE_QUEUE_BYPASS";
const ENV_TIMEOUT = "NODE_QUEUE_TIMEOUT";
const ENV_DEBUG = "NODE_QUEUE_DEBUG";
const ENV_LOCAL_BIN = "NODE_QUEUE_LOCAL_BIN"; // Set by wrapper scripts in node_modules/.bin

const debug = process.env[ENV_DEBUG] === "1";
const log = debug ? console.error.bind(console, "[shim]") : () => {};

/**
 * Find the real binary, skipping our shim directory.
 * Checks NODE_QUEUE_LOCAL_BIN first (set by project wrappers).
 */
function findRealBinary(): string | null {
  // Check for local binary path (set by node_modules/.bin wrappers)
  const localBin = process.env[ENV_LOCAL_BIN];
  if (localBin) {
    try {
      execSync(`test -x "${localBin}"`, { stdio: "ignore" });
      log(`Using local binary: ${localBin}`);
      return localBin;
    } catch {
      log(`Local binary not found: ${localBin}`);
    }
  }

  const shimDir = join(homedir(), ".node-queue", "bin");
  const pathDirs = (process.env["PATH"] || "")
    .split(":")
    .filter((dir) => dir !== shimDir && !dir.includes(".node-queue/bin"));

  for (const dir of pathDirs) {
    const fullPath = `${dir}/${TARGET_BINARY}`;
    try {
      execSync(`test -x "${fullPath}"`, { stdio: "ignore" });
      return fullPath;
    } catch {
      // Not found
    }
  }

  // Fallback
  try {
    const result = execSync(`which -a ${TARGET_BINARY} 2>/dev/null || true`, {
      encoding: "utf8",
    });
    const paths = result.trim().split("\n").filter(Boolean);
    for (const p of paths) {
      if (!p.includes(".node-queue/bin")) {
        return p;
      }
    }
  } catch {
    // Failed
  }

  return null;
}

/**
 * Build a filtered environment to avoid "Argument list too long" errors.
 * Keeps essential vars and limits PATH length.
 */
function buildFilteredEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  // Essential variables to keep
  const keepVars = [
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "TERM",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "NODE_OPTIONS",
    "NODE_PATH",
    "NPM_CONFIG_PREFIX",
    "NVM_DIR",
    "NVM_BIN",
    "CI",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "EDITOR",
    "VISUAL",
    "PAGER",
    // Pass through NODE_QUEUE vars
    "NODE_QUEUE_BYPASS",
    "NODE_QUEUE_TIMEOUT",
    "NODE_QUEUE_DEBUG",
  ];

  for (const key of keepVars) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }

  return env;
}

/**
 * Run the binary directly (fallback mode)
 */
function runDirect(binaryPath: string, args: string[]) {
  log(`Running directly: ${binaryPath} ${args.join(" ")}`);

  const child = spawn(binaryPath, args, {
    stdio: "inherit",
    env: buildFilteredEnv(),
    cwd: process.cwd(),
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });

  child.on("error", (err) => {
    console.error(`Failed to run ${TARGET_BINARY}: ${err.message}`);
    process.exit(1);
  });

  // Forward signals to child
  const forwardSignal = (signal: NodeJS.Signals) => {
    child.kill(signal);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
}

/**
 * Connect to daemon and request execution slot
 */
function connectToDaemon(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout =
      parseInt(process.env[ENV_TIMEOUT] || "", 10) || DEFAULT_TIMEOUT;

    const socket: Socket = connect(SOCKET_PATH);
    let buffer = "";

    const timeoutId = setTimeout(() => {
      clearTimeout(timeoutId);
      socket.destroy();
      reject(new Error("Timeout waiting for execution slot"));
    }, timeout);

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.destroy();
    };

    socket.on("connect", () => {
      log("Connected to daemon");

      // Build minimal env (filter out large/sensitive vars)
      const env: Record<string, string> = {};
      const keepVars = [
        "PATH",
        "HOME",
        "USER",
        "SHELL",
        "TERM",
        "NODE_ENV",
        "CI",
      ];
      for (const key of keepVars) {
        if (process.env[key]) {
          env[key] = process.env[key]!;
        }
      }

      const request = {
        type: "queue",
        args,
        cwd: process.cwd(),
        env,
        targetBinary: TARGET_BINARY,
        localBinaryPath: process.env[ENV_LOCAL_BIN] || undefined,
      };

      socket.write(JSON.stringify(request) + "\n");
    });

    socket.on("data", (data) => {
      buffer += data.toString();

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const response = JSON.parse(line) as {
            type: string;
            realBinaryPath?: string;
            position?: number;
            id?: string;
            reason?: string;
            message?: string;
          };

          if (response.type === "go" && response.realBinaryPath) {
            log(`Got GO signal, running: ${response.realBinaryPath}`);
            cleanup();
            resolve(response.realBinaryPath);
          } else if (response.type === "queued") {
            log(`Queued at position ${response.position} (id=${response.id})`);
            // Keep waiting
          } else if (response.type === "rejected") {
            cleanup();
            reject(new Error(`Rejected: ${response.reason ?? "unknown"}`));
          } else if (response.type === "error") {
            cleanup();
            reject(new Error(`Daemon error: ${response.message ?? "unknown"}`));
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log(`Failed to parse response: ${errMsg}`);
        }
      }
    });

    socket.on("error", (err) => {
      cleanup();
      reject(err);
    });

    socket.on("close", () => {
      cleanup();
      reject(new Error("Connection closed"));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  // Check bypass
  if (process.env[ENV_BYPASS] === "1") {
    log("Bypass enabled, running directly");
    const realPath = findRealBinary();
    if (!realPath) {
      console.error(`Cannot find ${TARGET_BINARY} in PATH`);
      process.exit(1);
    }
    runDirect(realPath, args);
    return;
  }

  // Check if daemon is running
  if (!existsSync(SOCKET_PATH)) {
    log("Daemon not running, running directly");
    const realPath = findRealBinary();
    if (!realPath) {
      console.error(`Cannot find ${TARGET_BINARY} in PATH`);
      process.exit(1);
    }
    runDirect(realPath, args);
    return;
  }

  try {
    const binaryPath = await connectToDaemon(args);
    runDirect(binaryPath, args);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`Daemon connection failed: ${errMsg}, running directly`);
    const realPath = findRealBinary();
    if (!realPath) {
      console.error(`Cannot find ${TARGET_BINARY} in PATH`);
      process.exit(1);
    }
    runDirect(realPath, args);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Shim error: ${message}`);
  process.exit(1);
});
