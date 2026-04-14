import { createServer, type Socket } from "net";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  appendFileSync,
} from "fs";
import { dirname } from "path";
import { execSync } from "child_process";
import {
  config,
  NODE_QUEUE_DIR_PATH,
  type InterceptedBinary,
} from "./config.js";
import { createProcessQueue } from "./queue.js";
import { createCpuMonitor } from "./cpuMonitor.js";
import { createMetricsTracker } from "./metrics.js";
import type {
  ShimRequest,
  DaemonResponse,
  QueuedProcess,
  StatusResponse,
  CpuStats,
} from "./types.js";

let idCounter = 0;
const generateId = () => `proc-${++idCounter}-${Date.now()}`;

// Only console.log when running in foreground terminal (otherwise stdout may be /dev/null or redirected to same log file)
const isRunningInTerminal = process.stdout.isTTY;

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}`;
  if (isRunningInTerminal) {
    console.log(logLine);
  }
  try {
    appendFileSync(config.logPath, logLine + "\n");
  } catch {
    // Ignore log write errors
  }
}

function logError(message: string) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ERROR: ${message}`;
  if (isRunningInTerminal) {
    console.error(logLine);
  }
  try {
    appendFileSync(config.logPath, logLine + "\n");
  } catch {
    // Ignore log write errors
  }
}

/**
 * Shorten a path for logging (show last 3 path components)
 */
function shortPath(fullPath: string): string {
  const parts = fullPath.split("/").filter(Boolean);
  if (parts.length <= 3) return fullPath;
  return parts.slice(-3).join("/");
}

/**
 * Finds the real binary path, skipping the shim directory
 */
function findRealBinary(binaryName: string): string | null {
  try {
    // Get PATH, filter out our shim directory
    const shimDir = `${NODE_QUEUE_DIR_PATH}/bin`;
    const pathDirs = (process.env["PATH"] || "")
      .split(":")
      .filter((dir) => dir !== shimDir && !dir.includes(".node-queue/bin"));

    for (const dir of pathDirs) {
      const fullPath = `${dir}/${binaryName}`;
      try {
        // Check if file exists and is executable
        execSync(`test -x "${fullPath}"`, { stdio: "ignore" });
        return fullPath;
      } catch {
        // Not found in this directory
      }
    }

    // Fallback: use 'which' but filter results
    const result = execSync(`which -a ${binaryName} 2>/dev/null || true`, {
      encoding: "utf8",
    });
    const paths = result.trim().split("\n").filter(Boolean);
    for (const p of paths) {
      if (!p.includes(".node-queue/bin")) {
        return p;
      }
    }
  } catch {
    // Failed to find binary
  }
  return null;
}

function shouldAllowProcess(cpuStats: CpuStats): boolean {
  return (
    cpuStats.overall < config.thresholds.maxOverallCpu &&
    cpuStats.system < config.thresholds.maxSystemCpu
  );
}

