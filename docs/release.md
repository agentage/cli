# Release the cli

How `@agentage/cli` itself is released. The short form is in the
[README](../README.md#how-a-change-is-released).

Dispatch `prepare-release.yml` (a weekly schedule also dispatches it). It opens a
`chore(release): X.Y.Z` PR and arms auto-merge. On the merge, `release.yml` runs verify and the
cli tier of the shared end-to-end gate (in a private repo) on the packed cli, then publishes to npm with OIDC trusted publishing and
provenance, and pushes the tag `vX.Y.Z`. It skips a version already on npm.

- The publish worked but the tag push failed: push the tag by hand on the release commit
  (`git tag vX.Y.Z <release commit> && git push origin vX.Y.Z`); never publish again.
- The cli tier failed: fix the cli or the e2e test, then dispatch `release.yml` again.
- `release.yml` runs only the `@smoke` tests of that cli tier on the candidate. The
  lifecycle, execution and reload tests of the gate run on its own PRs against the published
  cli.
- Before the release PR merges, check: the PR checks of the release commit are green, and the cli
  project of the gate passes in full against the packed tarball of that commit
  (`AGENTAGE_CLI_TARBALL=<tgz> npm run test:cli -- --retries=0`).
