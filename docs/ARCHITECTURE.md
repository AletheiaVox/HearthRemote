# Architecture

## Components

```text
Windows client (Electron)                    Windows host
┌────────────────────────┐                  ┌─────────────────────────────┐
│ sandboxed React UI     │                  │ Codex app-server :4500     │
│ narrow preload bridge  │── Tailscale ───▶ │ phone gateway :4520        │
│ DPAPI-protected token  │                  │ optional Hermes :4510      │
└────────────────────────┘                  │ canonical tasks + projects │
                                            └─────────────────────────────┘

Phone browser / installed PWA
┌────────────────────────┐
│ paired device cookie   │── Tailscale HTTPS ────────────────▲
│ no capability token    │
└────────────────────────┘
```

All host backends bind to loopback. Tailscale Serve terminates tailnet TLS and forwards only to `127.0.0.1`.

## Provider boundary

`ProviderService` owns an `AssistantAdapter`. Codex and Hermes implement the same snapshot/action contract, while provider descriptors declare capabilities. Hermes is optional and unavailable unless enabled during host setup. This keeps future local harnesses from leaking transport details into the renderer.

## Codex task ownership

Codex rejects a second active writer. Hearth Remote inspects host ownership, requests a normal desktop close, offers a separately confirmed targeted force-close if necessary, resumes only the selected task, unsubscribes loaded tasks when returning control, and recycles only the dedicated listener when needed to clear stale writer state.

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
```

The desktop client stores non-secret settings and a DPAPI-encrypted token in Electron's user-data directory. No `.codex` session database or project file is synchronized to clients.

## Trust boundaries

- The connection importer accepts a narrow JSON shape and requires WSS for remote Codex.
- The main process allowlists external setup links.
- The renderer has no Node integration and runs sandboxed.
- Browser RPC methods are enumerated; browsers cannot change host connection settings.
- Attachments have count, individual-size, and total-size limits before host writes.
