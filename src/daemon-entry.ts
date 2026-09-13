// The daemon's bin, a loader and nothing else: @agentage/observability instruments node:http and
// MCP tool registration through module hooks that only see modules imported after they register, so
// the bootstrap runs before the daemon itself is loaded. The path stays src/daemon-entry.ts because
// spawnDaemon resolves dist/daemon-entry.js.

const { DAEMON_SERVICE, startObservability } = await import('./observability.js');
await startObservability(DAEMON_SERVICE);

const { boot } = await import('./daemon/entry.js');
boot();
