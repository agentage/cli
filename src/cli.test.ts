import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const CLI_PATH = join(__dirname, 'cli.ts');

describe('CLI Commands', () => {
  const testDir = 'test-cli-workspace';

  beforeEach(() => {
    // Create and change to test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir);
    process.chdir(testDir);
  });

  afterEach(() => {
    // Return to parent and clean up
    process.chdir('..');
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  test('CLI shows version', () => {
    const output = execSync(`tsx ${CLI_PATH} --version`, {
      encoding: 'utf-8',
    });
    // Version is read from package.json dynamically
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('CLI shows help', () => {
    const output = execSync(`tsx ${CLI_PATH} --help`, {
      encoding: 'utf-8',
    });
    expect(output).toContain('AgentKit CLI');
    expect(output).toContain('init');
    expect(output).toContain('run');
    expect(output).toContain('list');
    expect(output).toContain('update');
  });

  test('init command creates agent folder and config', () => {
    const output = execSync(`tsx ${CLI_PATH} init test-agent`, {
      encoding: 'utf-8',
    });
    const expectedAgentPath = join('agents', 'test-agent.agent.md');
    const expectedConfigPath = 'agent.json';

    expect(output).toContain('✅ Created');
    expect(output).toContain('test-agent.agent.md');
    expect(output).toContain('agent.json');
    expect(existsSync(expectedAgentPath)).toBe(true);
    expect(existsSync(expectedConfigPath)).toBe(true);
  });

  test('run command requires agent file', () => {
    try {
      execSync(`tsx ${CLI_PATH} run my-agent "hello"`, {
        encoding: 'utf-8',
      });
      fail('Should have thrown an error');
    } catch (error) {
      const err = error as Error & { stdout: string; stderr: string };
      expect(err.stderr || err.stdout || err.message).toContain('Failed');
    }
  });

  test('list command runs successfully', () => {
    const output = execSync(`tsx ${CLI_PATH} list`, {
      encoding: 'utf-8',
    });
    // Either shows no agents found or lists available agents (including global)
    expect(
      output.includes('No agents found') || output.includes('Available Agents')
    ).toBe(true);
  });
});
