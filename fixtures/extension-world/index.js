// @ts-check

/** @import { ExtensionContext } from '@agentage/cli/extension' */

/** @param {ExtensionContext} ctx */
export const register = async (ctx) => {
  const hello = /** @type {{ greet: () => string }} */ (ctx.use('hello'));
  const heard = hello.greet();
  ctx.commands.add((program) =>
    program
      .command('world')
      .description('Print what hello greeted')
      .action(() => console.log(`world heard: ${heard}`))
  );
  return { heard: () => heard };
};
