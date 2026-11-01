# fixtures

Test-only extension packages used by the unit and e2e suites. Never published; each is scoped
`@agentage/fixture-*`. The e2e registry packs every `extension-*` folder with `npm pack` and serves
it on loopback, so `setup --profile` installs them the way it installs real extensions; the unit
kit (`src/test/config-dir.ts`) copies them into hand-placed trees.

| Fixture                | `agentage.id` | What it covers                                                                                                                                                                                                                                       |
| ---------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension-hello`      | `hello`       | `configuration.greeting` (default "hello"); command `hello` prints `hello from hello`, `hello --previous` prints `previous version: <ctx.previousVersion or none>`; logs what it sees of `AGENTAGE_TOKEN` and `previousVersion`; returns `{ greet }` |
| `extension-world`      | `world`       | peer-depends on `@agentage/fixture-hello`; `ctx.use('hello').greet()`, typed by the `ExtensionApis` entry in `apis.d.ts`; command `world`                                                                                                            |
| `extension-throws`     | `throws`      | prints a line, then `register` throws `Error('boom')`                                                                                                                                                                                                |
| `extension-slow`       | `slow`        | `register` never resolves (e2e sets `AGENTAGE_REGISTER_TIMEOUT_MS=500`)                                                                                                                                                                              |
| `extension-secret`     | `secret`      | declares `configuration.token` with `secret: true` and a `description`, and `configuration.access` with `enum: ["read", "write"]`                                                                                                                    |
| `extension-old-engine` | `oldengine`   | `engines.agentage: "^0.1"`, never matches the extension API                                                                                                                                                                                          |
| `extension-dup-id`     | `hello`       | claims the same id as `extension-hello`                                                                                                                                                                                                              |

Each entry is plain ESM, type-checked against `@agentage/cli/extension` by `tsc -p fixtures`
(with the `.d.ts` files, so `extension-world` checks the typed `ctx.use`).
Profiles are written per test: `cli.profile()` in `e2e/core/cli.ts` and `dir.profile()` in the
unit kit take the short names (`hello` for `@agentage/fixture-hello`). A folder is also a dev
extension as it is: `extension install ./fixtures/extension-hello`, or `cli.fixture('hello')` for
an edited copy.

## Testing an extension of your own

An extension's unit tests need no CLI: `createTestContext(overrides)` from
`@agentage/cli/extension/test` builds the `ctx` that `register` gets, with `mode: 'test'`, `data`
and `cache` in a fresh temp dir, secrets in memory and a silent `log`. Pass `use` to stand in for
peers (`use: { hello: { greet: () => 'hi' } }`; any other id throws unless optional) and
`program`, a commander `Command`, to collect the commands `register` adds; any other member of the
context can be overridden too.

Then call `register(ctx)` and run a command with `program.parseAsync(['world'], { from: 'user' })`:
for `extension-world` with the fake above it prints `world heard: hi`. Everything the test touches
is in memory or under the temp dir, so tests can run in parallel. The full recipe is in
[`docs/reference.md`](../docs/reference.md#extension-context).
