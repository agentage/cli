# fixtures

Test-only plugin packages used by the e2e suite. Never published; each is scoped `@agentage/fixture-*`.

| Fixture             | `agentage.id` | What it covers                                             |
| ------------------- | ------------- | ---------------------------------------------------------- |
| `plugin-hello`      | `hello`       | contributes the `hello` command; returns `{ greet() }`     |
| `plugin-world`      | `world`       | peer-depends on `@agentage/fixture-hello`; command `world` |
| `plugin-old-engine` | `oldengine`   | `engines.agentage: "^0.1"`, never matches the API          |
| `plugin-dup-id`     | `hello`       | claims the same id as `plugin-hello`                       |
