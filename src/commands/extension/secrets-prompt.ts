import { secretsFor, type SecretKey } from '../../core/loader/secrets.js';

// The one seam besides npm: a real terminal cannot run inside a test.
export interface SecretsIo {
  isTTY: boolean;
  // Reads one answer without echoing it.
  prompt: (question: string) => Promise<string>;
}

const ENTER = ['\r', '\n', '\u0004'];
const CTRL_C = '\u0003';
const BACKSPACE = '\u007f';

// One keypress: the answer so far, or null once Enter ends it.
const typed = (answer: string, char: string): string | null => {
  if (ENTER.includes(char)) return null;
  return char === BACKSPACE ? answer.slice(0, -1) : answer + char;
};

// Raw mode keeps the answer off the screen; Ctrl+C still interrupts once the terminal is restored.
const readHidden = (question: string): Promise<string> =>
  new Promise((resolve) => {
    const { stdin, stderr } = process;
    let answer = '';
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString('utf-8')) {
        const next = char === CTRL_C ? null : typed(answer, char);
        if (next === null) return finish(char === CTRL_C);
        answer = next;
      }
    };
    const finish = (interrupted: boolean): void => {
      stdin.off('data', onData).setRawMode(false).pause();
      stderr.write('\n');
      resolve(answer);
      if (interrupted) process.kill(process.pid, 'SIGINT');
    };
    stderr.write(question);
    stdin.setRawMode(true).resume().on('data', onData);
  });

const terminal = (): SecretsIo => ({ isTTY: process.stdin.isTTY === true, prompt: readHidden });

const nameOf = ({ id, key }: SecretKey): string => `${id}.${key}`;

// Before loading: a terminal is asked for each missing secret, anything else gets the list.
export const askSecrets = async (
  missing: SecretKey[],
  io: SecretsIo = terminal()
): Promise<void> => {
  if (missing.length === 0) return;
  if (!io.isTTY) return void console.log(`secrets to set: ${missing.map(nameOf).join(', ')}`);
  for (const secret of missing) {
    const value = await io.prompt(`${nameOf(secret)}: `);
    if (value !== '') await secretsFor(secret.id).set(secret.key, value);
  }
};
