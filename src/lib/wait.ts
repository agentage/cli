const POLL_MS = 100;

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// A wait past `afterMs` prints `line` once on stderr, so --json stdout stays one object.
export interface Slow {
  afterMs: number;
  line: string;
}

// Polls `done` until it holds (true) or the time is up (false).
export const waitFor = async (
  done: () => boolean | Promise<boolean>,
  timeoutMs: number,
  slow?: Slow
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  const note = slow ? Date.now() + slow.afterMs : Infinity;
  let noted = false;
  for (;;) {
    if (await done()) return true;
    if (Date.now() >= deadline) return false;
    if (!noted && Date.now() >= note) noted = (console.error(slow?.line), true);
    await sleep(POLL_MS);
  }
};
