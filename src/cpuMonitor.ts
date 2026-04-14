import { cpus } from "os";
import type { CpuStats } from "./types.js";

type CpuTimes = {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
};

type CpuSample = {
  user: number;
  system: number;
  idle: number;
  total: number;
};

function sumCpuTimes(cpuList: Array<{ times: CpuTimes }>): CpuSample {
  let user = 0;
  let system = 0;
  let idle = 0;

  for (const cpu of cpuList) {
    user += cpu.times.user + cpu.times.nice;
    system += cpu.times.sys + cpu.times.irq;
    idle += cpu.times.idle;
  }

  return { user, system, idle, total: user + system + idle };
}

/**
 * Measures CPU usage by sampling over an interval.
 * Returns both overall and system (kernel) CPU percentages.
 */
export async function measureCpuStats(intervalMs = 500): Promise<CpuStats> {
  // Sample 1
  const sample1 = sumCpuTimes(cpus());

  await new Promise((resolve) => setTimeout(resolve, intervalMs));

  // Sample 2
  const sample2 = sumCpuTimes(cpus());

  // Calculate deltas
  const userDelta = sample2.user - sample1.user;
  const systemDelta = sample2.system - sample1.system;
  const idleDelta = sample2.idle - sample1.idle;
  const totalDelta = sample2.total - sample1.total;

  if (totalDelta === 0) {
    return { overall: 0, system: 0, user: 0, idle: 100 };
  }

  const userPercent = (userDelta / totalDelta) * 100;
  const systemPercent = (systemDelta / totalDelta) * 100;
  const idlePercent = (idleDelta / totalDelta) * 100;
  const overallPercent = userPercent + systemPercent;

  return {
    overall: Math.round(overallPercent * 10) / 10,
    system: Math.round(systemPercent * 10) / 10,
    user: Math.round(userPercent * 10) / 10,
    idle: Math.round(idlePercent * 10) / 10,
  };
}

/**
 * Creates a continuous CPU monitor that caches the latest stats.
 * Useful for checking CPU without blocking on each measurement.
 */
export function createCpuMonitor(pollIntervalMs = 500) {
  let currentStats: CpuStats = { overall: 0, system: 0, user: 0, idle: 100 };
  let running = false;
  let intervalId: NodeJS.Timeout | null = null;

  const start = async () => {
    if (running) return;
    running = true;

    // Initial measurement
    currentStats = await measureCpuStats(pollIntervalMs);

    // Continuous polling
    const poll = async () => {
      if (!running) return;
      currentStats = await measureCpuStats(pollIntervalMs);
    };

    intervalId = setInterval(() => {
      void poll();
    }, pollIntervalMs);
  };

  const stop = () => {
    running = false;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const getStats = (): CpuStats => currentStats;

  const isRunning = () => running;

  return { start, stop, getStats, isRunning };
}

export type CpuMonitor = ReturnType<typeof createCpuMonitor>;
