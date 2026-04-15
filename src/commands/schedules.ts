import { type Command } from 'commander';
import chalk from 'chalk';
import { Cron } from 'croner';
import { ensureDaemon } from '../utils/ensure-daemon.js';
import { get, post, request } from '../utils/daemon-client.js';
import { loadConfig } from '../daemon/config.js';

interface ScheduleRow {
  id: string;
  name: string;
  agent_name: string;
  machine_id: string;
  cron: string | null;
  timezone: string;
  enabled: boolean;
  next_fire_at: string;
  last_fired_at: string | null;
}

const COMMON_PRESETS: Record<string, string> = {
  hourly: '0 * * * *',
  daily: '0 9 * * *',
  weekdays: '0 9 * * 1-5',
  weekly: '0 9 * * 1',
};

const truncate = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

const formatTime = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
};

const printList = (schedules: ScheduleRow[]): void => {
  if (schedules.length === 0) {
    console.log(chalk.gray('No schedules.'));
    return;
  }
  const idW = 10;
  const nameW = Math.max(8, ...schedules.map((s) => Math.min(s.name.length, 30))) + 2;
  const cronW = Math.max(8, ...schedules.map((s) => (s.cron ?? '').length)) + 2;
  console.log(
    chalk.bold('ID'.padEnd(idW)) +
      chalk.bold('NAME'.padEnd(nameW)) +
      chalk.bold('CRON'.padEnd(cronW)) +
      chalk.bold('TZ'.padEnd(20)) +
      chalk.bold('ENABLED'.padEnd(10)) +
      chalk.bold('NEXT FIRE')
  );
  for (const s of schedules) {
    const enabled = s.enabled ? chalk.green('yes') : chalk.gray('no');
    console.log(
      s.id.slice(0, 8).padEnd(idW) +
        truncate(s.name, nameW - 2).padEnd(nameW) +
        (s.cron ?? '—').padEnd(cronW) +
        s.timezone.padEnd(20) +
        enabled.padEnd(10 + (enabled.length - 'no'.length)) +
        formatTime(s.next_fire_at)
    );
  }
  console.log(chalk.dim(`\n${schedules.length} schedule(s)`));
};

const findById = async (idPrefix: string): Promise<ScheduleRow> => {
  const all = await get<ScheduleRow[]>('/api/hub/schedules');
  const matches = all.filter((s) => s.id.startsWith(idPrefix));
  if (matches.length === 0) {
    throw new Error(`No schedule matches id prefix "${idPrefix}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous id prefix "${idPrefix}" — matches ${matches.length}: ${matches.map((m) => m.id.slice(0, 12)).join(', ')}`
    );
  }
  return matches[0]!;
};

export const registerSchedules = (program: Command): void => {
  const root = program.command('schedules').description('Manage scheduled agent runs');

  root
    .command('list', { isDefault: true })
    .description('List your schedules')
    .option('--machine <name>', 'Filter to one machine')
    .option('--enabled', 'Show only enabled schedules')
    .option('--disabled', 'Show only disabled schedules')
    .option('--json', 'JSON output')
    .action(
      async (opts: { machine?: string; enabled?: boolean; disabled?: boolean; json?: boolean }) => {
        await ensureDaemon();
        const params = new URLSearchParams();
        if (opts.machine) params.set('machine', opts.machine);
        if (opts.enabled) params.set('enabled', 'true');
        if (opts.disabled) params.set('enabled', 'false');
        const qs = params.toString();
        const schedules = await get<ScheduleRow[]>(`/api/hub/schedules${qs ? `?${qs}` : ''}`);
        if (opts.json) {
          console.log(JSON.stringify(schedules, null, 2));
          return;
        }
        printList(schedules);
      }
    );

  root
    .command('add <agent> <cron>')
    .description(
      'Create a schedule on the current machine. Use a preset (hourly|daily|weekdays|weekly) or 5-field cron.'
    )
    .option('--machine <id>', 'Override target machine ID (default: this daemon)')
    .option('--timezone <tz>', 'IANA timezone (default: machine TZ)')
    .option('--name <name>', 'Schedule name')
    .option('--task <task>', 'Task text passed to the agent as input.task')
    .option('--json', 'JSON output')
    .action(
      async (
        agentName: string,
        cron: string,
        opts: { machine?: string; timezone?: string; name?: string; task?: string; json?: boolean }
      ) => {
        await ensureDaemon();
        const cronExpr = COMMON_PRESETS[cron] ?? cron;
        const config = loadConfig();
        const machineId = opts.machine ?? config.machine.id;
        const body: Record<string, unknown> = {
          machineId,
          agentName,
          cron: cronExpr,
          timezone: opts.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        if (opts.name) body.name = opts.name;
        if (opts.task) body.input = { task: opts.task };
        const created = await post<ScheduleRow>('/api/hub/schedules', body);
        if (opts.json) {
          console.log(JSON.stringify(created, null, 2));
          return;
        }
        console.log(chalk.green(`Created schedule ${created.id.slice(0, 8)}: ${created.name}`));
        console.log(chalk.dim(`Next fire: ${formatTime(created.next_fire_at)}`));
      }
    );

  root
    .command('enable <id>')
    .description('Enable a schedule (id prefix accepted)')
    .action(async (idPrefix: string) => {
      await ensureDaemon();
      const s = await findById(idPrefix);
      await request<unknown>('PATCH', `/api/hub/schedules/${s.id}`, { enabled: true });
      console.log(chalk.green(`Enabled ${s.id.slice(0, 8)}: ${s.name}`));
    });

  root
    .command('disable <id>')
    .description('Disable a schedule (id prefix accepted)')
    .action(async (idPrefix: string) => {
      await ensureDaemon();
      const s = await findById(idPrefix);
      await request<unknown>('PATCH', `/api/hub/schedules/${s.id}`, { enabled: false });
      console.log(chalk.yellow(`Disabled ${s.id.slice(0, 8)}: ${s.name}`));
    });

  root
    .command('remove <id>')
    .alias('rm')
    .description('Delete a schedule (id prefix accepted)')
    .action(async (idPrefix: string) => {
      await ensureDaemon();
      const s = await findById(idPrefix);
      await request<unknown>('DELETE', `/api/hub/schedules/${s.id}`);
      console.log(chalk.red(`Deleted ${s.id.slice(0, 8)}: ${s.name}`));
    });

  root
    .command('run-now <id>')
    .description('Fire a schedule once (outside its cadence)')
    .action(async (idPrefix: string) => {
      await ensureDaemon();
      const s = await findById(idPrefix);
      const result = await post<{ runId: string }>(`/api/hub/schedules/${s.id}/run-now`);
      console.log(chalk.green(`Fired ${s.id.slice(0, 8)} → run ${result.runId.slice(0, 8)}`));
    });

  root
    .command('next <id>')
    .description('Print the next 5 fire times (computed locally from cron + tz)')
    .action(async (idPrefix: string) => {
      await ensureDaemon();
      const s = await findById(idPrefix);
      if (!s.cron) {
        console.error(chalk.red('Schedule has no cron expression'));
        process.exitCode = 1;
        return;
      }
      try {
        const c = new Cron(s.cron, { timezone: s.timezone });
        let prev: Date | null = c.nextRun();
        for (let i = 0; i < 5 && prev; i += 1) {
          console.log(prev.toLocaleString(undefined, { timeZone: s.timezone }));
          prev = c.nextRun(prev);
        }
      } catch (err) {
        console.error(
          chalk.red(`Invalid cron: ${err instanceof Error ? err.message : String(err)}`)
        );
        process.exitCode = 1;
      }
    });
};
