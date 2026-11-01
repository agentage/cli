import { type Disposable } from '../../extension.js';
import { extensionLog } from './log.js';
import { withTimeout } from './timeout.js';

export const DISPOSE_TIMEOUT_MS = 5_000;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Each subscription gets its 5 s at once; one that hangs is abandoned, and every result is logged.
export const disposeAll = async (id: string, subscriptions: Disposable[]): Promise<void> => {
  const log = extensionLog(id);
  await Promise.all(
    subscriptions.map(async (subscription, index) => {
      const disposing = Promise.resolve().then(() => subscription.dispose());
      const result = await withTimeout(disposing, DISPOSE_TIMEOUT_MS).then(() => 'done', messageOf);
      log('dispose', { subscription: index, result });
    })
  );
};

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

// The signal waits for disposal, then is raised again with no handler: the exit it would have had.
export const holdSignals = (dispose: () => Promise<void>): (() => void) => {
  const handlers = SIGNALS.map((signal) => {
    const handler = (): void => void dispose().finally(() => process.kill(process.pid, signal));
    process.once(signal, handler);
    return { signal, handler };
  });
  return () => handlers.forEach(({ signal, handler }) => process.off(signal, handler));
};
