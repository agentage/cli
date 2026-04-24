# Changelog

All notable changes to Agentage CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.20.3] - 2026-04-24

### New Features
- Add `setup mcp` subcommand to configure MCP (Model Context Protocol) settings in current directory

## [0.20.2] - 2026-04-23

### New Features
- Add machine metrics endpoint for monitoring system performance via API

### Infrastructure
- Improve CI automation with fallback squash merge for clean-status PRs

## [0.20.1] - 2026-04-22

### New Features
- Add CPU count and load average metrics to daemon heartbeat monitoring

## [0.20.0] - 2026-04-22

### New Features
- Add CPU, memory, and disk metrics collection in daemon heartbeat
- Replace separate init/login/logout commands with unified `agentage setup` command
- Expose control-plane action registry via HTTP and WebSocket APIs

### Documentation
- Rewrite Quick Start guide as streamlined 5-minute onboarding walkthrough

## [Unreleased]

### BREAKING

- Replace `agentage init`, `agentage login`, `agentage logout` with unified `agentage setup` command. Interactive by default (one confirmation prompt), fully headless with `--yes` / `--token` / `--machine-id` flags. `--disconnect` replaces `logout`; `--reauth` re-runs OAuth. Callers invoking the old commands will receive `unknown command` from Commander.

## [0.19.0] - 2026-04-19

### New Features
- Add recursive project discovery with configurable directory ignore patterns
- Send default agent and project configurations in heartbeat synchronization

## [0.18.1] - 2026-04-17

### Bug Fixes
- Fix daemon machine identity persistence by storing in machine.json file

## [0.18.0] - 2026-04-17

### New Features
- Add support for configurable agents and projects directories with default and additional paths

## [0.17.1] - 2026-04-17

### New Features
- Add schedules subcommands to CLI for managing scheduled agent tasks
- Add cron scheduler module to daemon for automated agent execution

### Bug Fixes
- Fix project loading to automatically recover from ghost entries and sync missing remote projects

### Improvements
- Update core dependencies to latest versions

## [0.17.0] - 2026-04-15

### New Features
- Add WebSocket event emission when runs start to ensure child runs appear in the hub
- Add `ctx.run()` dispatch functionality with parent-child run linkage

### Bug Fixes
- Fix task parameter to be optional when agent's input schema allows it

## [0.16.0] - 2026-04-15

### New Features
- Add validation of agent results against output schema defined in manifest

## [0.15.0] - 2026-04-13

### New Features
- Add input validation for agent runs against defined schemas
- Add standalone file-path mode for running agents directly from files

### Bug Fixes
- Fix agent run command to accept empty prompts

## [0.14.4] - 2026-04-10

### Bug Fixes
- Fix hub sync to properly include discovered and remote agent data in heartbeat payload

## [0.14.3] - 2026-04-09

### Bug Fixes
- Fix project commands to return proper exit codes when errors occur

## [0.14.2] - 2026-04-09

### New Features
- Capture git origin URL when discovering or adding projects

## [0.14.1] - 2026-04-09

### New Features
- Add upgrade hint in status command when newer version is available

### Bug Fixes
- Fix projects.json schema validation with automatic rewrite on mismatch

## [0.14.0] - 2026-04-09

### New Features
- Add projects registry with auto-discovery and worktree support
- Add `agentage projects` command to list and manage discovered projects
- Wire projects into run, status, API, and heartbeat functionality
- Add in-progress PR validation comment support

### Bug Fixes
- Fix hub status to show 'connecting' during WebSocket handshake instead of incorrect status

### Documentation
- Fix daemon default port in README (correct port is 4243, not 3100)
- Document daemon hub resilience features including heartbeat and retry mechanisms

## [0.13.1] - 2026-03-29

### New Features
- Add version information display in `agentage status` command
- Add automatic daemon self-update when version mismatch is detected

### Infrastructure
- Add automated release preparation workflow with auto-merge capability
- Add release workflow gating to ensure proper publish process

### Bug Fixes
- Fix package-lock.json synchronization with @anthropic-ai/sdk dependency

## [0.13.0] - 2026-03-29

### New Features
- Add version information display to `agentage status` command
- Add automatic daemon self-update when version mismatch is detected
- Add automated release preparation workflow with auto-merge capability

### Bug Fixes
- Fix package-lock.json synchronization with Anthropic SDK dependency
- Fix release workflow patterns for squash merge compatibility

### Infrastructure
- Add release workflow enforcement with publication gates and PR guards
- Align release PR format with desktop application standards

