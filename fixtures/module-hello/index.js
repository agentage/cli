// @ts-check

/** @typedef {typeof import('@agentage/cli/module').MODULE_API_VERSION} ApiVersion */

/** @type {() => Promise<{ greet: () => string }>} */
export const register = async () => ({ greet: () => 'hello from hello' });
