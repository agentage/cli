import { agent, shell } from '@agentage/core';

export default agent({
  name: 'shell',
  description: 'Executes a shell command and streams output',
  async *run({ task }) {
    yield* shell(task);
  },
});
