import { describe, it, expect, afterEach } from "vitest";
import { measureCpuStats, createCpuMonitor } from "../cpuMonitor.js";

describe("measureCpuStats", () => {
  it("returns CPU stats with expected properties", async () => {
    // Use short interval for faster tests
    const stats = await measureCpuStats(100);

    expect(stats).toHaveProperty("overall");
    expect(stats).toHaveProperty("system");
    expect(stats).toHaveProperty("user");
    expect(stats).toHaveProperty("idle");

    // Values should be percentages (0-100 range)
    expect(stats.overall).toBeGreaterThanOrEqual(0);
    expect(stats.overall).toBeLessThanOrEqual(100);
    expect(stats.system).toBeGreaterThanOrEqual(0);
    expect(stats.system).toBeLessThanOrEqual(100);
    expect(stats.user).toBeGreaterThanOrEqual(0);
    expect(stats.user).toBeLessThanOrEqual(100);
    expect(stats.idle).toBeGreaterThanOrEqual(0);
    expect(stats.idle).toBeLessThanOrEqual(100);

    // Overall should be approximately user + system
    expect(stats.overall).toBeCloseTo(stats.user + stats.system, 0);
  });
});

describe("createCpuMonitor", () => {
  let monitor: ReturnType<typeof createCpuMonitor>;

  afterEach(() => {
    if (monitor) {
      monitor.stop();
    }
  });

  it("starts and stops correctly", async () => {
    monitor = createCpuMonitor(100);

    expect(monitor.isRunning()).toBe(false);

    await monitor.start();
    expect(monitor.isRunning()).toBe(true);

    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it("returns cached stats without blocking", async () => {
    monitor = createCpuMonitor(100);
    await monitor.start();

    // Should return cached stats immediately
    const stats = monitor.getStats();
    expect(stats).toHaveProperty("overall");
    expect(stats).toHaveProperty("system");
    expect(stats).toHaveProperty("user");
    expect(stats).toHaveProperty("idle");
  });

  it("handles multiple start calls gracefully", async () => {
    monitor = createCpuMonitor(100);

    await monitor.start();
    await monitor.start(); // Should not throw

    expect(monitor.isRunning()).toBe(true);
  });

  it("handles stop when not running", () => {
    monitor = createCpuMonitor(100);

    // Should not throw
    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });
});
