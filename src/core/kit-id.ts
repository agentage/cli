import { createRequire } from 'node:module';
import { isRecord, readJson } from '../lib/fs/json-file.js';

interface IdRule {
  pattern: RegExp;
  max: number;
}

let cached: IdRule | undefined;

// The kit's own id rule, read from the JSON schema it exports (data: no kit code is loaded).
const read = (): IdRule => {
  const file = '@agentage/extension/schemas/extension-package.schema.json';
  const schema = readJson(createRequire(import.meta.url).resolve(file), isRecord);
  const props = (o: unknown) => (isRecord(o) && isRecord(o['properties']) ? o['properties'] : {});
  const id = props(props(schema)['agentage'])['id'];
  if (!isRecord(id) || typeof id['pattern'] !== 'string' || typeof id['maxLength'] !== 'number')
    throw new Error(`${file} has no agentage.id rule`);
  return { pattern: new RegExp(id['pattern']), max: id['maxLength'] };
};

// Why the kit refuses the id (the daemon takes no such row), or null.
export const kitIdProblem = (id: string): string | null => {
  const rule = (cached ??= read());
  if (id.length > rule.max) return `the id ${id} is longer than ${rule.max} characters`;
  return rule.pattern.test(id) ? null : `the id ${id} is a name the platform owns or not lowercase`;
};
