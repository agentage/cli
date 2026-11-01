// The timer is always cleared; the promise given up on runs on, as loaded code cannot be stopped.
export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
};
