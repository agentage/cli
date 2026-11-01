// @ts-check

/** @import { ExtensionContext } from '@agentage/cli/extension' */

/** @param {ExtensionContext} ctx */
export const register = async (ctx) => {
  // Typed by ExtensionApis in apis.d.ts: no cast.
  const heard = ctx.use('hello').greet();
  ctx.commands.add((program) =>
    program
      .command('world')
      .description('Print what hello greeted')
      .action(() => console.log(`world heard: ${heard}`))
  );
  return { heard: () => heard };
};
