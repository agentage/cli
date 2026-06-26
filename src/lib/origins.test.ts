import { afterEach, describe, expect, it } from 'vitest';
import { environment, links, normalizeFqdn, siteFqdn } from './origins.js';

describe('normalizeFqdn', () => {
  it('defaults to agentage.io', () => {
    expect(normalizeFqdn(undefined)).toBe('agentage.io');
    expect(normalizeFqdn('')).toBe('agentage.io');
    expect(normalizeFqdn('  ')).toBe('agentage.io');
  });

  it('strips protocol, trailing slash, and case', () => {
    expect(normalizeFqdn('https://Dev.Agentage.io/')).toBe('dev.agentage.io');
    expect(normalizeFqdn('http://localhost:3000//')).toBe('localhost:3000');
  });
});

describe('environment', () => {
  it('detects development for dev. and localhost', () => {
    expect(environment('dev.agentage.io')).toBe('development');
    expect(environment('localhost')).toBe('development');
    expect(environment('localhost:3000')).toBe('development');
    expect(environment('127.0.0.1:3000')).toBe('development');
  });

  it('defaults to production', () => {
    expect(environment('agentage.io')).toBe('production');
  });
});

describe('links', () => {
  it('derives all service urls from one fqdn', () => {
    expect(links('agentage.io')).toEqual({
      site: 'https://agentage.io',
      api: 'https://api.agentage.io/api',
      auth: 'https://auth.agentage.io',
      mcp: 'https://memory.agentage.io/mcp',
    });
    expect(links('dev.agentage.io').auth).toBe('https://auth.dev.agentage.io');
  });

  it('maps localhost to the local port set', () => {
    expect(links('localhost')).toEqual({
      site: 'http://localhost:3000',
      api: 'http://localhost:3001/api',
      auth: 'http://localhost:3010',
      mcp: 'http://localhost:3003/mcp',
    });
  });
});

describe('siteFqdn', () => {
  afterEach(() => {
    delete process.env['AGENTAGE_SITE_FQDN'];
  });

  it('reads AGENTAGE_SITE_FQDN with a production default', () => {
    expect(siteFqdn()).toBe('agentage.io');
    process.env['AGENTAGE_SITE_FQDN'] = 'dev.agentage.io';
    expect(siteFqdn()).toBe('dev.agentage.io');
  });
});
