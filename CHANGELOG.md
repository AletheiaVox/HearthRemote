# Changelog

## Unreleased

- Prevented the phone gateway from exhausting the Node.js heap when a slow or stale client cannot consume repeated application snapshots.
- Stopped high-volume global Hermes notifications such as `sessions.changed` from triggering duplicate full-snapshot broadcasts.
- Added a bounded WebSocket backlog so unhealthy browser connections are closed instead of retaining data indefinitely.
- Kept the hidden gateway launcher attached to its Node.js child and propagated failures so Windows Task Scheduler can restart a crashed gateway.
- Added regression coverage for non-mutating Hermes gateway events.

## 0.3.0-alpha.3

- Added an authenticated loopback compatibility bridge for current Hermes host validation.
- Moved the raw Hermes backend to private port 4511 while preserving client and tailnet port 4510.
- Added Hermes process supervision, automatic restart, rollback-safe task replacement, and Doctor coverage.
- Preserved existing profiles, models, client settings, and phone sessions without patching Hermes.

## 0.3.0-alpha.1

- Generalized host names, Windows paths, and tailnet endpoints.
- Added first-run Tailscale guidance and connection-file import.
- Added update-aware Codex runtime discovery and listener recovery.
- Added host setup, phone setup, and read-only Doctor scripts.
- Preserved native Windows and phone/PWA clients as first-class targets.
- Added optional Hermes configuration, profiles, conversations, and model selection.
- Added project selection and prompt attachments.
- Added mobile reading-size controls and transcript scroll preservation.
- Added rollback-safe adoption of legacy Hearth Remote tokens, paired phones, and Windows tasks.
- Documented headless host availability as a core remote-access feature.
