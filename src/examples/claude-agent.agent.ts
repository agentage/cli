import { agent, claude } from '@agentage/core';

export default agent({
  name: 'claude-agent',
  description: 'Runs a task using Claude Code with Read, Glob, Grep, Bash tools',
  async *run({ task }, { signal }) {
    yield* claude(task, {
      signal,
      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
      maxTurns: 10,
    });
  },
});
