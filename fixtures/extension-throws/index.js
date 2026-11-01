// @ts-check

export const register = async () => {
  console.log('throws is about to throw');
  throw new Error('boom');
};
