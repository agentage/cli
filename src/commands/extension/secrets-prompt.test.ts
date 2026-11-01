import { statSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { output, test } from '../../test/config-dir.js';
import { askSecrets } from './secrets-prompt.js';

const MISSING = [
  { id: 'secret', key: 'token' },
  { id: 'secret', key: 'other' },
];

const never = async (): Promise<string> => {
  throw new Error('asked without a terminal');
};

describe('the secrets setup asks for before loading', () => {
  test('on a terminal each is asked for, and an answer is saved in secrets.json for this user only', async ({
    dir,
  }) => {
    const asked: string[] = [];
    const prompt = async (question: string): Promise<string> => {
      asked.push(question);
      return question === 'secret.token: ' ? 't0ken' : '';
    };
    await askSecrets(MISSING, { isTTY: true, prompt });
    expect(asked).toEqual(['secret.token: ', 'secret.other: ']);
    expect(dir.json('secrets.json')).toEqual({ secret: { token: 't0ken' } });
    expect(statSync(dir.at('secrets.json')).mode & 0o777).toBe(0o600);
  });

  test('without a terminal they are listed, and nothing is asked or written', async ({ dir }) => {
    const run = await output(() => askSecrets(MISSING, { isTTY: false, prompt: never }));
    expect(run.lines).toEqual(['secrets to set: secret.token, secret.other']);
    expect(dir.exists('secrets.json')).toBe(false);
  });

  test('with none missing, nothing is printed or asked', async () => {
    expect((await output(() => askSecrets([], { isTTY: true, prompt: never }))).lines).toEqual([]);
  });
});
