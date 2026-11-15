import { describe, expect, it } from 'vitest';
import { kitIdProblem } from './kit-id.js';

describe("the kit's id rule (from its exported schema)", () => {
  it.each(['probe', 'my-notes', 'a'.repeat(32)])('%s is taken', (id) => {
    expect(kitIdProblem(id)).toBeNull();
  });

  it.each(['auth', 'www', 'api', 'sync', 'mail', 'mcp', 'ui', 'git', 'setup', 'com1'])(
    '%s is refused: a name the platform owns',
    (id) =>
      expect(kitIdProblem(id)).toBe(`the id ${id} is a name the platform owns or not lowercase`)
  );

  it('an id over 32 characters is refused', () => {
    const id = 'a'.repeat(33);
    expect(kitIdProblem(id)).toBe(`the id ${id} is longer than 32 characters`);
  });
});
