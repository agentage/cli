import { SCHEMA_VERSION, type Profile } from './schema.js';

// No module is published yet, so a machine without a profile starts with none.
export const defaultProfile = (): Profile => ({
  version: SCHEMA_VERSION,
  modules: {},
  config: {},
  machines: {},
  extra: {},
});
