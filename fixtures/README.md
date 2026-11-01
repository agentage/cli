# fixtures

Test-only module packages used by the e2e suite. Never published; each is scoped
`@agentage/fixture-*`. The e2e registry packs every `module-*` folder with `npm pack` and serves
it on loopback, so `setup --profile` installs them the way it installs real modules.

| Fixture             | `agentage.id` | What it covers                                             |
| ------------------- | ------------- | ---------------------------------------------------------- |
| `module-hello`      | `hello`       | contributes the `hello` command; returns `{ greet() }`     |
| `module-world`      | `world`       | peer-depends on `@agentage/fixture-hello`; command `world` |
| `module-old-engine` | `oldengine`   | `engines.agentage: "^0.1"`, never matches the module API   |
| `module-dup-id`     | `hello`       | claims the same id as `module-hello`                       |

`profiles/` holds the profile files the specs pass to `setup --profile`:

| Profile          | Modules                                  | Used for                                        |
| ---------------- | ---------------------------------------- | ----------------------------------------------- |
| `two.json`       | hello + world                            | a normal install                                |
| `all.json`       | every fixture                            | `invalid` (duplicate id, old engine), `blocked` |
| `off-hello.json` | hello + world, hello off on `m_0000beef` | `off` and the `blocked` dependent               |
| `missing.json`   | hello + a package the registry lacks     | a failed npm run                                |
| `scope-bad.json` | a name outside `@agentage`               | the scope rule                                  |
| `spec-bad.json`  | a `file:` version                        | the version rule                                |
