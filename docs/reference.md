# Command reference

Every `agentage` command, its exit codes and environment variables. Run
`agentage <command> --help` for the authoritative flags. Global flags: `-V, --version`
prints the version, `-h, --help` prints help.

## setup

```bash
agentage setup                # browser OAuth 2.1 sign-in (PKCE), then prints status
agentage setup --no-browser   # print the sign-in URL instead of opening a browser
agentage setup --reauth       # force a fresh sign-in
agentage setup --disconnect   # sign out and remove local credentials
```

No passwords touch the terminal; tokens are stored in `~/.agentage/auth.json`
(mode 0600). Running `setup` while signed in validates the session and prints status
instead of starting a new sign-in; an expired session falls through to a fresh sign-in.

## status

```bash
agentage status                   # version, update, target, sign-in state, endpoint
agentage status --json            # the same report as JSON on stdout
agentage status --token aga_...   # check with a personal access token
```

`status` also surfaces a passive hint when a newer version is available.

## update

```bash
agentage update           # install the latest published version via npm
agentage update --check   # report whether an update is available, don't install
```

`update` needs npm 10 or newer and prints npm's last output lines if the install fails.

## Token auth (CI and headless)

Machines without a browser authenticate with a personal access token. Mint one in the
dashboard under **Settings -> API tokens**, then set `AGENTAGE_TOKEN=aga_...` or pass
`--token aga_...` per command. A token takes precedence over a stored sign-in.

## Exit codes

| Code | Meaning                                                                      |
| ---- | ---------------------------------------------------------------------------- |
| `0`  | Success, including `--help`, `--version`, and `status` while signed out      |
| `1`  | A step failed: sign-in or update failed, or an invalid token                 |
| `2`  | Usage error: an unknown command or flag, a missing flag value, or no command |

Errors go to stderr; stdout carries only command output (`status --json` stays parseable).

## Environment

| Variable              | Purpose                                            | Default       |
| --------------------- | -------------------------------------------------- | ------------- |
| `AGENTAGE_SITE_FQDN`  | Target host                                        | `agentage.io` |
| `AGENTAGE_CONFIG_DIR` | Config and credentials directory (`auth.json`)     | `~/.agentage` |
| `AGENTAGE_TOKEN`      | Personal access token for CI and headless machines | unset         |
| `NO_COLOR`            | Disable colored output (any non-empty value)       | unset         |
