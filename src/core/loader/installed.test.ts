import { describe, expect } from 'vitest';
import { fixture, test } from '../../test/config-dir.js';
import { installedExtensions } from './installed.js';

describe('the extensions installation.json runs, read without the daemon', () => {
  test('null before the move; a folder row is read in place; disabled and missing rows are left out', ({
    dir,
  }) => {
    expect(installedExtensions()).toBeNull();
    dir.write('installation.json', {
      host: 'local',
      extensions: [
        { id: 'probe', source: fixture('probe') },
        { id: 'pong', source: fixture('pong'), enabled: false },
        { id: 'notes', version: '1.0.0' },
        'junk',
      ],
    });
    const found = installedExtensions() ?? [];
    expect(found.map((ext) => [ext.id, ext.source, ext.dir])).toEqual([
      ['probe', 'dev', fixture('probe')],
    ]);
  });
});
