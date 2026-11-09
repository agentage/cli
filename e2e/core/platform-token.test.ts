/**
 * @offline - a site whose discovery names a platform that takes only JWT PATs: setup mints one
 * with the OAuth session at the issuer, keeps it in auth.json by issuer, and registers there;
 * status reuses it; a token the platform refuses is replaced and the old one revoked.
 */
import { expect, test } from './cli.js';

const DAY_S = 86_400;

test.describe('the platform token @p0 @offline', () => {
  test('agentage setup on a site naming a platform mints a platform token, registers there, and status reuses it', async ({
    cli,
  }) => {
    const platform = cli.site.platform();
    const setup = await cli.signIn();
    expect(setup.code).toBe(0);
    const { id } = cli.json('machine.json');
    expect(setup.output).toMatch(
      new RegExp(`registered ${String(id)} at http://127\\.0\\.0\\.1:\\d+`)
    );
    expect(platform.pats).toHaveLength(1);
    expect(platform.pats[0]?.body).toEqual({
      label: 'agentage cli',
      format: 'jwt',
      scopes: ['platform:read', 'platform:write'],
      expiresInDays: 30,
    });
    const stored = Object.values(cli.json('auth.json')['platformPats'] as object);
    expect(stored).toEqual([
      { id: 'tok_1', token: platform.pats[0]?.token, expiresAt: platform.pats[0]?.expiresAt },
    ]);
    const status = await cli.run('status --json');
    expect(JSON.parse(status.stdout).machine).toMatchObject({ registered: true });
    expect(platform.pats).toHaveLength(1);
    const calls = cli.site.requests('/api/v1/machines').map((r) => `${r.method} ${r.status}`);
    expect(calls).toEqual(['PUT 201', 'POST 204', 'POST 204']);
    expect(cli.site.requests('/v1/machines')).toEqual([]);
  });

  test('a platform token within a day of expiry, or refused (401), is replaced and the old one revoked', async ({
    cli,
  }) => {
    const platform = cli.site.platform();
    expect((await cli.signIn()).code).toBe(0);
    const auth = cli.json('auth.json');
    const pats = auth['platformPats'] as Record<string, Record<string, string>>;
    const issuer = Object.keys(pats)[0]!;
    const soon = new Date(Date.now() + (DAY_S * 1000) / 2).toISOString();
    cli.write('auth.json', {
      ...auth,
      platformPats: { [issuer]: { ...pats[issuer], expiresAt: soon } },
    });
    const status = await cli.run('status');
    expect(status.code).toBe(0);
    expect(status.stdout).not.toContain('session expired');
    platform.pats[1]!.revoked = true;
    expect(JSON.parse((await cli.run('status --json')).stdout).machine.registered).toBe(true);
    const calls = cli.site.requests('/account/pat').map((r) => `${r.method} ${r.path} ${r.status}`);
    expect(calls).toEqual([
      'POST /account/pat 201',
      'POST /account/pat 201',
      'DELETE /account/pat/tok_1 200',
      'POST /account/pat 201',
      'DELETE /account/pat/tok_2 200',
    ]);
    expect(platform.pats.map((p) => p.revoked)).toEqual([true, true, false]);
  });
});
