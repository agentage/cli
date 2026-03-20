import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import matter from 'gray-matter';
import {
  type Agent,
  type AgentFactory,
  type AgentProcess,
  type RunEvent,
  type RunInput,
} from '@agentage/core';
import { randomUUID } from 'node:crypto';

interface MarkdownFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  tags?: string[];
  model?: string;
  temperature?: number;
}

const matches = (filePath: string): boolean =>
  filePath.endsWith('.agent.md') || filePath.endsWith('/SKILL.md');

export const createMarkdownFactory =
  (): AgentFactory =>
  async (filePath: string): Promise<Agent | null> => {
    if (!matches(filePath)) return null;

    const raw = readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    const fm = data as MarkdownFrontmatter;

    const name = fm.name ?? basename(filePath, '.agent.md');
    const systemPrompt = content.trim();

    const agent: Agent = {
      manifest: {
        name,
        description: fm.description,
        version: fm.version,
        tags: fm.tags,
        path: filePath,
        config: {
          systemPrompt,
          ...(fm.model ? { model: fm.model } : {}),
          ...(fm.temperature !== undefined ? { temperature: fm.temperature } : {}),
        },
      },
      async run(input: RunInput): Promise<AgentProcess> {
        const runId = randomUUID();
        let canceled = false;

        async function* generateEvents(): AsyncIterable<RunEvent> {
          yield {
            type: 'output',
            data: { type: 'output', content: systemPrompt, format: 'text' },
            timestamp: Date.now(),
          };

          if (!canceled) {
            yield {
              type: 'output',
              data: { type: 'output', content: `\nTask: ${input.task}`, format: 'text' },
              timestamp: Date.now(),
            };
          }

          yield {
            type: 'result',
            data: { type: 'result', success: true, output: 'Agent execution complete' },
            timestamp: Date.now(),
          };
        }

        return {
          runId,
          events: generateEvents(),
          cancel: () => {
            canceled = true;
          },
          sendInput: () => {
            // No-op for markdown agents
          },
        };
      },
    };

    return agent;
  };
