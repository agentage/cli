import { describe, expect, it, vi } from 'vitest';
import { runSetup, type SetupDeps } from './setup.js';

const makeDeps = () => {
  const calls: string[] = [];
  const deps: SetupDeps = {
    ensureSignedIn: vi.fn(async () => {
      calls.push('sign-in');
      return 'signed-in' as const;
    }),
    signOut: vi.fn(async () => void calls.push('sign-out')),
    printStatus: vi.fn(async () => void calls.push('status')),
  };
  return { deps, calls };
};

describe('runSetup', () => {
  it('signs in with the browser and reauth flags, then prints status', async () => {
    const { deps, calls } = makeDeps();
    await runSetup({ reauth: true, browser: false }, deps);
    expect(deps.ensureSignedIn).toHaveBeenCalledWith({ reauth: true, browser: false });
    expect(calls).toEqual(['sign-in', 'status']);
  });

  it('--disconnect signs out and prints nothing else', async () => {
    const { deps, calls } = makeDeps();
    await runSetup({ disconnect: true }, deps);
    expect(calls).toEqual(['sign-out']);
  });

  it('never prints status when sign-in fails', async () => {
    const { deps, calls } = makeDeps();
    vi.mocked(deps.ensureSignedIn).mockRejectedValue(new Error('boom'));
    await expect(runSetup({}, deps)).rejects.toThrow('boom');
    expect(calls).toEqual([]);
  });
});
