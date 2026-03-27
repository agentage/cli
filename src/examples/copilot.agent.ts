import { createAgent, type RunEvent } from '@agentage/core';

export const agent = createAgent({
  name: 'copilot',
  description: 'Runs a task using GitHub Copilot',
  version: '1.0.0',
  tags: ['example', 'llm', 'github', 'copilot'],
  path: '',
  async *run(input, { signal }) {
    let CopilotClient: typeof import('@github/copilot-sdk').CopilotClient;
    let approveAll: typeof import('@github/copilot-sdk').approveAll;
    try {
      const sdk = await import('@github/copilot-sdk');
      CopilotClient = sdk.CopilotClient;
      approveAll = sdk.approveAll;
    } catch {
      yield {
        type: 'error' as const,
        data: {
          type: 'error' as const,
          code: 'MISSING_SDK',
          message: 'Install @github/copilot-sdk: npm install @github/copilot-sdk',
          recoverable: false,
        },
        timestamp: Date.now(),
      };
      yield {
        type: 'result' as const,
        data: {
          type: 'result' as const,
          success: false,
          output: '@github/copilot-sdk not installed',
        },
        timestamp: Date.now(),
      };
      return;
    }

    const client = new CopilotClient();
    let session: Awaited<ReturnType<typeof client.createSession>> | undefined;

    try {
      await client.start();

      session = await client.createSession({
        model: (input.config?.model as string) ?? 'gpt-4o',
        onPermissionRequest: approveAll,
      });

      signal.addEventListener('abort', () => session?.abort(), { once: true });

      const events: RunEvent[] = [];

      const idle = new Promise<void>((resolve) => {
        session!.on('session.idle', () => resolve());
      });

      session.on('assistant.message_delta', (event: Record<string, unknown>) => {
        const data = event.data as Record<string, unknown> | undefined;
        events.push({
          type: 'output',
          data: {
            type: 'output',
            content: { text: data?.content ?? '' },
            format: 'llm.delta',
          },
          timestamp: Date.now(),
        });
      });

      session.on('assistant.message', (event: Record<string, unknown>) => {
        const data = event.data as Record<string, unknown> | undefined;
        events.push({
          type: 'output',
          data: { type: 'output', content: data?.content ?? '', format: 'text' },
          timestamp: Date.now(),
        });
      });

      await session.send({ prompt: input.task });
      await idle;

      for (const event of events) {
        yield event;
      }

      yield {
        type: 'result' as const,
        data: { type: 'result' as const, success: true },
        timestamp: Date.now(),
      };
    } catch (err: unknown) {
      if (signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      yield {
        type: 'error' as const,
        data: { type: 'error' as const, code: 'COPILOT_ERROR', message, recoverable: false },
        timestamp: Date.now(),
      };
      yield {
        type: 'result' as const,
        data: { type: 'result' as const, success: false, output: message },
        timestamp: Date.now(),
      };
    } finally {
      if (session) {
        await session.disconnect().catch(() => {});
      }
      await client.stop().catch(() => {});
    }
  },
});

export default agent;
