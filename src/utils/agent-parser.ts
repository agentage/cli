import { readFile } from 'fs/promises';
import { parse } from 'yaml';

export interface AgentFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  tools?: string[];
  handoffs?: string[];
  'argument-hint'?: string;
  'mcp-servers'?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ParsedAgent {
  frontmatter: AgentFrontmatter;
  content: string;
  body: string;
}

/**
 * Extract frontmatter from .agent.md content
 */
export const extractFrontmatter = (content: string): AgentFrontmatter => {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  try {
    return parse(match[1]) as AgentFrontmatter;
  } catch {
    return {};
  }
};

/**
 * Parse a full agent file into frontmatter and body
 */
export const parseAgentFile = (content: string): ParsedAgent => {
  const frontmatter = extractFrontmatter(content);
  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1].trim() : content;

  return {
    frontmatter,
    content,
    body,
  };
};

/**
 * Read and parse an agent file from disk
 */
export const readAgentFile = async (filePath: string): Promise<ParsedAgent> => {
  const content = await readFile(filePath, 'utf-8');
  return parseAgentFile(content);
};

/**
 * Generate a date-based version string (YYYY-MM-DD)
 */
export const generateDateVersion = (): string => {
  const now = new Date();
  return now.toISOString().split('T')[0];
};

/**
 * Validate agent name format (lowercase alphanumeric with hyphens)
 */
export const isValidAgentName = (name: string): boolean =>
  /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name);

/**
 * Parse agent identifier: owner/name[@version]
 */
export const parseAgentIdentifier = (
  identifier: string
): { owner?: string; name?: string; version?: string } => {
  const [fullName, version] = identifier.split('@');
  const parts = fullName.split('/');

  if (parts.length === 1) {
    // Just name without owner
    return { name: parts[0], version };
  }

  if (parts.length === 2) {
    return { owner: parts[0], name: parts[1], version };
  }

  return {};
};
