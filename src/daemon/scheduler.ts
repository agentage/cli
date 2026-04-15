import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cron } from 'croner';
import { getConfigDir } from './config.js';
import { logInfo, logWarn } from './logger.js';

export interface CachedSchedule {
  id: string;
  agentName: string;
  cron: string;
  timezone: string;
  nextFireAt: string;
  missedFire: 'skip' | 'run_once';
  concurrency: 'skip' | 'queue';
}

export type FireCallback = (
  schedule: CachedSchedule
) => Promise<{ acquired: boolean; runId?: string; nextFireAt: string } | null>;

interface RegisteredJob {
  job: Cron;
  schedule: CachedSchedule;
  inFlight: boolean;
}

export interface Scheduler {
  start: () => Promise<void>;
  stop: () => void;
  reconcile: (incoming: CachedSchedule[]) => void;
  list: () => CachedSchedule[];
  getCachePath: () => string;
}

const CACHE_FILE = 'schedules.json';

const loadCache = (cachePath: string): CachedSchedule[] => {
  if (!existsSync(cachePath)) return [];
  try {
    const raw = readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as { schedules?: CachedSchedule[] };
    return Array.isArray(parsed.schedules) ? parsed.schedules : [];
  } catch (err) {
    logWarn(`Failed to read schedules cache: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
};

const saveCache = (cachePath: string, schedules: CachedSchedule[]): void => {
  try {
    writeFileSync(cachePath, JSON.stringify({ schedules }, null, 2) + '\n', 'utf-8');
  } catch (err) {
    logWarn(`Failed to write schedules cache: ${err instanceof Error ? err.message : String(err)}`);
  }
};

const sameSchedule = (a: CachedSchedule, b: CachedSchedule): boolean =>
  a.cron === b.cron &&
  a.timezone === b.timezone &&
  a.nextFireAt === b.nextFireAt &&
  a.missedFire === b.missedFire &&
  a.concurrency === b.concurrency &&
  a.agentName === b.agentName;

export const createScheduler = (fire: FireCallback): Scheduler => {
  const cachePath = join(getConfigDir(), CACHE_FILE);
  const jobs = new Map<string, RegisteredJob>();

  const fireOne = async (s: CachedSchedule): Promise<void> => {
    const reg = jobs.get(s.id);
    if (!reg) return;
    if (reg.schedule.concurrency === 'skip' && reg.inFlight) {
      logInfo(`[scheduler] skip ${s.id} — previous fire-call still in flight`);
      return;
    }
    reg.inFlight = true;
    try {
      const result = await fire(reg.schedule);
      if (!result) return;
      if (result.acquired) {
        logInfo(`[scheduler] fired ${s.id} → run ${result.runId ?? '?'}`);
      } else {
        logInfo(`[scheduler] skipped ${s.id} — CAS lost or schedule disabled`);
      }
      reg.schedule.nextFireAt = result.nextFireAt;
      saveCache(
        cachePath,
        Array.from(jobs.values()).map((j) => j.schedule)
      );
    } catch (err) {
      logWarn(
        `[scheduler] fire ${s.id} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      reg.inFlight = false;
    }
  };

  const register = (s: CachedSchedule): void => {
    try {
      const job = new Cron(s.cron, { timezone: s.timezone }, () => {
        void fireOne(s);
      });
      jobs.set(s.id, { job, schedule: { ...s }, inFlight: false });
    } catch (err) {
      logWarn(
        `[scheduler] failed to register ${s.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const unregister = (id: string): void => {
    const reg = jobs.get(id);
    if (reg) {
      reg.job.stop();
      jobs.delete(id);
    }
  };

  return {
    start: async () => {
      const cached = loadCache(cachePath);
      for (const s of cached) {
        register(s);
      }

      // Missed-fire detection: schedule fired before daemon was running.
      // Grace = one full interval to avoid replaying an overdue fire that
      // would have happened within the next tick anyway.
      const now = Date.now();
      for (const s of cached) {
        const next = new Date(s.nextFireAt).getTime();
        if (next > now) continue;
        if (s.missedFire === 'run_once') {
          logInfo(`[scheduler] missed fire detected for ${s.id} (run_once) — firing now`);
          await fireOne(s);
        } else {
          logInfo(`[scheduler] missed fire for ${s.id} — skipping per missed_fire=skip`);
        }
      }

      logInfo(`[scheduler] started with ${jobs.size} schedule(s) from cache`);
    },

    stop: () => {
      for (const reg of jobs.values()) {
        reg.job.stop();
      }
      jobs.clear();
    },

    reconcile: (incoming) => {
      const incomingIds = new Set(incoming.map((s) => s.id));

      // Remove vanished
      for (const id of jobs.keys()) {
        if (!incomingIds.has(id)) {
          unregister(id);
          logInfo(`[scheduler] unregistered ${id}`);
        }
      }

      // Add or update
      for (const s of incoming) {
        const existing = jobs.get(s.id);
        if (!existing) {
          register(s);
          logInfo(`[scheduler] registered ${s.id} (${s.cron} ${s.timezone})`);
        } else if (!sameSchedule(existing.schedule, s)) {
          unregister(s.id);
          register(s);
          logInfo(`[scheduler] re-registered ${s.id} (cron/tz/next_fire changed)`);
        }
      }

      saveCache(
        cachePath,
        Array.from(jobs.values()).map((j) => j.schedule)
      );
    },

    list: () => Array.from(jobs.values()).map((j) => ({ ...j.schedule })),
    getCachePath: () => cachePath,
  };
};

// Module-level singleton — daemon-entry initialises once
let _scheduler: Scheduler | null = null;

export const getScheduler = (fire?: FireCallback): Scheduler => {
  if (!_scheduler) {
    if (!fire) throw new Error('Scheduler not initialised; pass fire callback on first call');
    _scheduler = createScheduler(fire);
  }
  return _scheduler;
};

export const resetScheduler = (): void => {
  if (_scheduler) {
    _scheduler.stop();
    _scheduler = null;
  }
};
