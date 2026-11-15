import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A built kit extension with an api part (echo, the echo.prefix and echo.repeat settings) and a
// cli part, as npm unpacks @agentage/extension-<id>; no dependencies.
const API = `export const create = (ctx) => (req, res) => {
  const url = new URL(req.url, 'http://x');
  const prefix = ctx.settings?.['echo.prefix'];
  const repeat = ctx.settings?.['echo.repeat'] ?? 1;
  const msg = Array(repeat).fill(url.searchParams.get('msg') ?? '').join(' ');
  res.status(200).json({ success: true, data: { msg: (prefix ? prefix + ' ' : '') + msg } });
};
`;

const SETTINGS = {
  'echo.prefix': { type: 'string', default: '' },
  'echo.repeat': { type: 'integer', default: 1 },
};

export const writeKitExtension = (
  dir: string,
  id: string,
  version: string,
  engine = '>=0.12'
): string => {
  for (const sub of ['dist/api', 'dist/cli']) mkdirSync(join(dir, sub), { recursive: true });
  const command = `${id}-ping`;
  const agentage = {
    id,
    parts: { api: true, cli: true },
    commands: [{ name: command, summary: 'answer pong' }],
    settings: SETTINGS,
  };
  const pkg = { name: `@agentage/extension-${id}`, version, type: 'module', agentage };
  const built = { id, version, parts: { api: {}, cli: {} }, commands: [command] };
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ ...pkg, engines: { node: '>=22', agentage: engine } })
  );
  writeFileSync(join(dir, 'dist/agentage-extension.json'), JSON.stringify(built));
  writeFileSync(join(dir, 'dist/api/index.js'), API);
  const cli = `export function create({ out }) {\n  return { '${command}': async () => (out.log('pong'), 0) };\n}\n`;
  writeFileSync(join(dir, 'dist/cli/index.js'), cli);
  return dir;
};
