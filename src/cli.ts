#!/usr/bin/env node

// Dependency-free guard so the message survives even if deps fail to parse on old Node.
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  process.stderr.write(`agentage requires Node.js >= 22 (you have v${process.versions.node})\n`);
  process.exit(1);
}

const { run } = await import('./program.js');
await run();
