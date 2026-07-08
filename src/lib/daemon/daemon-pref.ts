// Whether the memory verbs must run in-process (DirectClient) instead of via the daemon.
// Set by the `--no-daemon` global flag or AGENTAGE_NO_DAEMON=1 (tests/sandbox/CI).
let forced = false;

export const disableDaemon = (): void => {
  forced = true;
};

export const daemonDisabled = (): boolean => {
  const env = process.env['AGENTAGE_NO_DAEMON'];
  return forced || env === '1' || env === 'true';
};
