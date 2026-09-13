#!/usr/bin/env node

// The bin is a loader, nothing else. @agentage/observability instruments node:http, fetch and MCP
// tool registration through module hooks, and a hook only sees a module imported after it is
// registered - so the bootstrap runs first and the program is imported dynamically behind it.

// Dependency-free guard so the message survives even if deps fail to parse on old Node.
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  process.stderr.write(`agentage requires Node.js >= 22 (you have v${process.versions.node})\n`);
  process.exit(1);
}

const { CLI_SERVICE, startObservability } = await import('./observability.js');
await startObservability(CLI_SERVICE);

const { run } = await import('./program.js');
await run();
