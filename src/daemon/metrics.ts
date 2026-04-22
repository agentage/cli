import { cpus, totalmem, freemem, homedir, loadavg, platform } from 'node:os';
import { statfs } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

export interface MachineMetrics {
  cpuUsage: number;
  cpuCount: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskUsedMb?: number;
  diskTotalMb?: number;
  loadAvg1m?: number;
  loadAvg5m?: number;
  loadAvg15m?: number;
}

const BYTES_PER_MB = 1024 * 1024;

interface CpuSnapshot {
  idle: number;
  total: number;
}

const takeCpuSnapshot = (): CpuSnapshot => {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    for (const time of Object.values(cpu.times)) total += time;
    idle += cpu.times.idle;
  }
  return { idle, total };
};

const sampleCpuUsage = async (windowMs = 200): Promise<number> => {
  const a = takeCpuSnapshot();
  await sleep(windowMs);
  const b = takeCpuSnapshot();
  const dTotal = b.total - a.total;
  const dIdle = b.idle - a.idle;
  if (dTotal <= 0) return 0;
  const busy = 1 - dIdle / dTotal;
  return Math.max(0, Math.min(100, busy * 100));
};

const collectDiskUsage = async (): Promise<Pick<MachineMetrics, 'diskUsedMb' | 'diskTotalMb'>> => {
  try {
    const stats = await statfs(homedir());
    const totalBytes = Number(stats.blocks) * stats.bsize;
    const freeBytes = Number(stats.bavail) * stats.bsize;
    return {
      diskUsedMb: Math.round((totalBytes - freeBytes) / BYTES_PER_MB),
      diskTotalMb: Math.round(totalBytes / BYTES_PER_MB),
    };
  } catch {
    return {};
  }
};

const collectLoadAvg = (): Pick<MachineMetrics, 'loadAvg1m' | 'loadAvg5m' | 'loadAvg15m'> => {
  // node returns [0, 0, 0] on Windows — omit to let UI hide the card.
  if (platform() === 'win32') return {};
  const [one, five, fifteen] = loadavg();
  return {
    loadAvg1m: Number(one.toFixed(2)),
    loadAvg5m: Number(five.toFixed(2)),
    loadAvg15m: Number(fifteen.toFixed(2)),
  };
};

export const collectMachineMetrics = async (): Promise<MachineMetrics> => {
  const [cpuUsage, disk] = await Promise.all([sampleCpuUsage(), collectDiskUsage()]);
  const totalMem = totalmem();
  const freeMem = freemem();
  return {
    cpuUsage: Number(cpuUsage.toFixed(1)),
    cpuCount: cpus().length,
    memoryUsedMb: Math.round((totalMem - freeMem) / BYTES_PER_MB),
    memoryTotalMb: Math.round(totalMem / BYTES_PER_MB),
    ...disk,
    ...collectLoadAvg(),
  };
};
