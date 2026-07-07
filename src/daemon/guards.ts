// Web-origin defense for the loopback daemon: a Host allow-list blocks DNS-rebinding (an attacker
// domain that later resolves to 127.0.0.1 still sends its own Host), and an Origin allow-list blocks
// a browser page from POSTing to the daemon. Both are pure so they unit-test without a socket.

// The only Host values a genuine loopback client sends, pinned to the actually-bound port.
export const loopbackHosts = (port: number): string[] => [
  `127.0.0.1:${port}`,
  `localhost:${port}`,
  `[::1]:${port}`,
];

export const isAllowedHost = (host: string | undefined, port: number): boolean =>
  host !== undefined && loopbackHosts(port).includes(host);

// A missing Origin is fine (non-browser clients omit it); a present one must be loopback (any port).
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export const isAllowedOrigin = (origin: string | undefined): boolean =>
  origin === undefined || LOOPBACK_ORIGIN.test(origin);
