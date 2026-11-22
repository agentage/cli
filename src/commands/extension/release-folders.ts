import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Folder = { rel: string; id: string };

type Json = Record<string, unknown>;

// A missing file reads as undefined; a file that is not JSON stops the release.
const readJson = (file: string): Promise<Json | undefined> =>
  readFile(file, 'utf8').then(
    (text) => JSON.parse(text) as Json,
    () => undefined
  );

const idAt = async (root: string, rel: string): Promise<string | undefined> => {
  const pkg = await readJson(join(root, rel, 'package.json'));
  const id = (pkg?.['agentage'] as Json | undefined)?.['id'];
  return typeof id === 'string' ? id : undefined;
};

// Each extensions/<name> with an agentage package; with none, the root package is the one extension.
export const extensionFolders = async (root: string): Promise<Folder[]> => {
  const entries = await readdir(join(root, 'extensions'), { withFileTypes: true }).catch(() => []);
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const folders: Folder[] = [];
  for (const name of names.sort()) {
    const id = await idAt(root, join('extensions', name));
    if (id) folders.push({ rel: join('extensions', name), id });
  }
  if (folders.length > 0) return folders;
  const id = await idAt(root, '.');
  return id ? [{ rel: '.', id }] : [];
};

const writeJson = async (file: string, value: unknown): Promise<void> =>
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

// The image source label and npm provenance both read `repository`: it names the releasing repo.
const repositoryOf = (repo: string, rel: string): Json => ({
  type: 'git',
  url: `git+https://github.com/${repo}.git`,
  ...(rel === '.' ? {} : { directory: rel }),
});

// The lock's root version too, so npm ci in the image reads the same package.
const writeLock = async (root: string, rel: string, version: string): Promise<string[]> => {
  const file = join(rel, 'package-lock.json');
  const lock = await readJson(join(root, file));
  if (!lock) return [];
  lock['version'] = version;
  const own = (lock['packages'] as Record<string, Json> | undefined)?.[''];
  if (own) own['version'] = version;
  await writeJson(join(root, file), lock);
  return [file];
};

// The CI copy only: never committed. Returns the files it wrote, relative to the root.
export const writeCiCopy = async (
  root: string,
  { rel }: Folder,
  version: string,
  repo: string
): Promise<string[]> => {
  const file = join(rel, 'package.json');
  const pkg = JSON.parse(await readFile(join(root, file), 'utf8')) as Json;
  pkg['version'] = version;
  pkg['repository'] = repositoryOf(repo, rel);
  await writeJson(join(root, file), pkg);
  return [file, ...(await writeLock(root, rel, version))];
};
