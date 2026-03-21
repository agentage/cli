export interface Reconnector {
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export interface ReconnectorOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  onReconnect: () => Promise<void>;
  onError?: (err: unknown) => void;
}

export const createReconnector = (opts: ReconnectorOptions): Reconnector => {
  const initialDelay = opts.initialDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 30_000;

  let currentDelay = initialDelay;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const attempt = async (): Promise<void> => {
    if (stopped) return;

    try {
      await opts.onReconnect();
      currentDelay = initialDelay;
    } catch (err) {
      opts.onError?.(err);
      timer = setTimeout(() => {
        attempt();
      }, currentDelay);
      currentDelay = Math.min(currentDelay * 2, maxDelay);
    }
  };

  return {
    start: () => {
      stopped = false;
      attempt();
    },

    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },

    reset: () => {
      currentDelay = initialDelay;
    },
  };
};
