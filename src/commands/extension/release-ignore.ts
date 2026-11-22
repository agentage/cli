import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Rule = { re: RegExp; keep: boolean };

// Anchored at the folder root: a deeper .md or docs/ may be served by the site or the image.
export const DEFAULT_IGNORE = [
  '/*.md',
  '/docs/**',
  '/.github/**',
  '/.repo-doctor.yml',
  '/.gitignore',
  '/.prettierrc*',
  '/.editorconfig',
  '/LICENSE',
];

// What goes into the image always counts, whatever an ignore pattern says.
export const ALWAYS_COUNTS = ['/package.json', '/package-lock.json', '/src/**', '/Dockerfile*'];

export const IGNORE_FILE = '.release-ignore';

const TOKENS: Record<string, string> = {
  '**/': '(?:.*/)?',
  '/**': '(?:/.*)?',
  '**': '.*',
  '*': '[^/]*',
  '?': '[^/]',
};

// Gitignore-style: a pattern with a slash is anchored to the folder, one without matches any depth.
export const globToRegex = (glob: string): RegExp => {
  const bare = glob.replace(/\/$/, '');
  const anchored = bare.includes('/');
  const body = bare
    .replace(/^\//, '')
    .replace(/\*\*\/|\/\*\*|\*\*|\*|\?|[.+^${}()|[\]\\]/g, (t) => TOKENS[t] ?? `\\${t}`);
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}$`);
};

const ruleOf = (line: string): Rule => {
  const keep = line.startsWith('!');
  return { re: globToRegex(keep ? line.slice(1) : line), keep };
};

export const parseIgnore = (text: string): Rule[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map(ruleOf);

// The path and each folder above it: `docs` also matches `docs/a.md`.
const candidates = (path: string): string[] =>
  path.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'));

const hits = (re: RegExp, path: string): boolean => candidates(path).some((p) => re.test(p));

// The last matching rule wins, as in .gitignore.
export const isIgnored = (rules: Rule[], path: string): boolean => {
  if (ALWAYS_COUNTS.some((g) => hits(globToRegex(g), path))) return false;
  let ignored = false;
  for (const rule of rules) if (hits(rule.re, path)) ignored = !rule.keep;
  return ignored;
};

const rulesAt = async (dir: string): Promise<Rule[]> => {
  const text = await readFile(join(dir, IGNORE_FILE), 'utf8').catch(() => '');
  return parseIgnore([...DEFAULT_IGNORE, text].join('\n'));
};

export type Sorted = { counted: string[]; ignored: string[] };

// `diff` names files from the repo root; the patterns read them from the extension folder.
export const sortChanged = async (root: string, rel: string, diff: string): Promise<Sorted> => {
  const rules = await rulesAt(join(root, rel));
  const prefix = rel === '.' ? '' : `${rel}/`;
  const files = diff.split('\0').filter(Boolean);
  const local = files.map((f) => f.slice(prefix.length));
  return {
    counted: local.filter((f) => !isIgnored(rules, f)),
    ignored: local.filter((f) => isIgnored(rules, f)),
  };
};

export const firstFive = (files: string[]): string => {
  const more = files.length > 5 ? ` and ${files.length - 5} more` : '';
  return `${files.slice(0, 5).join(', ')}${more}`;
};
