# Profiles and extensions on a machine

A **profile** is the list of extensions your account wants: package names, version ranges, and
which ones are off on which machine. The CLI brings each machine to its profile. Extensions
are on by default. A machine whose profile names no extensions has none. Flags and exit codes are in [`reference.md`](reference.md).

## The profile in your account

Signed in, `setup` reads the profile your account holds, so every machine you set up gets the same
extensions. `extension install` and `extension remove` save the change there. When your account
has no profile, `setup` says so on one line and carries on. Each machine you run `setup` on
appears in your account as one of its machines.

## Install, run and remove

Use `agentage extension install probe` for a short name. It means `@agentage/extension-probe`,
else `agentage-extension-probe`. With a bare name, the command asks the market for the newest
version. The market is the extension directory of the site. When the market does not answer, it prints
`market unavailable, versions not checked` and installs through npm. That line is harmless.

To run extension commands, use `agentage <command>` or `agentage <id> <command>`. Install is
idempotent: a second install of the same extension prints `added` again and changes nothing.

```bash
agentage setup --check                             # exit 1 when this machine differs from its profile
agentage extension install example                 # short name for @agentage/extension-example
agentage extension install ./my-extension          # a local folder, for development
agentage extension install .                       # link the working copy you are in
agentage extension remove example                  # take it out again
agentage ping                                      # a command an installed extension contributes
agentage probe ping                                # the same, by its extension id
```

## Command names

An extension built on the extension kit (the `@agentage/extension` library) lists its commands in
its manifest. Each runs as `agentage <command>` and always as `agentage <id> <command>`. A command
name can already be taken: by a core command, an extension id or another extension's earlier
install. Then only `agentage <id> <command>` runs it. The install tells you when this happens.

## States

`extension list` shows one state per extension:

| State       | Meaning                                                              |
| ----------- | -------------------------------------------------------------------- |
| `installed` | in the installed tree and ready to load                              |
| `off`       | installed, but this machine's profile entry turns it off             |
| `blocked`   | an extension it needs is not `installed`                             |
| `invalid`   | its manifest, config, integrity or dev folder is wrong; never loaded |
| `missing`   | the profile names it but the tree does not hold it                   |

`last run: ok` is the result of the last load, not the state.

## The plan

The plan is what `setup` would change, one line per extension (`+ add`, `~ update`, `- remove`,
`o off`) and a summary such as `plan: 1 to add, 0 to update, 0 to remove, 0 off, 2 unchanged`.
`setup --dry-run` prints it. `setup --check` exits 1 when anything would change. `extension list`
shows it per extension. `status` sums it up, for example `extensions 2 (1 to add)`.

## Updates

`setup --latest` moves each extension to the newest version its range allows and prints one line
per change, such as `~ update @agentage/example 1.0.0 -> 1.0.1`. The new versions are used only
when every extension loads cleanly from them. Until then, the old versions stay in use. A version
that needs a newer extension API than this CLI has is skipped, here and by `extension install`.

## The profile file

A profile is a JSON file that maps package names to version ranges. `registries` is optional.
It routes a scope to another npm-compatible registry. Everything else comes from npm's public
registry.

```json
{
  "version": 1,
  "extensions": { "@agentage/example": "^1.0.0" },
  "registries": { "@acme": "https://npm.acme.example" }
}
```
