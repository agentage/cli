import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The pid of each daemon whose config folder is under root (Linux /proc; elsewhere none).
const daemonsUnder = (root: string): number[] => {
  let pids: string[] = [];
  try {
    pids = readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  return pids.map(Number).filter((pid) => {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
      const config = env.find((e) => e.startsWith('AGENTAGE_CONFIG_DIR='))?.slice(20) ?? '';
      return args.includes('daemon') && args.includes('run') && config.startsWith(root);
    } catch {
      return false;
    }
  });
};

// One temp folder per test run: every test's own temp folders go under it, and teardown stops any
// daemon a test left there, then deletes it all, so a run leaves nothing in the system temp.
export default function setup(): () => void {
  const root = mkdtempSync(join(tmpdir(), 'agentage-run-'));
  process.env['TMPDIR'] = root;
  return () => {
    for (const pid of daemonsUnder(root)) process.kill(pid, 'SIGKILL');
    rmSync(root, { recursive: true, force: true });
  };
}
