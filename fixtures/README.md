# fixtures

Test-only extension packages used by the unit and e2e suites. Never published; each is scoped
`@agentage/fixture-*`. The e2e registry packs every `extension-*` folder with `npm pack` and serves
it on loopback, so `setup --profile` installs them the way it installs real extensions; the unit
kit (`src/test/config-dir.ts`) copies them into hand-placed trees.

| Fixture                | `agentage.id` | What it covers                                                                                                                                    |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension-hello`      | `hello`       | `configuration.greeting` (default "hello"); command `hello` prints `hello from hello`; logs what it sees of `AGENTAGE_TOKEN`; returns `{ greet }` |
| `extension-world`      | `world`       | peer-depends on `@agentage/fixture-hello`; `ctx.use('hello').greet()`; command `world`                                                            |
| `extension-throws`     | `throws`      | prints a line, then `register` throws `Error('boom')`                                                                                             |
| `extension-slow`       | `slow`        | `register` never resolves (e2e sets `AGENTAGE_REGISTER_TIMEOUT_MS=500`)                                                                           |
| `extension-secret`     | `secret`      | declares `configuration.token` with `secret: true`                                                                                                |
| `extension-old-engine` | `oldengine`   | `engines.agentage: "^0.1"`, never matches the extension API                                                                                       |
| `extension-dup-id`     | `hello`       | claims the same id as `extension-hello`                                                                                                           |

Each entry is plain ESM, type-checked against `@agentage/cli/extension` by `tsc -p fixtures`.
Profiles are written per test: `cli.profile()` in `e2e/core/cli.ts` and `dir.profile()` in the
unit kit take the short names (`hello` for `@agentage/fixture-hello`). A folder is also a dev
extension as it is: `extension install ./fixtures/extension-hello`, or `cli.fixture('hello')` for
an edited copy.
