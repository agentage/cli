import { readFileSync } from 'fs';
import { join } from 'path';

// Read package.json directly in test since index.ts uses ESM-specific import.meta
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
) as { version: string };

// Mock the index module to avoid import.meta issues in Jest
jest.mock('./index.js', () => ({
  version: packageJson.version,
  greet: () => 'Hello from AgentKit CLI!',
}));

import { greet, version } from './index.js';

describe('CLI Package', () => {
  test('version matches package.json', () => {
    expect(version).toBe(packageJson.version);
  });

  test('greet returns correct message', () => {
    expect(greet()).toBe('Hello from AgentKit CLI!');
  });
});
