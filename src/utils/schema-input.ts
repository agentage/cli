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

// Separate, stricter instance for validating agent outputs — don't mutate
// or coerce the agent's actual result payload.
const ajvOutput = new Ajv({ allErrors: true, strict: false });

const compile = (schema: JsonSchema): ValidateFunction => ajv.compile(schema);
const compileOutput = (schema: JsonSchema): ValidateFunction => ajvOutput.compile(schema);

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

export interface OutputValidationFailure {
  ok: false;
  errors: string[];
}
export interface OutputValidationSuccess {
  ok: true;
}
export type OutputValidationResult = OutputValidationSuccess | OutputValidationFailure;

export const validateOutput = (schema: JsonSchema, output: unknown): OutputValidationResult => {
  let validate: ValidateFunction;
  try {
    validate = compileOutput(schema);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`invalid outputSchema: ${message}`] };
  }
  const valid = validate(output);
  if (!valid) {
    const errors = (validate.errors ?? []).map(formatError);
    return { ok: false, errors: errors.length ? errors : ['output validation failed'] };
  }
  return { ok: true };
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
