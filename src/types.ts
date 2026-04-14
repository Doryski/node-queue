/**
 * Shared types for the Node Process Queue system
 */

export type QueuedProcess = {
  id: string;
  socket: import("net").Socket;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timestamp: number;
  targetBinary: string;
  localBinaryPath?: string; // Set by project wrappers
};

export type CpuStats = {
  overall: number; // Overall CPU usage percentage (0-100)
  system: number; // System (kernel) CPU percentage (0-100)
  user: number; // User CPU percentage (0-100)
  idle: number; // Idle percentage (0-100)
};

export type QueueThresholds = {
  maxOverallCpu: number; // Max overall CPU % before queueing
  maxSystemCpu: number; // Max system CPU % before queueing
};

export type DaemonConfig = {
  socketPath: string;
  logPath: string;
  pidFile: string;
  thresholds: QueueThresholds;
  shimTimeout: number; // ms to wait for slot
  pollInterval: number; // ms between CPU checks
  maxQueueSize: number; // reject if queue exceeds
};

export type SessionMetrics = {
  totalQueued: number;
  totalProcessed: number;
  totalRejected: number;
  totalTimedOut: number;
  totalWaitTimeMs: number;
  peakQueueDepth: number;
  startTime: number;
};

// Messages between shim and daemon
export type ShimRequest = {
  type: "queue";
  args: string[];
  cwd: string;
  env: Record<string, string>;
  targetBinary: string;
  localBinaryPath?: string; // Set by project wrappers
};

export type DaemonResponse =
  | { type: "queued"; id: string; position: number }
  | { type: "go"; realBinaryPath: string }
  | { type: "rejected"; reason: string }
  | { type: "error"; message: string };

export type StatusResponse = {
  queueLength: number;
  queuedProcesses: Array<{
    id: string;
    targetBinary: string;
    waitingMs: number;
  }>;
  cpuStats: CpuStats;
  metrics: SessionMetrics;
  thresholds: QueueThresholds;
};