function sendResponse(socket: Socket, response: DaemonResponse) {
  try {
    socket.write(JSON.stringify(response) + "\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`Failed to send response: ${message}`);
  }
}

export async function startDaemon() {
  // Ensure directory exists
  if (!existsSync(NODE_QUEUE_DIR_PATH)) {
    mkdirSync(NODE_QUEUE_DIR_PATH, { recursive: true });
  }

  // Remove stale socket if exists
  if (existsSync(config.socketPath)) {
    try {
      unlinkSync(config.socketPath);
    } catch {
      logError("Failed to remove stale socket file");
      process.exit(1);
    }
  }

  const queue = createProcessQueue(config.maxQueueSize);
  const cpuMonitor = createCpuMonitor(config.pollInterval);
  const metrics = createMetricsTracker();
  const connectedSockets = new Set<Socket>();

  // Start CPU monitoring
  await cpuMonitor.start();
  log("CPU monitor started");

  // Process queue when CPU is low
  let processingQueue = false;
  const processQueue = () => {
    if (processingQueue || queue.isEmpty()) return;
    processingQueue = true;

    const cpuStats = cpuMonitor.getStats();

    if (!queue.isEmpty() && shouldAllowProcess(cpuStats)) {
      const next = queue.dequeue();
      if (!next) return;

      const waitTime = Date.now() - next.timestamp;
      metrics.recordProcessed(waitTime);

      // Use localBinaryPath if provided (from project wrappers), otherwise find via PATH
      const realPath =
        next.localBinaryPath || findRealBinary(next.targetBinary);
      if (!realPath) {
        sendResponse(next.socket, {
          type: "error",
          message: `Cannot find real binary for ${next.targetBinary}`,
        });
        return;
      }

      log(
        `GO: ${next.targetBinary} [${shortPath(next.cwd)}] (id=${next.id}, waited=${waitTime}ms, cpu=${cpuStats.overall.toFixed(1)}%)`,
      );
      sendResponse(next.socket, { type: "go", realBinaryPath: realPath });
    }

    processingQueue = false;
  };

  // Check queue periodically
  const queueInterval = setInterval(processQueue, config.pollInterval);

  const server = createServer((socket) => {
    connectedSockets.add(socket);
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();

      // Handle newline-delimited JSON
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request = JSON.parse(line) as ShimRequest | { type: "status" };

          if (request.type === "status") {
            // Status request
            const cpuStats = cpuMonitor.getStats();
            const statusResponse: StatusResponse = {
              queueLength: queue.size(),
              queuedProcesses: queue.getAll().map((p) => ({
                id: p.id,
                targetBinary: p.targetBinary,
                waitingMs: Date.now() - p.timestamp,
              })),
              cpuStats,
              metrics: metrics.getMetrics(),
              thresholds: config.thresholds,
            };
            socket.write(JSON.stringify(statusResponse) + "\n");
            return;
          }

          if (request.type === "queue") {
            const cpuStats = cpuMonitor.getStats();

            // If CPU is low enough, let it run immediately
            if (queue.isEmpty() && shouldAllowProcess(cpuStats)) {
              // Use localBinaryPath if provided (from project wrappers), otherwise find via PATH
              const realPath =
                request.localBinaryPath || findRealBinary(request.targetBinary);
              if (!realPath) {
                sendResponse(socket, {
                  type: "error",
                  message: `Cannot find real binary for ${request.targetBinary}`,
                });
                return;
              }

              log(
                `IMMEDIATE: ${request.targetBinary} [${shortPath(request.cwd)}] (cpu=${cpuStats.overall.toFixed(1)}%)`,
              );
              sendResponse(socket, { type: "go", realBinaryPath: realPath });
              return;
            }

            // Queue the process
            const id = generateId();
            const queuedProcess: QueuedProcess = {
              id,
              socket,
              args: request.args,
              cwd: request.cwd,
              env: request.env,
              timestamp: Date.now(),
              targetBinary: request.targetBinary as InterceptedBinary,
              localBinaryPath: request.localBinaryPath,
            };

            if (!queue.enqueue(queuedProcess)) {
              metrics.recordRejected();
              sendResponse(socket, {
                type: "rejected",
                reason: "Queue is full",
              });
              return;
            }

            metrics.recordQueued(queue.size());
            const position = queue.getPosition(id);

            log(
              `QUEUED: ${request.targetBinary} [${shortPath(request.cwd)}] (id=${id}, position=${position}, cpu=${cpuStats.overall.toFixed(1)}%)`,
            );
            sendResponse(socket, { type: "queued", id, position });
          }
        } catch (err) {
          const errMessage = err instanceof Error ? err.message : String(err);
          logError(`Failed to parse request: ${errMessage}`);
          sendResponse(socket, { type: "error", message: "Invalid request" });
        }
      }
    });

    socket.on("close", () => {
      connectedSockets.delete(socket);
      // Remove any queued processes for this socket
      const all = queue.getAll();
      for (const p of all) {
        if (p.socket === socket) {
          queue.remove(p.id);
          log(`DISCONNECTED: ${p.targetBinary} (id=${p.id})`);
        }
      }
    });

    socket.on("error", (err) => {
      logError(`Socket error: ${err.message}`);
      connectedSockets.delete(socket);
    });
  });

  // Graceful shutdown
  const shutdown = () => {
    log("Shutting down daemon...");

    clearInterval(queueInterval);
    cpuMonitor.stop();

    // Close all client connections
    for (const socket of connectedSockets) {
      socket.destroy();
    }
    connectedSockets.clear();

    server.close(() => {
      // Remove socket file
      try {
        unlinkSync(config.socketPath);
      } catch {
        // Ignore
      }

      // Remove PID file
      try {
        unlinkSync(config.pidFile);
      } catch {
        // Ignore
      }

      const sessionMetrics = metrics.getMetrics();
      log(
        `Session stats: queued=${sessionMetrics.totalQueued}, processed=${sessionMetrics.totalProcessed}, rejected=${sessionMetrics.totalRejected}, avgWait=${metrics.getAverageWaitTime().toFixed(0)}ms, peakQueue=${sessionMetrics.peakQueueDepth}`,
      );
      log("Daemon stopped");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Ensure directory exists for socket
  const socketDir = dirname(config.socketPath);
  if (!existsSync(socketDir)) {
    mkdirSync(socketDir, { recursive: true });
  }

  server.listen(config.socketPath, () => {
    // Write PID file
    writeFileSync(config.pidFile, String(process.pid));

    log(`Daemon started (pid=${process.pid})`);
    log(`Socket: ${config.socketPath}`);
    log(
      `Thresholds: overall=${config.thresholds.maxOverallCpu}%, system=${config.thresholds.maxSystemCpu}%`,
    );
    log(`Poll interval: ${config.pollInterval}ms`);
  });

  server.on("error", (err) => {
    logError(`Server error: ${err.message}`);
    process.exit(1);
  });
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startDaemon().catch((err) => {
    console.error("Failed to start daemon:", err);
    process.exit(1);
  });
}
