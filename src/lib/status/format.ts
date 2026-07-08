// Compact "Hh Mm" / "Mm Ss" uptime, matching the daemon and status rows. Seconds only under a
// minute; hours dropped once zero so short-lived daemons read cleanly.
export const formatUptime = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
};
