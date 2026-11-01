// @ts-check

/** @import { ExtensionContext } from '@agentage/cli/extension' */

/** @param {ExtensionContext} ctx */
export const register = async (ctx) => {
  const greet = () => `${ctx.config['greeting']} from ${ctx.id}`;
  const previous = `previous version: ${ctx.previousVersion ?? 'none'}`;
  // What it sees: the core removes AGENTAGE_TOKEN before loading, and passes the last ok version.
  ctx.log('registered', {
    greeting: greet(),
    token: 'AGENTAGE_TOKEN' in process.env,
    previousVersion: ctx.previousVersion,
  });
  ctx.commands.add((program) =>
    program
      .command('hello')
      .description('Print the greeting')
      .option('--previous', 'print the version that last loaded ok on this machine')
      .action((opts) => console.log(opts.previous ? previous : greet()))
  );
  return { greet };
};
