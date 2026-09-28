# Architecture

## Components

```text
Windows client (Electron)                    Windows host
┌────────────────────────┐                  ┌─────────────────────────────┐
│ sandboxed React UI     │                  │ Codex app-server :4500     │
│ narrow preload bridge  │── Tailscale ───▶ │ phone gateway :4520        │
│ DPAPI-protected token  │                  │ Hermes bridge :4510        │
└────────────────────────┘                  │   └─ Hermes backend :4511   │
                                            │ canonical tasks + projects │
                                            └─────────────────────────────┘

Phone browser / installed PWA
┌────────────────────────┐
│ paired device cookie   │── Tailscale HTTPS ────────────────▲
│ no capability token    │
└────────────────────────┘
```

All host backends bind to loopback. Tailscale Serve terminates tailnet TLS and forwards only to `127.0.0.1`.

When Hermes is enabled, Tailscale and the clients still use port 4510. A Hearth-managed compatibility bridge authenticates the existing capability token, rewrites the proxy-facing Host and Origin to loopback, and forwards to Hermes on port 4511. The same process supervises the Hermes child and restarts it after an exit. This preserves Hermes's loopback security mode without patching its version-sensitive installed source.

## Provider boundary

`ProviderService` owns an `AssistantAdapter`. Codex and Hermes implement the same snapshot/action contract, while provider descriptors declare capabilities. Hermes is optional and unavailable unless enabled during host setup. This keeps future local harnesses from leaking transport details into the renderer.

Hermes conversation discovery combines its ordinary multi-profile recents endpoint with an exact-title `session.list` lookup for each profile's canonical hidden `Bot Chat`. Only that supported identity is added; other hidden sessions remain excluded. Compression tips are opened through Hermes's returned `resolved_id` when present.

## Codex task ownership

Codex rejects a second active writer. Hearth Remote inspects host ownership, requests a normal desktop close, offers a separately confirmed targeted force-close if necessary, resumes only the selected task, unsubscribes loaded tasks when returning control, and recycles only the dedicated listener when needed to clear stale writer state.

The dedicated listener is headless and starts at Windows logon. Remote access requires the host to be awake and the user session to be logged in; it does not require the Codex desktop app to be open. Closing that app is normally preferable because it releases foreground ownership to Hearth Remote.

The listener supervisor discovers the newest complete installed runtime pair on every health cycle. This is the compatibility seam for Codex desktop updates.

## Phone gateway

The gateway serves the built PWA and a small authenticated WebSocket RPC surface. It maintains independent browser device sessions, never sends the host capability token to JavaScript, and disconnects from the backend after the last browser socket remains absent for 90 seconds.

Background snapshot refreshes do not force the transcript to the bottom when the reader has scrolled upward. Mobile reading size is reflow-based and stored locally; a two-finger gesture adjusts it without browser magnification.

## Configuration and local state

Runtime state stays outside the repository:

```text
%USERPROFILE%\.hearth-remote\host\
  app-server-token
  start-listener.ps1
  recycle-codex-listener.ps1
  handoff-desktop.ps1
  *.log
  hearth-gateway\
    devices.json
    pairing-code.json
  hermes-bridge\
    server.js
    *.log
```

The desktop client stores non-secret settings and a DPAPI-encrypted token in Electron's user-data directory. No `.codex` session database or project file is synchronized to clients.

## Trust boundaries

- The connection importer accepts a narrow JSON shape and requires WSS for remote Codex.
- The main process allowlists external setup links.
- The renderer has no Node integration and runs sandboxed.
- Browser RPC methods are enumerated; browsers cannot change host connection settings.
- The Hermes bridge permits only status without authentication; HTTP and WebSocket traffic otherwise requires the host capability token.
- Attachments have count, individual-size, and total-size limits before host writes.
- Codex attachments remain in the selected project's `.codex-remote-attachments` folder for task continuity. Projects should ignore that folder in version control; automatic cleanup would risk breaking resumed tasks.
