// @ts-check

/** @typedef {typeof import('@agentage/cli/module').MODULE_API_VERSION} ApiVersion */

/** @type {(ctx: { use: (id: string) => { greet: () => string } }) => Promise<{ greeting: () => string }>} */
export const register = async (ctx) => {
  const greeting = ctx.use('hello').greet();
  return { greeting: () => greeting };
};
