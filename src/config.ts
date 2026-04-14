import { homedir } from "os";
import { join } from "path";
import type { DaemonConfig } from "./types.js";

const NODE_QUEUE_DIR = join(homedir(), ".node-queue");

export const config: DaemonConfig = {
  socketPath: join(NODE_QUEUE_DIR, "daemon.sock"),
  logPath: join(NODE_QUEUE_DIR, "daemon.log"),
  pidFile: join(NODE_QUEUE_DIR, "daemon.pid"),
  thresholds: {
    maxOverallCpu: 50, // overall CPU usage %
    maxSystemCpu: 20, // system (kernel) CPU %
  },
  shimTimeout: 60000, // ms to wait for slot
  pollInterval: 500, // ms between CPU checks
  maxQueueSize: 100, // reject if queue exceeds
} as const;

export const NODE_QUEUE_DIR_PATH = NODE_QUEUE_DIR;
export const SHIM_BIN_DIR = join(NODE_QUEUE_DIR, "bin");

// Binaries to intercept (only test runners - avoid node/npx/pnpm which cause cascading issues)
export const INTERCEPTED_BINARIES = ["vitest", "jest", "playwright"] as const;

export type InterceptedBinary = (typeof INTERCEPTED_BINARIES)[number];

// Environment variables for configuration
export const ENV_VARS = {
  BYPASS: "NODE_QUEUE_BYPASS", // Set to "1" to skip queueing
  TIMEOUT: "NODE_QUEUE_TIMEOUT", // Custom timeout in ms
  DEBUG: "NODE_QUEUE_DEBUG", // Set to "1" for debug logging
} as const;
