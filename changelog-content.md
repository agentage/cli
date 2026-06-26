### New Features
- Add `setup` and `status` commands as part of the agentage Memory client reboot
- Add daemon autostart on boot/login (platform-aware configuration)
- Handle machine tombstoned state (410 response) gracefully in the daemon

### Improvements
- Route daemon version-mismatch notice and update notice to stderr for cleaner stdout output
- Reduce update-check cache from 24h to 1h for more timely update notifications
