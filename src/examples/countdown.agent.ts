import { createAgent } from '@agentage/core';

export const agent = createAgent({
  name: 'countdown',
  description: 'Counts down from 5 to 0 with 1-second delays',
  version: '1.0.0',
  tags: ['example', 'simple'],
  path: '',
  async *run(input, { signal }) {
    const start = input.config?.start ? Number(input.config.start) : 5;

    for (let i = start; i >= 0; i--) {
      if (signal.aborted) break;

      yield {
        type: 'output' as const,
        data: { type: 'output' as const, content: `${i}`, format: 'text' },
        timestamp: Date.now(),
      };

      yield {
        type: 'output' as const,
        data: {
          type: 'output' as const,
          content: { percent: ((start - i) / start) * 100, message: `${i}...` },
          format: 'progress',
        },
        timestamp: Date.now(),
      };

      if (i > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 1000);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true }
          );
        }).catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          throw err;
        });
      }
    }

    if (!signal.aborted) {
      yield {
        type: 'result' as const,
        data: { type: 'result' as const, success: true, output: 'Countdown complete' },
        timestamp: Date.now(),
      };
    }
  },
});

export default agent;
