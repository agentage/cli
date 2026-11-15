// The cli has no 0.51 install any more: this runs it in the test process, with the machine's
// environment, to leave the 0.51 state that the new cli reads and never changes.
import { prepareNpm } from '../../src/core/installer/npm.js';
import { installOld } from '../../src/test/old-install.js';

export const oldSetup = async (env: NodeJS.ProcessEnv, file: string): Promise<void> => {
  const saved = process.env;
  process.env = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
  try {
    await installOld(file, () => prepareNpm());
  } finally {
    process.env = saved;
  }
};
