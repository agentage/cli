import { describe, expect, vi } from 'vitest';
import { DaemonError, runJson } from '../../lib/json-output.js';
import { output, test } from '../../test/config-dir.js';
import { fakeHost, marketRow } from '../../test/host.js';
import { EventEmitter } from 'node:events';
import { readHidden, runConfigure, type SecretInput } from './configure.js';

const input = (over: Partial<SecretInput> = {}): SecretInput => ({
  isTTY: false,
  readStdin: vi.fn(async () => 's3cret\n'),
  prompt: vi.fn(async () => 'typed'),
  ...over,
});

const setup = () => {
  const { host, deps } = fakeHost([marketRow('probe', '0.7.0')]);
  return { host, deps: (over: Partial<SecretInput> = {}) => ({ ...deps, input: input(over) }) };
};

describe('extension configure', () => {
  test('key=value pairs are settings; the line names the keys', async () => {
    const { host, deps } = setup();
    const run = await output(() =>
      runConfigure({ id: 'probe', pairs: ['echo.prefix=hey', 'a=b=c'] }, deps())
    );
    expect(host.change).toHaveBeenCalledWith('probe', {
      settings: { 'echo.prefix': 'hey', a: 'b=c' },
    });
    expect(run.lines).toEqual(['probe 0.7.0 running', 'settings set: echo.prefix, a']);
  });

  test('an undeclared key: the answer adds what the extension declares, or how to see it', async ({
    dir,
  }) => {
    const { host, deps } = setup();
    const refused = new DaemonError(
      'INVALID_SETTING',
      'setting echo.prefx: not declared in the manifest'
    );
    vi.mocked(host.change).mockRejectedValue(refused);
    const run = () =>
      output(() => runConfigure({ id: 'probe', pairs: ['echo.prefx=hey'] }, deps()));
    expect(await run()).toMatchObject({
      code: 'INVALID_SETTING',
      error: `${refused.message}; see agentage.settings in its package.json`,
    });
    const settings = { 'echo.prefix': { type: 'string' }, 'mcp.listing': { type: 'boolean' } };
    dir.write('ext/package.json', { name: 'x', agentage: { id: 'probe', settings } });
    dir.write('installation.json', { extensions: [{ id: 'probe', source: dir.at('ext') }] });
    expect((await run()).error).toBe(
      `${refused.message}; probe declares: echo.prefix, mcp.listing`
    );
    dir.write('ext/package.json', { name: 'x', agentage: { id: 'probe' } });
    expect((await run()).error).toBe(`${refused.message}; probe declares no settings`);
  });

  test('--secret: the values are secrets and never printed; a bare key reads stdin', async () => {
    const { host, deps } = setup();
    const run = await output(() =>
      runConfigure({ id: 'probe', pairs: ['token'], secret: true }, deps())
    );
    expect(host.change).toHaveBeenCalledWith('probe', { secrets: { token: 's3cret' } });
    expect(`${run.stdout}${run.stderr}`).not.toContain('s3cret');
    expect(run.lines.at(-1)).toBe('secrets set: token');
  });

  test('a bare key on a terminal is asked for; with --json it is refused, never prompted', async () => {
    const { host, deps } = setup();
    const prompt = vi.fn(async () => 'typed');
    await output(() =>
      runConfigure({ id: 'probe', pairs: ['token'], secret: true }, deps({ isTTY: true, prompt }))
    );
    expect(prompt).toHaveBeenCalledWith('token: ');
    expect(host.change).toHaveBeenLastCalledWith('probe', { secrets: { token: 'typed' } });
    const out: string[] = [];
    const io = { writeOut: (t: string) => void out.push(t) };
    const opts = { id: 'probe', pairs: ['token'], secret: true };
    await runJson(io, () => runConfigure(opts, deps({ isTTY: true, prompt })));
    expect(JSON.parse(out.join(''))).toMatchObject({
      success: false,
      error: { code: 'confirmation_required' },
    });
    expect(prompt).toHaveBeenCalledOnce();
  });

  test('a bare key without --secret, or beside other pairs, is usage', async () => {
    const { deps } = setup();
    const bare = await output(() => runConfigure({ id: 'probe', pairs: ['echo.prefix'] }, deps()));
    expect(bare).toMatchObject({
      code: 'invalid_argument',
      error: 'echo.prefix: expected <key>=<value>',
    });
    const mixed = await output(() =>
      runConfigure({ id: 'probe', pairs: ['a=1', 'token'], secret: true }, deps())
    );
    expect(mixed.code).toBe('invalid_argument');
  });
});

// A terminal in raw mode: each keypress arrives as data.
const fakeTty = () => {
  const stdin = Object.assign(new EventEmitter(), {
    setRawMode: vi.fn(() => stdin),
    resume: vi.fn(() => stdin),
    pause: vi.fn(() => stdin),
  });
  const written: string[] = [];
  const stderr = { write: (text: string) => (written.push(text), true) };
  return { stdin, stderr, written };
};

describe('readHidden', () => {
  test('reads up to Enter with no echo, Backspace removes a char, the terminal is restored', async () => {
    const tty = fakeTty();
    const answer = readHidden('token: ', tty as never);
    tty.stdin.emit('data', Buffer.from('ab\u007fc\rignored'));
    expect(await answer).toBe('ac');
    expect(tty.written).toEqual(['token: ', '\n']);
    expect(tty.stdin.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(tty.stdin.pause).toHaveBeenCalled();
    expect(tty.stdin.listenerCount('data')).toBe(0);
  });

  test('Ctrl+C ends the prompt, restores the terminal, then interrupts this process', async () => {
    const tty = fakeTty();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const answer = readHidden('token: ', tty as never);
    tty.stdin.emit('data', Buffer.from('x\u0003'));
    expect(await answer).toBe('x');
    expect(tty.stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
    kill.mockRestore();
  });
});
