# e2e/core - extension scenarios

Each test is one requirement, written for a person: the title says what must hold and names the
command you would type; the body runs it, checks the exit code, the lines you would look for, and
the one file that proves it.

- `cli.ts` - the kit. `cli` is a fresh machine (temp config dir and HOME,
  `AGENTAGE_EXTENSIONS=1`) wired to a loopback site and a loopback npm registry serving
  `fixtures/extension-*`.
  `cli.run('setup --profile fixtures/profiles/two.json')` gives `{ code, stdout, stderr, lines }`;
  `cli.file()`, `cli.exists()` and `cli.list()` read the config dir; `launcherMachine(env)` makes another.
- `setup.test.ts`, `extension-list.test.ts`, `status.test.ts` - one `test.describe` per command.

Run: `npm run build && npx playwright test e2e/core`. Every spec is `@offline`: loopback only, no secrets.
