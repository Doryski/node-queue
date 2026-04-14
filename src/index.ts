/**
 * node-queue - CPU-based process queue daemon
 *
 * Throttles test runners (vitest, jest, playwright) to prevent system overload.
 */

// Core queue functionality
export { createProcessQueue, type ProcessQueue } from "./queue.js";

// CPU monitoring
export {
  measureCpuStats,
  createCpuMonitor,
  type CpuMonitor,
} from "./cpuMonitor.js";

// Metrics tracking
export { createMetricsTracker, type MetricsTracker } from "./metrics.js";

// Configuration
export {
  config,
  NODE_QUEUE_DIR_PATH,
  SHIM_BIN_DIR,
  INTERCEPTED_BINARIES,
  ENV_VARS,
  type InterceptedBinary,
} from "./config.js";

// Types
export type {
  QueuedProcess,
  CpuStats,
  QueueThresholds,
  DaemonConfig,
  SessionMetrics,
  ShimRequest,
  DaemonResponse,
  StatusResponse,
} from "./types.js";

// Daemon (for programmatic use)
export { startDaemon } from "./daemon.js";
