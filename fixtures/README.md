# fixtures

Test-only extension packages used by the unit and e2e suites. Never published; each is scoped
`@agentage/fixture-*`. The e2e registry packs every `extension-*` folder with `npm pack` and serves
it on loopback, so `setup --profile` installs them the way it installs real extensions; the unit
kit (`src/test/config-dir.ts`) copies them into hand-placed trees.

| Fixture                | `agentage.id` | What it covers                                              |
| ---------------------- | ------------- | ----------------------------------------------------------- |
| `extension-hello`      | `hello`       | contributes the `hello` command; returns `{ greet() }`      |
| `extension-world`      | `world`       | peer-depends on `@agentage/fixture-hello`; command `world`  |
| `extension-old-engine` | `oldengine`   | `engines.agentage: "^0.1"`, never matches the extension API |
| `extension-dup-id`     | `hello`       | claims the same id as `extension-hello`                     |

Profiles are written per test: `cli.profile()` in `e2e/core/cli.ts` and `dir.profile()` in the
unit kit take the short names `hello`, `world`, `old-engine` and `dup-id`.
