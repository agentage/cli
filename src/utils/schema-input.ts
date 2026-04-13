import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

export type JsonSchema = Record<string, unknown>;
export type Input = Record<string, unknown>;

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export interface ValidationSuccess {
  ok: true;
  value: Input;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const ajv = new Ajv({ allErrors: true, coerceTypes: true, useDefaults: true, strict: false });

const compile = (schema: JsonSchema): ValidateFunction => ajv.compile(schema);

const formatError = (err: ErrorObject): string => {
  const path = err.instancePath || '/';
  return `${path} ${err.message ?? 'is invalid'}`;
};

export const parseInputJson = (raw: string): Input => {
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--input must be a JSON object');
  }
  return parsed as Input;
};

export const mergeInputs = (...layers: Array<Input | undefined>): Input => {
  const out: Input = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) out[k] = v;
  }
  return out;
};

export const validateInput = (schema: JsonSchema, input: Input): ValidationResult => {
  let validate: ValidateFunction;
  try {
    validate = compile(schema);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`invalid inputSchema: ${message}`] };
  }

  const candidate: Input = { ...input };
  const valid = validate(candidate);
  if (!valid) {
    const errors = (validate.errors ?? []).map(formatError);
    return { ok: false, errors: errors.length ? errors : ['validation failed'] };
  }
  return { ok: true, value: candidate };
};
