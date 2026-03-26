import { type Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig, type DaemonConfig } from '../daemon/config.js';

const flattenConfig = (
  obj: Record<string, unknown>,
  prefix = ''
): Array<{ key: string; value: string }> => {
  const entries: Array<{ key: string; value: string }> = [];

  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;

    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      entries.push(...flattenConfig(v as Record<string, unknown>, key));
    } else {
      entries.push({ key, value: Array.isArray(v) ? JSON.stringify(v) : String(v) });
    }
  }

  return entries;
};

const setNestedValue = (obj: Record<string, unknown>, path: string, value: string): void => {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastKey = parts[parts.length - 1]!;

  // Try to parse as number or boolean
  if (value === 'true') {
    current[lastKey] = true;
  } else if (value === 'false') {
    current[lastKey] = false;
  } else if (/^\d+$/.test(value)) {
    current[lastKey] = parseInt(value, 10);
  } else {
    current[lastKey] = value;
  }
};

export const registerConfig = (program: Command): void => {
  const cmd = program.command('config').description('View and update configuration');

  cmd
    .command('list')
    .description('List all configuration values')
    .option('--json', 'JSON output')
    .action((opts: { json?: boolean }) => {
      const config = loadConfig();

      if (opts.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      const entries = flattenConfig(config as unknown as Record<string, unknown>);
      for (const { key, value } of entries) {
        console.log(`${chalk.bold(key)}=${value}`);
      }
    });

  cmd
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', 'Config key (dot notation: daemon.port, hub.url)')
    .argument('<value>', 'Value to set')
    .action((key: string, value: string) => {
      const config = loadConfig();
      setNestedValue(config as unknown as Record<string, unknown>, key, value);
      saveConfig(config as DaemonConfig);
      console.log(chalk.green(`Set ${key}=${value}`));
    });
};
