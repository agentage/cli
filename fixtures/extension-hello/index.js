// @ts-check

/** @import { ExtensionContext } from '@agentage/cli/extension' */

/** @param {ExtensionContext} ctx */
export const register = async (ctx) => {
  const greet = () => `${ctx.config['greeting']} from ${ctx.id}`;
  // What it sees of the environment: the core removes AGENTAGE_TOKEN before loading.
  ctx.log('registered', { greeting: greet(), token: 'AGENTAGE_TOKEN' in process.env });
  ctx.commands.add((program) =>
    program
      .command('hello')
      .description('Print the greeting')
      .action(() => console.log(greet()))
  );
  return { greet };
};
