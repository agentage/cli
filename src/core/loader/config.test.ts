import { describe, expect, it } from 'vitest';
import { checkConfig } from './config.js';

const configuration = {
  greeting: { type: 'string', default: 'hello', scope: 'shared' },
  retries: { type: 'number', default: 3, scope: 'machine' },
  token: { type: 'string', secret: true },
};

describe("an extension's config", () => {
  it('fills the declared defaults and keeps keys the manifest does not declare', () => {
    expect(checkConfig('hello', configuration, { retries: 5, extra: true })).toEqual({
      config: { greeting: 'hello', retries: 5, extra: true },
      secrets: ['token'],
      problem: null,
    });
  });

  it('never holds a secret key: secrets live in ctx.secrets', () => {
    expect(checkConfig('hello', configuration, { token: 'leaked' }).config).not.toHaveProperty(
      'token'
    );
  });

  it.each([
    [{ greeting: 3 }, 'config.hello.greeting: must be of type string (got number)'],
    [{ retries: '5' }, 'config.hello.retries: must be of type number (got string)'],
    [{ greeting: null }, 'config.hello.greeting: must be of type string (got null)'],
  ])('refuses %j, naming the key', (slice, problem) => {
    expect(checkConfig('hello', configuration, slice).problem).toBe(problem);
  });

  it.each([
    ['flag', { type: 'boolean' }, 'yes', 'must be of type boolean (got string)'],
    ['list', { type: 'array' }, {}, 'must be of type array (got object)'],
    ['map', { type: 'object' }, [], 'must be of type object (got array)'],
  ])('checks %s as %j', (key, declared, value, problem) => {
    expect(checkConfig('x', { [key]: declared }, { [key]: value }).problem).toBe(
      `config.x.${key}: ${problem}`
    );
  });

  it('refuses a declaration without a known type, naming it', () => {
    expect(checkConfig('x', { a: { type: 'int' } }, {}).problem).toBe(
      'agentage.configuration.a.type must be one of string, number, boolean, array, object'
    );
  });
});
