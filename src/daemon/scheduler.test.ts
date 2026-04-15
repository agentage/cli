import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScheduler, type CachedSchedule, type FireCallback } from './scheduler.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'scheduler-test-'));
  process.env.AGENTAGE_CONFIG_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.AGENTAGE_CONFIG_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

const sample = (overrides: Partial<CachedSchedule> = {}): CachedSchedule => ({
  id: 'sch-1',
  agentName: 'echo',
  cron: '0 9 * * *',
  timezone: 'UTC',
  nextFireAt: '2030-01-01T09:00:00.000Z',
  missedFire: 'skip',
  concurrency: 'skip',
  ...overrides,
});

describe('scheduler.reconcile', () => {
  it('registers new schedules', () => {
    const scheduler = createScheduler(vi.fn());
    scheduler.reconcile([sample({ id: 'a' }), sample({ id: 'b' })]);
    const list = scheduler.list();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.id).sort()).toEqual(['a', 'b']);
    scheduler.stop();
  });

  it('unregisters vanished schedules', () => {
    const scheduler = createScheduler(vi.fn());
    scheduler.reconcile([sample({ id: 'a' }), sample({ id: 'b' })]);
    scheduler.reconcile([sample({ id: 'a' })]);
    expect(scheduler.list().map((s) => s.id)).toEqual(['a']);
    scheduler.stop();
  });

  it('re-registers when cron/tz/next_fire changes', () => {
    const scheduler = createScheduler(vi.fn());
    scheduler.reconcile([sample({ id: 'a', cron: '0 9 * * *' })]);
    scheduler.reconcile([sample({ id: 'a', cron: '0 10 * * *' })]);
    expect(scheduler.list()[0]!.cron).toBe('0 10 * * *');
    scheduler.stop();
  });

  it('persists to cache file on reconcile', () => {
    const scheduler = createScheduler(vi.fn());
    scheduler.reconcile([sample()]);
    const cachePath = scheduler.getCachePath();
    expect(existsSync(cachePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8')) as { schedules: CachedSchedule[] };
    expect(parsed.schedules[0]!.id).toBe('sch-1');
    scheduler.stop();
  });
});

describe('scheduler.start', () => {
  it('loads cached schedules from disk', async () => {
    const cachePath = join(tmpDir, 'schedules.json');
    writeFileSync(cachePath, JSON.stringify({ schedules: [sample({ id: 'persisted' })] }));
    const scheduler = createScheduler(vi.fn());
    await scheduler.start();
    expect(scheduler.list().map((s) => s.id)).toEqual(['persisted']);
    scheduler.stop();
  });

  it('does not crash on missing cache file', async () => {
    const scheduler = createScheduler(vi.fn());
    await scheduler.start();
    expect(scheduler.list()).toEqual([]);
    scheduler.stop();
  });

  it('does not crash on corrupt cache file', async () => {
    const cachePath = join(tmpDir, 'schedules.json');
    writeFileSync(cachePath, 'not-valid-json');
    const scheduler = createScheduler(vi.fn());
    await scheduler.start();
    expect(scheduler.list()).toEqual([]);
    scheduler.stop();
  });

  it('fires missed schedules immediately when missed_fire=run_once', async () => {
    const fire = vi.fn<FireCallback>().mockResolvedValue({
      acquired: true,
      runId: 'run-1',
      nextFireAt: '2030-01-02T09:00:00.000Z',
    });
    const cachePath = join(tmpDir, 'schedules.json');
    writeFileSync(
      cachePath,
      JSON.stringify({
        schedules: [
          sample({
            id: 'overdue',
            nextFireAt: '2020-01-01T00:00:00.000Z', // in the past
            missedFire: 'run_once',
          }),
        ],
      })
    );
    const scheduler = createScheduler(fire);
    await scheduler.start();
    expect(fire).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('skips missed schedules when missed_fire=skip', async () => {
    const fire = vi.fn<FireCallback>();
    const cachePath = join(tmpDir, 'schedules.json');
    writeFileSync(
      cachePath,
      JSON.stringify({
        schedules: [
          sample({
            id: 'overdue',
            nextFireAt: '2020-01-01T00:00:00.000Z',
            missedFire: 'skip',
          }),
        ],
      })
    );
    const scheduler = createScheduler(fire);
    await scheduler.start();
    expect(fire).not.toHaveBeenCalled();
    scheduler.stop();
  });
});

describe('scheduler stop', () => {
  it('clears all jobs', () => {
    const scheduler = createScheduler(vi.fn());
    scheduler.reconcile([sample({ id: 'a' }), sample({ id: 'b' })]);
    scheduler.stop();
    expect(scheduler.list()).toEqual([]);
  });
});
