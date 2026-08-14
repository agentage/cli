// Estate test-traffic contract: the edge classifier keys on this exact header to keep e2e out of real-user metrics.
export const CLIENT_TYPE_HEADER = 'x-client-type';
export const CLIENT_TYPE_TEST = 'test';

export const testClientHeader = (): Record<string, string> => ({
  [CLIENT_TYPE_HEADER]: CLIENT_TYPE_TEST,
});
