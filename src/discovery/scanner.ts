import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Agent, type AgentFactory } from '@agentage/core';
import { logDebug, logInfo, logWarn } from '../daemon/logger.js';

export interface ScanWarning {
  file: string;
  message: string;
}

export interface ScanResult {
  agents: Agent[];
  warnings: ScanWarning[];
}

let lastWarnings: ScanWarning[] = [];

export const getLastScanWarnings = (): ScanWarning[] => lastWarnings;

const getAllFiles = (dir: string): string[] => {
  const results: string[] = [];

  if (!existsSync(dir)) {
    logWarn(`Discovery dir does not exist: ${dir}`);
    return results;
  }

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
};

export const scanAgents = async (dirs: string[], factories: AgentFactory[]): Promise<Agent[]> => {
  const agents: Agent[] = [];
  const warnings: ScanWarning[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    const expandedDir = dir.replace(/^~/, process.env['HOME'] || '~');
    logDebug(`Scanning directory: ${expandedDir}`);
    const files = getAllFiles(expandedDir);

    for (const file of files) {
      for (const factory of factories) {
        try {
          const agent = await factory(file);
          if (agent && !seen.has(agent.manifest.name)) {
            agents.push(agent);
            seen.add(agent.manifest.name);
            logDebug(`Discovered agent: ${agent.manifest.name} from ${file}`);
            break;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logWarn(`Factory error on ${file}: ${message}`);
          warnings.push({ file, message });
        }
      }
    }
  }

  lastWarnings = warnings;
  logInfo(`Scan complete: ${agents.length} agent(s) found, ${warnings.length} warning(s)`);
  return agents;
};
