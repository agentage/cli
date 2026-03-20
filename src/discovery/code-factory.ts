import { basename } from 'node:path';
import { type Agent, type AgentFactory } from '@agentage/core';
import { createJiti } from 'jiti';
import { logDebug, logWarn } from '../daemon/logger.js';

const matches = (filePath: string): boolean =>
  basename(filePath) === 'agent.ts' || basename(filePath) === 'agent.js';

export const createCodeFactory =
  (): AgentFactory =>
  async (filePath: string): Promise<Agent | null> => {
    if (!matches(filePath)) return null;

    logDebug(`Loading code agent from ${filePath}`);

    try {
      const jiti = createJiti(filePath, {
        interopDefault: true,
        moduleCache: false,
      });

      const mod = (await jiti.import(filePath)) as { default?: Agent } & Record<string, unknown>;
      const agent = mod.default ?? mod;

      if (
        agent &&
        typeof agent === 'object' &&
        'manifest' in agent &&
        'run' in agent &&
        typeof agent.run === 'function'
      ) {
        return agent as Agent;
      }

      logWarn(`Module at ${filePath} does not export a valid Agent`);
      return null;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`Failed to load code agent from ${filePath}: ${message}`);
      return null;
    }
  };
