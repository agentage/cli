import chalk from 'chalk';
import { type VaultStatus } from './vaults-status.js';

const mark = (good: boolean): string => (good ? chalk.green('✓') : chalk.red('✗'));

// HH:MM in local time; a malformed timestamp falls back to the raw string so we never crash.
const shortTime = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const shortError = (err?: string): string =>
  (err ?? 'sync failed').split('\n')[0]?.slice(0, 40) ?? 'sync failed';

// One right-hand status cell per vault, sharing the check/cross marks with the other status rows.
const statusCell = (v: VaultStatus): string => {
  switch (v.status) {
    case 'ok':
      return `${mark(true)} last ok ${shortTime(v.lastRun)}`.trimEnd();
    case 'syncing':
      return `${chalk.yellow('⋯')} syncing`;
    case 'error':
      return `${mark(false)} error (${shortError(v.lastError)})`;
    case 'unknown':
      return chalk.dim('- unknown (daemon stopped)');
    case 'unsynced':
      return `${mark(false)} not synced - account vaults have no sync channel`;
    case 'idle':
      return v.channel === 'local' ? chalk.dim('- local only') : chalk.dim('- idle');
  }
};

// Only git vaults are "connected": an account vault has no sync channel, so counting it would
// re-tell the lie the per-vault row exists to correct.
const countLabel = (vaults: VaultStatus[]): string => {
  const connected = vaults.filter((v) => v.channel === 'git').length;
  if (connected > 0) return `${connected} connected`;
  const n = vaults.length;
  return `${n} ${n === 1 ? 'vault' : 'vaults'}`;
};

// The `vaults` block: a header count line then one aligned `<name> <channel> <status>` row per vault.
// Zero vaults prints a single actionable hint instead of an empty block.
export const vaultLines = (vaults: VaultStatus[]): string[] => {
  if (vaults.length === 0)
    return [`${'vaults'.padEnd(10)} none - run: agentage vault add <name> --local`];
  const nameW = Math.max(...vaults.map((v) => v.name.length));
  const chanW = Math.max(...vaults.map((v) => v.channel.length));
  const header = `${'vaults'.padEnd(10)} ${countLabel(vaults)}`;
  const rows = vaults.map(
    (v) => `  ${v.name.padEnd(nameW)}  ${v.channel.padEnd(chanW)} ${statusCell(v)}`
  );
  return [header, ...rows];
};
