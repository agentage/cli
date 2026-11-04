// @ts-check

/** @typedef {{ log: (...data: unknown[]) => void }} Out */

/** @param {{ out: Out, args: Record<string, unknown> }} ctx */
export const create = ({ out, args }) => ({
  ping: async () => {
    out.log(args['msg'] ? `pong ${args['msg']}` : 'pong');
    return 0;
  },
});
