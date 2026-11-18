import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateHint } from '../../lib/update/update-cache.js';
import { type StatusReport } from '../../lib/status/status-info.js';
import { printStatus } from './status.js';

const report: StatusReport = {
  version: '0.40.0',
  fqdn: 'agentage.io',
  env: 'production',
  target: { fqdn: 'agentage.io', env: 'production', reachable: true },
  auth: { signedIn: true },
  endpoint: { url: 'https://agentage.io/api', reachable: true },
  update: { status: { kind: 'update-available', latest: '99.0.1' }, message: null },
};

// setup prints the status (a live check), then the post-action hook reads the older cache.
describe('one update line per run', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentage-hint-'));
    process.env['AGENTAGE_CONFIG_DIR'] = dir;
    writeFileSync(
      join(dir, 'update-check.json'),
      JSON.stringify({ checkedAt: 1, latest: '99.0.0' })
    );
  });

  afterEach(() => {
    delete process.env['AGENTAGE_CONFIG_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('the cached hint is silent once the status printed its live update row', () => {
    expect(updateHint()).toContain('99.0.0');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      printStatus(report);
    } finally {
      log.mockRestore();
    }
    expect(updateHint()).toBeNull();
  });
});
