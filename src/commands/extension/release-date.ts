// The three numbers of a plain version: no prerelease, no leading zero.
const PLAIN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

type Numbers = [number, number, number];

export const tagOf = (id: string, version: string): string => `${id}@${version}`;

// The version of `<id>@<x.y.z>`; undefined for another id or another form.
export const versionOfTag = (id: string, tag: string): string | undefined => {
  const version = tag.startsWith(`${id}@`) ? tag.slice(id.length + 1) : '';
  return PLAIN.test(version) ? version : undefined;
};

const numbersOf = (version: string): Numbers => version.split('.').map(Number) as Numbers;

const compare = (a: Numbers, b: Numbers): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// The highest `<id>@*` tag by number, never by text: 2027.105.1 is after 2026.1231.9.
export const lastTag = (id: string, tags: string[]): string | undefined => {
  const plain = tags.flatMap((tag) => {
    const version = versionOfTag(id, tag);
    return version ? [{ tag, n: numbersOf(version) }] : [];
  });
  return plain.sort((a, b) => compare(a.n, b.n)).pop()?.tag;
};

// YYYY.MDD of a UTC day: month times 100 plus day, so it never has a leading zero.
export const dayOf = (now: Date): string =>
  `${now.getUTCFullYear()}.${(now.getUTCMonth() + 1) * 100 + now.getUTCDate()}`;

// YYYY.MDD.N: N is one more than the highest N tagged for this id on this UTC day.
export const dateVersion = (id: string, tags: string[], now: Date): string => {
  const day = dayOf(now);
  const taken = tags
    .map((tag) => versionOfTag(id, tag))
    .filter((v): v is string => v?.startsWith(`${day}.`) === true)
    .map((v) => numbersOf(v)[2]);
  return `${day}.${Math.max(0, ...taken) + 1}`;
};
