# Security policy

## Supported versions

Security fixes are provided for the newest public alpha only. This project has not received an independent security audit and should not be exposed to the public internet.

## Intended deployment

- One trusted Windows host and personally controlled client devices.
- Host services bound to `127.0.0.1` only.
- Tailscale Serve used for tailnet-only TLS termination.
- No router port forwarding, public Funnel, public reverse proxy, or untrusted shared tailnet.

## Credentials

The host capability token is generated with 384 bits of cryptographic randomness and stored under `%USERPROFILE%\.hearth-remote\host` with inheritance removed and access restricted to the current Windows identity and SYSTEM.

The generated `Hearth-Remote-Connection.json` contains that token in plaintext so it can bootstrap a client. Treat it as a password: transfer it privately, import it once, and delete it. It is ignored by `.gitignore`.

On a Windows client the token is encrypted with Electron `safeStorage` (Windows DPAPI). It is never returned to the renderer. Browser clients never receive it: they pair with an expiring six-digit code and receive a random 256-bit device session whose SHA-256 hash is stored on the host.

## Process safety

The ownership handoff identifies the packaged Codex desktop tree and dedicated loopback listener by executable and command-line markers. The normal path requests a graceful window close. Force-close is a separate user confirmation and does not target unrelated processes.

The update supervisor selects only a `codex.exe` with a `codex-code-mode-host.exe` in the same versioned directory. It replaces only a verified dedicated listener on port 4500.

## Web protections

The phone gateway validates Origin, uses SameSite and Secure cookies, rate-limits pairing, sets a restrictive Content Security Policy, and caps JSON and WebSocket payload sizes. Static file resolution is constrained to the built web root.

## Reporting a vulnerability

Do not open a public issue containing tokens, connection files, tailnet DNS names, usernames, private paths, or logs with prompt content. Open a minimal report without secrets, or contact the maintainer privately after a security contact is listed.

Before sharing diagnostics, inspect them yourself. Doctor intentionally hides token values, but other Codex or Hermes logs may contain private content.
