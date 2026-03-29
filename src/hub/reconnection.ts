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
  let running = false;

  const attempt = async (): Promise<void> => {
    if (stopped) return;

    try {
      await opts.onReconnect();
      currentDelay = initialDelay;
      running = false;
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
      if (running) return;
      stopped = false;
      running = true;
      attempt();
    },

    stop: () => {
      stopped = true;
      running = false;
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
