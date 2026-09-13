import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Observability from './observability.js';

// Fresh module each time: the user's OTEL_SERVICE_NAME is captured at import.
const load = async (): Promise<typeof Observability> => {
  vi.resetModules();
  return import('./observability.js');
};

const clearEnv = (): void => {
  delete process.env['OTEL_SERVICE_NAME'];
  delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
};

describe('observability', () => {
  afterEach(() => {
    clearEnv();
    vi.restoreAllMocks();
  });

  it('names the daemon separately from the CLI', async () => {
    clearEnv();
    const obs = await load();
    expect(obs.daemonServiceName()).toBe('agentage-daemon');
    expect(obs.CLI_SERVICE).toBe('agentage-cli');
  });

  it("lets the daemon inherit the user's own service name", async () => {
    process.env['OTEL_SERVICE_NAME'] = 'my-service';
    const obs = await load();
    expect(obs.daemonServiceName()).toBe('my-service');
  });

  it('defaults the service name only when the user set none', async () => {
    clearEnv();
    const obs = await load();
    await obs.startObservability('agentage-cli');
    expect(process.env['OTEL_SERVICE_NAME']).toBe('agentage-cli');

    process.env['OTEL_SERVICE_NAME'] = 'mine';
    await obs.startObservability('agentage-cli');
    expect(process.env['OTEL_SERVICE_NAME']).toBe('mine');
  });

  it('writes nothing to stdout while booting, and restores it', async () => {
    clearEnv();
    const obs = await load();
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await obs.startObservability('agentage-cli');
    expect(write).not.toHaveBeenCalled();
    expect(process.stdout.write).toBe(write);
  });
});
