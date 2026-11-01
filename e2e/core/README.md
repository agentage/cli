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
  `@agentage/fixture-*`; `off` turns extensions off on this machine; `config` is the shared
  config by extension id).
  `cli.run(`setup --profile ${path}`)` gives `{ code, stdout, stderr, lines }`, and
  `cli.run('hello', { AGENTAGE_TOKEN: 'aga_x' })` adds to the environment for that run (an
  undefined value unsets a variable); `cli.file()`, `cli.exists()` and `cli.list()` read the
  config dir, `cli.write()` and `cli.remove()` change it; `cli.fixture('hello', { from: 'to' })`
  copies `fixtures/extension-hello` outside the config dir, replacing text in its `package.json`,
  for `extension install <path>`; `anotherMachine(env)` makes another machine in the same test.
  `files.ts` holds the kit's config-dir, hash and fixture-copy helpers.
- `cli.site` is the account the machine signs in to (`cli.signIn()` runs `setup --no-browser`
  through it), the same for every machine of the test: `cli.site.requests('/v1/profile')` lists
  what the CLI sent to the account routes (method, path, status, `ifMatch`, `ifNoneMatch`, `body`),
  `cli.site.store({ extensions: { hello: '^1.0.0' } })` stores a profile as another machine's push
  would and returns its etag, `cli.site.profile()` reads the stored one,
  `cli.site.conflict({ world: '^1' })` makes the next push meet another machine's push first,
  `cli.site.fail('profile')` or `cli.site.fail('machines', 'hang')` makes a route answer 503 or
  never, and `cli.site.machines()` lists the registered machines. `site.ts` builds it over the
  stub's state (`e2e/stub/account.ts`, `profile.ts`, `machines.ts`).
- `setup.test.ts` (install), `setup-load.test.ts` (load), `extension-install.test.ts`,
  `extension-remove.test.ts`, `extension-list.test.ts`, `extension-check.test.ts`,
  `delegate.test.ts` (`agentage <extension command>`), `status.test.ts` - one `test.describe` per
  command; `plan.test.ts` - the plan: `setup --dry-run`, `setup --check`, the drift in
  `extension list` and `status`, integrity drift; `cloud.test.ts` - the profile in your account
  (pull, create, push, the replay on a conflict, the account check); `machines.test.ts` - this
  machine in your account (register, seen, disconnected; failures change nothing).

Run: `npm run build && npx playwright test e2e/core`. Every spec is `@offline`: loopback only, no
secrets.
