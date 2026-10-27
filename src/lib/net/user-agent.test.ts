import { describe, expect, it } from 'vitest';
import { requestHeaders } from './user-agent.js';
import { VERSION } from '../../utils/version.js';

describe('requestHeaders', () => {
  it('identifies a CLI request with its version', () => {
    expect(requestHeaders()).toEqual({
      'User-Agent': `agentage-cli/${VERSION}`,
      'X-Agentage-CLI-Version': VERSION,
    });
  });
});
