import { agent, output, progress } from '@agentage/core';

export default agent({
  name: 'countdown',
  description: 'Counts down from 5 to 0 with 1-second delays',
  async *run({ config }, { sleep }) {
    const start = Number(config?.start ?? 5);
    for (let i = start; i >= 0; i--) {
      yield output(`${i}`);
      yield progress(((start - i) / start) * 100, `${i}...`);
      if (i > 0) await sleep(1000);
    }
  },
});
