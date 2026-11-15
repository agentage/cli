# Profiles and extensions on a machine

A **profile** is the list of extensions your account wants: package names, version ranges, and
which ones are off on which machine. The CLI brings each machine to its profile. Extensions
are on by default. A machine whose profile names no extensions has none. Flags and exit codes are in [`reference.md`](reference.md).

## The profile in your account

Signed in, `setup` reads the profile your account holds. On a new machine (no
`installation.json` yet) it installs those extensions once, through the daemon. After that each
machine keeps its own list: `extension install` and `extension remove` change only this machine
and are not saved to your account. When your account has no profile, `setup` says so on one line
and carries on. Each machine you run `setup` on
appears in your account as one of its machines.

## Install, run and remove

Use `agentage extension install probe` for a short name. It means `@agentage/extension-probe`.
With a bare name, the daemon asks the market for the newest version (the market is the extension
directory of the site). When the market does not answer, the install exits 1 with
`MARKET_UNAVAILABLE`; give an exact version (`probe@0.6.2`) to install without it.

To run extension commands, use `agentage <command>` or `agentage <id> <command>`. Install is
idempotent: a second install of the same version changes nothing.

```bash
agentage setup --check                             # exit 1 when this machine differs from its profile
agentage extension install example                 # short name for @agentage/extension-example
agentage extension install ./my-extension          # a local folder, for development
agentage extension install .                       # run the working copy you are in, in place
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

`extension list` shows the daemon's state of each extension: `starting`, `running`, `failed`
(with the reason) or `disabled`. `extension doctor` loads each once and prints `ok` or why not.

## The plan

The plan is what `setup` would install through the daemon, one line per extension (`+ add`, or
`o off` for one installed disabled) and a summary such as
`plan: 1 to add, 0 off, 2 already installed`. `setup --dry-run` prints it. `setup --check` exits 1
when anything would be installed.

## Updates

`agentage extension update` moves each market extension to the market's newest version
(`setup --latest` is its old name). See [`reference.md`](reference.md).

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
