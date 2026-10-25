import * as fs from 'node:fs';
import * as os from 'node:os';
import { HostInfo } from '../shared/types';

// CPU temperature in °C. Linux only (Raspberry Pi and most other boards report it here).
function readCpuTemperature(): number | null {
  if (process.platform !== 'linux') return null;
  try {
    const milli = Number(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf-8').trim());
    return Number.isFinite(milli) ? Math.round(milli / 100) / 10 : null;
  } catch {
    return null;
  }
}

// Size and usage of the disk the bot's folder is on.
function readDisk(): { used: number; total: number } {
  try {
    const stats = fs.statfsSync(process.cwd());
    const total = stats.blocks * stats.bsize;
    return { total, used: total - stats.bavail * stats.bsize };
  } catch {
    return { used: 0, total: 0 };
  }
}

export function getHostInfo(): HostInfo {
  const disk = readDisk();
  return {
    cpuTemp: readCpuTemperature(),
    diskUsed: disk.used,
    diskTotal: disk.total,
    load: os.loadavg().map(n => Math.round(n * 100) / 100)
  };
}
