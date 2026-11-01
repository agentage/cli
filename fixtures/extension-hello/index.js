// @ts-check

/** @typedef {typeof import('@agentage/cli/extension').EXTENSION_API_VERSION} ApiVersion */

/** @type {() => Promise<{ greet: () => string }>} */
export const register = async () => ({ greet: () => 'hello from hello' });
