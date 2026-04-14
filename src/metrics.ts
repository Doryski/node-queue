import type { SessionMetrics } from "./types.js";

/**
 * Session-scoped metrics tracker (cleared on daemon restart)
 */
export function createMetricsTracker() {
  const metrics: SessionMetrics = {
    totalQueued: 0,
    totalProcessed: 0,
    totalRejected: 0,
    totalTimedOut: 0,
    totalWaitTimeMs: 0,
    peakQueueDepth: 0,
    startTime: Date.now(),
  };

  const recordQueued = (currentQueueSize: number) => {
    metrics.totalQueued++;
    metrics.peakQueueDepth = Math.max(metrics.peakQueueDepth, currentQueueSize);
  };

  const recordProcessed = (waitTimeMs: number) => {
    metrics.totalProcessed++;
    metrics.totalWaitTimeMs += waitTimeMs;
  };

  const recordRejected = () => {
    metrics.totalRejected++;
  };

  const recordTimedOut = () => {
    metrics.totalTimedOut++;
  };

  const getMetrics = (): SessionMetrics => ({ ...metrics });

  const getAverageWaitTime = (): number => {
    if (metrics.totalProcessed === 0) return 0;
    return metrics.totalWaitTimeMs / metrics.totalProcessed;
  };

  const getUptime = (): number => {
    return Date.now() - metrics.startTime;
  };

  const reset = () => {
    metrics.totalQueued = 0;
    metrics.totalProcessed = 0;
    metrics.totalRejected = 0;
    metrics.totalTimedOut = 0;
    metrics.totalWaitTimeMs = 0;
    metrics.peakQueueDepth = 0;
    metrics.startTime = Date.now();
  };

  return {
    recordQueued,
    recordProcessed,
    recordRejected,
    recordTimedOut,
    getMetrics,
    getAverageWaitTime,
    getUptime,
    reset,
  };
}

export type MetricsTracker = ReturnType<typeof createMetricsTracker>;
