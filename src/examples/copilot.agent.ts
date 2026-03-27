import { agent, copilot } from '@agentage/core';

export default agent({
  name: 'copilot',
  description: 'Runs a task using GitHub Copilot',
  async *run({ task }, { signal }) {
    yield* copilot(task, { signal, model: 'gpt-4o' });
  },
});
