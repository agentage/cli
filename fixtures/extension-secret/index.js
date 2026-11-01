// @ts-check

/** @import { ExtensionContext } from '@agentage/cli/extension' */

/** @param {ExtensionContext} ctx */
export const register = async (ctx) => ({
  hasToken: async () => (await ctx.secrets.get('token')) !== undefined,
});
