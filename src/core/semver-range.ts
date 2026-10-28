// Caret, tilde, x and comparator ranges joined by `||`; no hyphen ranges, no dist-tags.
interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

type Op = '<' | '<=' | '>' | '>=' | '=';

interface Comparator {
  op: Op;
  v: Version;
}

interface Partial {
  nums: number[];
  pre: string | null;
}

const WILD = /^[xX*]$/;
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const PARTIAL_RE =
  /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const COMPARATOR_RE = /^(\^|~|>=|<=|>|<|=)?(.+)$/;

const ver = (major: number, minor: number, patch: number, pre: string | null = null): Version => ({
  major,
  minor,
  patch,
  pre,
});

export const parseVersion = (text: string): Version | null => {
  const m = VERSION_RE.exec(text.trim());
  if (!m) return null;
  return ver(Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? null);
};

const parsePartial = (text: string): Partial | null => {
  const m = PARTIAL_RE.exec(text);
  if (!m) return null;
  const raw = [m[1], m[2], m[3]];
  const nums: number[] = [];
  for (const part of raw) {
    if (part === undefined || WILD.test(part)) break;
    nums.push(Number(part));
  }
  const concreteAfterWild = raw.slice(nums.length).some((p) => p !== undefined && !WILD.test(p));
  if (concreteAfterWild || (m[4] !== undefined && nums.length < 3)) return null;
  return { nums, pre: m[4] ?? null };
};

const lower = (p: Partial): Version => ver(p.nums[0] ?? 0, p.nums[1] ?? 0, p.nums[2] ?? 0, p.pre);

// Exclusive upper bound one step above part `i`; the `-0` keeps that version's prereleases out.
const bump = (p: Partial, i: number): Version => {
  const [a = 0, b = 0, c = 0] = p.nums;
  if (i <= 0) return ver(a + 1, 0, 0, '0');
  return i === 1 ? ver(a, b + 1, 0, '0') : ver(a, b, c + 1, '0');
};

const span = (p: Partial, i: number): Comparator[] => [
  { op: '>=', v: lower(p) },
  { op: '<', v: bump(p, i) },
];

const exact = (p: Partial): Comparator[] =>
  p.nums.length === 3 ? [{ op: '=', v: lower(p) }] : span(p, p.nums.length - 1);

const caretIndex = (nums: number[]): number => {
  const i = nums.findIndex((n) => n !== 0);
  return i === -1 ? nums.length - 1 : i;
};

const bounded = (op: Op, p: Partial): Comparator[] | null => {
  const n = p.nums.length;
  if (op === '>=') return [{ op, v: lower(p) }];
  if (op === '>') return n === 3 ? [{ op, v: lower(p) }] : [{ op: '>=', v: bump(p, n - 1) }];
  if (op === '<') return [{ op, v: n === 3 ? lower(p) : { ...lower(p), pre: '0' } }];
  return n === 3 ? [{ op, v: lower(p) }] : [{ op: '<', v: bump(p, n - 1) }];
};

const desugar = (op: string | undefined, p: Partial): Comparator[] | null => {
  if (p.nums.length === 0) return op === '>' || op === '<' ? null : [];
  if (op === undefined || op === '=') return exact(p);
  if (op === '~') return span(p, Math.min(p.nums.length - 1, 1));
  if (op === '^') return span(p, caretIndex(p.nums));
  return bounded(op as Op, p);
};

const parseComparator = (token: string): Comparator[] | null => {
  const m = COMPARATOR_RE.exec(token);
  const partial = m?.[2] === undefined ? null : parsePartial(m[2]);
  return m && partial ? desugar(m[1], partial) : null;
};

const parseSet = (set: string): Comparator[] | null => {
  const tokens = set
    .replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1')
    .trim()
    .split(/\s+/);
  if (tokens.length === 0 || tokens[0] === '') return null;
  const parsed = tokens.map(parseComparator);
  return parsed.some((c) => c === null) ? null : parsed.flatMap((c) => c ?? []);
};

export const parseRange = (range: string): Comparator[][] | null => {
  const sets = range.split('||').map(parseSet);
  return sets.some((s) => s === null) ? null : sets.map((s) => s ?? []);
};

export const isRange = (range: string): boolean => parseRange(range) !== null;

// Prereleases sort below their release, compared as plain strings (no identifier splitting).
const comparePre = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null || b === null) return a === null ? 1 : -1;
  return a < b ? -1 : 1;
};

const compareVersions = (a: Version, b: Version): number =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePre(a.pre, b.pre);

const holds = (c: Comparator, v: Version): boolean => {
  const d = compareVersions(v, c.v);
  if (c.op === '=') return d === 0;
  if (c.op === '<') return d < 0;
  if (c.op === '<=') return d <= 0;
  return c.op === '>' ? d > 0 : d >= 0;
};

export const satisfies = (version: string, range: string): boolean => {
  const v = parseVersion(version);
  const sets = parseRange(range);
  if (!v || !sets) return false;
  return sets.some((set) => set.every((c) => holds(c, v)));
};
