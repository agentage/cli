# Changelog

All notable changes to Agentage CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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

