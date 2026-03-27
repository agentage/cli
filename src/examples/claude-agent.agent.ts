import { createAgent } from '@agentage/core';

export const agent = createAgent({
  name: 'claude-agent',
  description: 'Runs a task using Claude Code with Read, Glob, Grep, Bash tools',
  version: '1.0.0',
  tags: ['example', 'llm', 'claude'],
  path: '',
  async *run(input, { signal }) {
    if (!process.env['ANTHROPIC_API_KEY']) {
      yield {
        type: 'error' as const,
        data: {
          type: 'error' as const,
          code: 'MISSING_API_KEY',
          message: 'ANTHROPIC_API_KEY environment variable is not set',
          recoverable: false,
        },
        timestamp: Date.now(),
      };
      yield {
        type: 'result' as const,
        data: { type: 'result' as const, success: false, output: 'ANTHROPIC_API_KEY not set' },
        timestamp: Date.now(),
      };
      return;
    }

    let queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query;
    try {
      const sdk = await import('@anthropic-ai/claude-agent-sdk');
      queryFn = sdk.query;
    } catch {
      yield {
        type: 'error' as const,
        data: {
          type: 'error' as const,
          code: 'MISSING_SDK',
          message:
            'Install @anthropic-ai/claude-agent-sdk: npm install @anthropic-ai/claude-agent-sdk',
          recoverable: false,
        },
        timestamp: Date.now(),
      };
      yield {
        type: 'result' as const,
        data: {
          type: 'result' as const,
          success: false,
          output: '@anthropic-ai/claude-agent-sdk not installed',
        },
        timestamp: Date.now(),
      };
      return;
    }

    const controller = new AbortController();
    signal.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      for await (const message of queryFn({
        prompt: input.task,
        options: {
          allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
          abortController: controller,
          maxTurns: input.config?.maxTurns ? Number(input.config.maxTurns) : 10,
        },
      })) {
        if (signal.aborted) break;

        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if ('text' in block) {
              yield {
                type: 'output' as const,
                data: {
                  type: 'output' as const,
                  content: { text: block.text },
                  format: 'llm.delta',
                },
                timestamp: Date.now(),
              };
            } else if ('name' in block) {
              yield {
                type: 'output' as const,
                data: {
                  type: 'output' as const,
                  content: { id: block.id, name: block.name, input: block.input },
                  format: 'llm.tool_call',
                },
                timestamp: Date.now(),
              };
            }
          }
        }

        if (message.type === 'result') {
          const success = message.subtype === 'success';
          yield {
            type: 'result' as const,
            data: {
              type: 'result' as const,
              success,
              output: success ? (message as Record<string, unknown>).result : message.subtype,
            },
            timestamp: Date.now(),
          };
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      const errMessage = err instanceof Error ? err.message : String(err);
      yield {
        type: 'error' as const,
        data: {
          type: 'error' as const,
          code: 'QUERY_ERROR',
          message: errMessage,
          recoverable: false,
        },
        timestamp: Date.now(),
      };
      yield {
        type: 'result' as const,
        data: { type: 'result' as const, success: false, output: errMessage },
        timestamp: Date.now(),
      };
    }
  },
});

export default agent;
