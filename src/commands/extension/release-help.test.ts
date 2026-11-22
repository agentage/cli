import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { addRelease } from './release.js';

describe('extension release --help', () => {
  it('names both modes: the v* tag and --changed on a merge', () => {
    const group = new Command('extension');
    addRelease(group, async () => {});
    const release = group.commands.find((c) => c.name() === 'release');
    expect(release?.description()).toBe(
      'Release an extension in CI: from its v* tag, or with --changed each changed one on a merge'
    );
  });
});
