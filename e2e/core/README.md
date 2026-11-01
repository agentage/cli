# e2e/core - extension scenarios

Every test starts on a new machine; nothing survives between tests.

Each test is one requirement, written for a person: the title says what must hold and names the
command you would type; the body runs it, checks the exit code, the lines you would look for, and
the one file that proves it.

- `cli.ts` - the kit. `cli` is that new machine: its own config dir, HOME, npm cache and npm
  userconfig, `AGENTAGE_EXTENSIONS=1`, and its own loopback site. The only thing tests share is a
  read-only loopback npm registry serving `fixtures/extension-*`.
  `cli.profile({ extensions: { hello: '^1.0.0', world: '^1' } })` writes a profile file that sends
  `@agentage` to that registry and returns its path (short names expand to
  `@agentage/fixture-*`; `off` turns extensions off on this machine).
  `cli.run(`setup --profile ${path}`)` gives `{ code, stdout, stderr, lines }`; `cli.file()`,
  `cli.exists()` and `cli.list()` read the config dir; `launcherMachine(env)` makes another
  machine in the same test.
- `setup.test.ts`, `extension-list.test.ts`, `status.test.ts` - one `test.describe` per command.

Run: `npm run build && npx playwright test e2e/core`. Every spec is `@offline`: loopback only, no
secrets.
