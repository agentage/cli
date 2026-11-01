import { chmodSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { test } from '../../test/config-dir.js';
import { unsafeDevPath } from './dev-path.js';

const me = process.getuid?.() ?? 1000;

describe('a dev path another user could write to', () => {
  test('is safe when this user owns it and only this user can write it', ({ dir }) => {
    dir.write('dev/hello/package.json', {});
    chmodSync(dir.at('dev/hello'), 0o755);
    expect(unsafeDevPath(dir.at('dev/hello'), me)).toBeNull();
  });

  test('is unsafe when anyone can write it', ({ dir }) => {
    dir.write('dev/hello/package.json', {});
    chmodSync(dir.at('dev/hello'), 0o777);
    expect(unsafeDevPath(dir.at('dev/hello'), me)).toBe(
      `dev path ${dir.at('dev/hello')} is world-writable`
    );
  });

  test('is unsafe when another user owns it; root may own it', ({ dir }) => {
    dir.write('dev/hello/package.json', {});
    chmodSync(dir.at('dev/hello'), 0o755);
    expect(unsafeDevPath(dir.at('dev/hello'), me + 1)).toBe(
      `dev path ${dir.at('dev/hello')} is owned by uid ${me}`
    );
    expect(unsafeDevPath('/usr', me)).toBeNull();
  });

  test('is left to the missing check when it does not exist, and unchecked without a uid', ({
    dir,
  }) => {
    expect(unsafeDevPath(dir.at('gone'), me)).toBeNull();
    dir.write('dev/hello/package.json', {});
    chmodSync(dir.at('dev/hello'), 0o777);
    expect(unsafeDevPath(dir.at('dev/hello'), undefined)).toBeNull();
  });
});
