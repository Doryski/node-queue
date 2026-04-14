import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createMetricsTracker } from "../metrics.js";

describe("createMetricsTracker", () => {
  let tracker: ReturnType<typeof createMetricsTracker>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:00:00.000Z"));
    tracker = createMetricsTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("recordQueued", () => {
    it("increments totalQueued count", () => {
      tracker.recordQueued(1);
      tracker.recordQueued(2);
      tracker.recordQueued(3);

      expect(tracker.getMetrics().totalQueued).toBe(3);
    });

    it("tracks peak queue depth", () => {
      tracker.recordQueued(5);
      tracker.recordQueued(3); // smaller, should not update peak
      tracker.recordQueued(10); // larger, should update peak

      expect(tracker.getMetrics().peakQueueDepth).toBe(10);
    });
  });

  describe("recordProcessed", () => {
    it("increments totalProcessed and accumulates wait time", () => {
      tracker.recordProcessed(100);
      tracker.recordProcessed(200);
      tracker.recordProcessed(300);

      const metrics = tracker.getMetrics();
      expect(metrics.totalProcessed).toBe(3);
      expect(metrics.totalWaitTimeMs).toBe(600);
    });
  });

  describe("recordRejected", () => {
    it("increments totalRejected count", () => {
      tracker.recordRejected();
      tracker.recordRejected();

      expect(tracker.getMetrics().totalRejected).toBe(2);
    });
  });

  describe("recordTimedOut", () => {
    it("increments totalTimedOut count", () => {
      tracker.recordTimedOut();
      tracker.recordTimedOut();
      tracker.recordTimedOut();

      expect(tracker.getMetrics().totalTimedOut).toBe(3);
    });
  });

  describe("getAverageWaitTime", () => {
    it("returns 0 when no processes have been processed", () => {
      expect(tracker.getAverageWaitTime()).toBe(0);
    });

    it("calculates correct average", () => {
      tracker.recordProcessed(100);
      tracker.recordProcessed(300);
      tracker.recordProcessed(200);

      expect(tracker.getAverageWaitTime()).toBe(200);
    });
  });

  describe("getUptime", () => {
    it("returns time since tracker creation", () => {
      vi.advanceTimersByTime(5000);
      expect(tracker.getUptime()).toBe(5000);

      vi.advanceTimersByTime(10000);
      expect(tracker.getUptime()).toBe(15000);
    });
  });

  describe("reset", () => {
    it("resets all metrics to initial values", () => {
      tracker.recordQueued(10);
      tracker.recordProcessed(500);
      tracker.recordRejected();
      tracker.recordTimedOut();

      vi.advanceTimersByTime(10000);
      tracker.reset();

      const metrics = tracker.getMetrics();
      expect(metrics.totalQueued).toBe(0);
      expect(metrics.totalProcessed).toBe(0);
      expect(metrics.totalRejected).toBe(0);
      expect(metrics.totalTimedOut).toBe(0);
      expect(metrics.totalWaitTimeMs).toBe(0);
      expect(metrics.peakQueueDepth).toBe(0);
      expect(tracker.getUptime()).toBe(0);
    });
  });

  describe("getMetrics", () => {
    it("returns copy of metrics (immutable)", () => {
      const metrics1 = tracker.getMetrics();
      tracker.recordQueued(5);
      const metrics2 = tracker.getMetrics();

      expect(metrics1.totalQueued).toBe(0);
      expect(metrics2.totalQueued).toBe(1);
    });
  });
});
