import { agentYamlSchema, type AgentYaml } from './agent.schema.js';

describe('agentYamlSchema', () => {
  test('validates correct agent configuration', () => {
    const validConfig = {
      name: 'test-agent',
      model: 'gpt-4',
      instructions: 'You are helpful',
      tools: ['tool1', 'tool2'],
      variables: { key1: 'value1', key2: 'value2' },
    };

    const result = agentYamlSchema.parse(validConfig);
    expect(result).toEqual(validConfig);
  });

  test('applies default values', () => {
    const minimalConfig = {
      name: 'test-agent',
      instructions: 'You are helpful',
    };

    const result = agentYamlSchema.parse(minimalConfig);
    expect(result.model).toBe('gpt-4');
    expect(result.tools).toEqual([]);
    expect(result.variables).toEqual({});
  });

  test('rejects empty name', () => {
    const invalidConfig = {
      name: '',
      instructions: 'You are helpful',
    };

    expect(() => agentYamlSchema.parse(invalidConfig)).toThrow();
  });

  test('rejects missing name', () => {
    const invalidConfig = {
      instructions: 'You are helpful',
    };

    expect(() => agentYamlSchema.parse(invalidConfig)).toThrow();
  });

  test('rejects empty instructions', () => {
    const invalidConfig = {
      name: 'test-agent',
      instructions: '',
    };

    expect(() => agentYamlSchema.parse(invalidConfig)).toThrow();
  });

  test('rejects missing instructions', () => {
    const invalidConfig = {
      name: 'test-agent',
    };

    expect(() => agentYamlSchema.parse(invalidConfig)).toThrow();
  });

  test('accepts optional tools array', () => {
    const config = {
      name: 'test-agent',
      instructions: 'You are helpful',
      tools: ['tool1'],
    };

    const result = agentYamlSchema.parse(config);
    expect(result.tools).toEqual(['tool1']);
  });

  test('accepts optional variables object', () => {
    const config = {
      name: 'test-agent',
      instructions: 'You are helpful',
      variables: { foo: 'bar' },
    };

    const result = agentYamlSchema.parse(config);
    expect(result.variables).toEqual({ foo: 'bar' });
  });

  test('type inference works correctly', () => {
    const config: AgentYaml = {
      name: 'test-agent',
      model: 'gpt-4',
      instructions: 'You are helpful',
      tools: [],
      variables: {},
    };

    expect(config.name).toBe('test-agent');
    expect(config.model).toBe('gpt-4');
  });
});
