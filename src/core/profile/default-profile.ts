import { SCHEMA_VERSION, type Profile } from './schema.js';

// No plugin is published yet, so a machine without a profile starts with none.
export const defaultProfile = (): Profile => ({
  version: SCHEMA_VERSION,
  plugins: {},
  config: {},
  machines: {},
  extra: {},
});
