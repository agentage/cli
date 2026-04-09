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
