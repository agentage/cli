// @ts-check

/** @typedef {{ log: (...data: unknown[]) => void }} Out */

/** @param {{ out: Out }} ctx */
export const create = ({ out }) => ({
  ping: async () => {
    out.log('pong from pong');
    return 0;
  },
  status: async () => {
    out.log('pong status');
    return 0;
  },
});
