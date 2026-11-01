import { describe, expect } from 'vitest';
import { fakeAccount } from '../../test/account.js';
import { output, test } from '../../test/config-dir.js';
import { VERSION } from '../../utils/version.js';
import { disconnectMachine, registerMachine, seenMachine } from './register.js';

const BOX = { id: 'm_0000beef', name: 'box' };
const PATH = '/v1/machines/m_0000beef';

describe('this machine in the account', () => {
  test('setup registers it with PUT (name, platform, CLI version, connected), then marks it seen, each within 2 s', async () => {
    const account = fakeAccount();
    await registerMachine(account.fetch, BOX);
    expect(account.requests).toMatchObject([
      {
        method: 'PUT',
        path: PATH,
        status: 201,
        body: {
          name: 'box',
          platform: `${process.platform}-${process.arch}`,
          cliVersion: VERSION,
          state: 'connected',
        },
      },
      { method: 'POST', path: `${PATH}/seen`, status: 204 },
    ]);
    for (const request of account.requests) expect(request.timeoutMs).toBeLessThanOrEqual(2000);
  });

  test('a host name longer than 128 characters is sent cut to 128', async () => {
    const account = fakeAccount();
    await registerMachine(account.fetch, { ...BOX, name: 'h'.repeat(200) });
    expect(account.requests[0]?.body?.['name']).toBe('h'.repeat(128));
  });

  test('seen says whether the account knows this machine: true, false before it registered, null when unreachable', async () => {
    const account = fakeAccount();
    expect(await seenMachine(account.fetch, BOX.id)).toBe(false);
    await registerMachine(account.fetch, BOX);
    expect(await seenMachine(account.fetch, BOX.id)).toBe(true);
    account.fail('machines', 503);
    expect(await seenMachine(account.fetch, BOX.id)).toBeNull();
  });

  test('setup --disconnect sends PATCH state disconnected', async () => {
    const account = fakeAccount();
    await registerMachine(account.fetch, BOX);
    await disconnectMachine(account.fetch, BOX.id);
    expect(account.requests.at(-1)).toMatchObject({
      method: 'PATCH',
      path: PATH,
      body: { state: 'disconnected' },
      status: 200,
    });
    expect(account.machines.get(BOX.id)).toMatchObject({ state: 'disconnected' });
  });

  test.for([503, 'network', 'timeout'] as const)(
    'never throws and prints nothing when the account answers %s',
    async (how) => {
      const account = fakeAccount();
      account.fail('machines', how);
      const run = await output(async () => {
        await registerMachine(account.fetch, BOX);
        await seenMachine(account.fetch, BOX.id);
        await disconnectMachine(account.fetch, BOX.id);
      });
      expect(run).toEqual({ stdout: '', stderr: '', lines: [], error: null });
      expect(account.requests).toHaveLength(4);
    }
  );

  test('with AGENTAGE_DEBUG=1 each call prints one line on stderr', async () => {
    const account = fakeAccount();
    process.env['AGENTAGE_DEBUG'] = '1';
    try {
      const run = await output(async () => {
        await registerMachine(account.fetch, BOX);
        account.fail('machines', 'timeout');
        await disconnectMachine(account.fetch, BOX.id);
      });
      expect(run.stderr.split('\n')).toEqual([
        `machines: PUT ${PATH} 201`,
        `machines: POST ${PATH}/seen 204`,
        `machines: PATCH ${PATH} failed: timed out`,
      ]);
    } finally {
      delete process.env['AGENTAGE_DEBUG'];
    }
  });
});
