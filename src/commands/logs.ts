import { type Command } from 'commander';
import { existsSync, readFileSync, watchFile, unwatchFile } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getConfigDir } from '../daemon/config.js';

export const registerLogs = (program: Command): void => {
  program
    .command('logs')
    .description('Tail daemon log')
    .option('-f, --follow', 'Live tail')
    .option('-n <lines>', 'Number of lines', '50')
    .action((opts: { follow?: boolean; n?: string }) => {
      const logPath = join(getConfigDir(), 'daemon.log');

      if (!existsSync(logPath)) {
        console.log(chalk.gray('No daemon log found.'));
        return;
      }

      const lines = parseInt(opts.n || '50', 10);
      const content = readFileSync(logPath, 'utf-8');
      const allLines = content.split('\n').filter(Boolean);
      const tail = allLines.slice(-lines);

      for (const line of tail) {
        console.log(line);
      }

      if (opts.follow) {
        let lastSize = Buffer.byteLength(content, 'utf-8');

        watchFile(logPath, { interval: 500 }, () => {
          const updated = readFileSync(logPath, 'utf-8');
          const currentSize = Buffer.byteLength(updated, 'utf-8');

          if (currentSize > lastSize) {
            const newContent = updated.slice(lastSize);
            const newLines = newContent.split('\n').filter(Boolean);
            for (const line of newLines) {
              console.log(line);
            }
            lastSize = currentSize;
          }
        });

        process.on('SIGINT', () => {
          unwatchFile(logPath);
          process.exit(0);
        });
      }
    });
};
