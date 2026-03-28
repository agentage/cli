import { basename } from 'node:path';
import { type Agent, type AgentFactory } from '@agentage/core';
import { createJiti } from 'jiti';
import { logDebug, logWarn } from '../daemon/logger.js';

const matches = (filePath: string): boolean => {
  const name = basename(filePath);
  return (
    name === 'agent.ts' ||
    name === 'agent.js' ||
    (name.endsWith('.agent.ts') && name.length > '.agent.ts'.length) ||
    (name.endsWith('.agent.js') && name.length > '.agent.js'.length)
  );
};

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
        const agentObj = agent as Agent;

        // Auto-inject path if missing (D2)
        if (!agentObj.manifest.path) {
          (agentObj.manifest as { path: string }).path = filePath;
        }

        return agentObj;
      }

      logWarn(`Module at ${filePath} does not export a valid Agent`);
      return null;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`Failed to load code agent from ${filePath}: ${message}`);
      throw new Error(`Failed to load code agent from ${filePath}: ${message}`);
    }
  };
