import {
  extractFrontmatter,
  generateDateVersion,
  isValidAgentName,
  parseAgentFile,
  parseAgentIdentifier,
} from './agent-parser.js';

describe('agent-parser', () => {
  describe('extractFrontmatter', () => {
    test('extracts valid frontmatter', () => {
      const content = `---
name: test-agent
description: A test agent
version: 2025-11-30
---
You are a helpful assistant.`;

      const result = extractFrontmatter(content);

      expect(result.name).toBe('test-agent');
      expect(result.description).toBe('A test agent');
      expect(result.version).toBe('2025-11-30');
    });

    test('returns empty object for missing frontmatter', () => {
      const content = 'Just plain text without frontmatter';
      const result = extractFrontmatter(content);
      expect(result).toEqual({});
    });

    test('returns empty object for invalid YAML', () => {
      const content = `---
invalid: yaml: content: here
---
Body`;
      const result = extractFrontmatter(content);
      expect(result).toEqual({});
    });
  });

  describe('parseAgentFile', () => {
    test('parses full agent file', () => {
      const content = `---
name: my-agent
model: gpt-4
---
You are a helpful assistant.

## Instructions
Be kind and helpful.`;

      const result = parseAgentFile(content);

      expect(result.frontmatter.name).toBe('my-agent');
      expect(result.frontmatter.model).toBe('gpt-4');
      expect(result.content).toBe(content);
      expect(result.body).toContain('You are a helpful assistant.');
      expect(result.body).toContain('## Instructions');
    });

    test('handles content without frontmatter', () => {
      const content = 'Just plain text';
      const result = parseAgentFile(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });
  });

  describe('generateDateVersion', () => {
    test('generates date in YYYY-MM-DD format', () => {
      const version = generateDateVersion();
      expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('isValidAgentName', () => {
    test('accepts valid names', () => {
      expect(isValidAgentName('my-agent')).toBe(true);
      expect(isValidAgentName('agent123')).toBe(true);
      expect(isValidAgentName('a')).toBe(true);
      expect(isValidAgentName('test-agent-v2')).toBe(true);
    });

    test('rejects invalid names', () => {
      expect(isValidAgentName('My-Agent')).toBe(false);
      expect(isValidAgentName('-agent')).toBe(false);
      expect(isValidAgentName('agent-')).toBe(false);
      expect(isValidAgentName('agent_name')).toBe(false);
      expect(isValidAgentName('')).toBe(false);
    });
  });

  describe('parseAgentIdentifier', () => {
    test('parses owner/name format', () => {
      const result = parseAgentIdentifier('owner/my-agent');
      expect(result).toEqual({
        owner: 'owner',
        name: 'my-agent',
        version: undefined,
      });
    });

    test('parses owner/name@version format', () => {
      const result = parseAgentIdentifier('owner/my-agent@2025-11-30');
      expect(result).toEqual({
        owner: 'owner',
        name: 'my-agent',
        version: '2025-11-30',
      });
    });

    test('parses name-only format', () => {
      const result = parseAgentIdentifier('my-agent');
      expect(result).toEqual({ name: 'my-agent', version: undefined });
    });

    test('parses name@version format', () => {
      const result = parseAgentIdentifier('my-agent@1.0.0');
      expect(result).toEqual({ name: 'my-agent', version: '1.0.0' });
    });
  });
});
