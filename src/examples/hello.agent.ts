import { agent, output } from '@agentage/core';

export default agent({
  name: 'hello',
  description: 'Says hello',
  async *run({ task }) {
    yield output(`Hello, ${task}!`);
  },
});
