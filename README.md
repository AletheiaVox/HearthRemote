# Hearth Remote

A calm, private Windows and phone client for Codex tasks that live on another Windows computer—even when the Codex desktop app is closed.

> **Public alpha:** Hearth Remote works in daily use, but it integrates with Codex app-server interfaces that may change when Codex updates. The listener includes update recovery and the repository includes a read-only Doctor, but expect occasional compatibility fixes until those interfaces stabilize.

> **Windows warning:** Alpha installers are not code-signed yet, so Windows SmartScreen may show an unknown-publisher warning. Verify the release checksum before running a downloaded build.

## What it does

Hearth Remote lets one Windows computer remain the canonical home for Codex, its task history, and project files. A second Windows computer or phone can open those same tasks without copying `.codex` state between machines.

- Browse, search, resume, and create Codex tasks.
- Read streamed replies, reasoning, plans, and tool activity.
- Answer questions and approve tool use remotely.
- Start a task in a chosen project folder.
- Attach files and images to prompts.
- Transfer task ownership safely between the host Codex app and Hearth Remote.
- Keep remote access available through a hidden supervised listener; the Codex desktop app does not need to be running.
- Use an installable phone PWA with one-time pairing and revocable device sessions.
- Optionally expose Hermes profiles, conversations, and model selection through the same interface.

Hermes support is an optional adapter for an already configured compatible Hermes bridge on host loopback port 4510. Hearth Remote does not install or configure Hermes itself.

## Leave home without remembering to open Codex

The host computer must be awake and signed into Windows, but the Codex desktop app does **not** need to be open. Hearth Remote starts a dedicated headless Codex service at Windows logon, keeps it healthy after crashes and app updates, and exposes it only through the private tailnet.

In fact, the desktop app should normally be closed during a remote Codex session because Codex permits only one active writer. This makes Hearth Remote useful after you have already left home: remote availability does not depend on remembering to leave a foreground Codex window running.

```text
Windows client ─┐                         ┌─ Codex app-server (loopback only)
                ├─ encrypted tailnet ─── host Windows PC
Phone PWA ──────┘                         ├─ Hearth phone gateway (loopback only)
                                          └─ projects and canonical Codex state
```

## Why Tailscale?

[Tailscale](https://tailscale.com/) creates a private network between your own devices, called a **tailnet**. Hearth Remote uses it so the host services do not need a public IP address, router port-forwarding, or exposure to the public internet. Tailscale Serve adds HTTPS inside that private network.

The first-run wizard explains this in plain language and detects whether Tailscale is missing, signed out, or connected. Official guides:

- [Install Tailscale on Windows](https://tailscale.com/docs/install/windows)
- [Tailscale quickstart](https://tailscale.com/docs/how-to/quickstart)
- [How Tailscale Serve works](https://tailscale.com/docs/features/tailscale-serve)

## Requirements

The host needs Windows 11, Codex desktop launched at least once, Node.js 22 or newer, Tailscale, and this repository in a stable folder. A Windows client needs Windows 11, Tailscale on the same tailnet, and a Hearth Remote build. A phone needs Tailscale and a current PWA-capable browser.

## Set up the host

Open PowerShell in the repository and install dependencies:

```powershell
npm ci
```

Then double-click **`scripts\Setup Hearth Remote Host.cmd`**. The default project folder is Documents. For a different folder or optional Hermes support, use PowerShell:

```powershell
.\scripts\setup-hearth-host.ps1 -DefaultCwd "C:\Users\me\Documents\Codex"
```

```powershell
.\scripts\setup-hearth-host.ps1 -DefaultCwd "C:\Users\me\Documents\Codex" -EnableHermes
```

Setup creates `Hearth-Remote-Connection.json` on the host desktop. If Tailscale opens a browser asking you to enable HTTPS certificates, approve it and run setup once more.

Existing pre-alpha installations are adopted in place: setup preserves the capability token and paired phones, exports the old scheduled tasks for rollback, and disables the superseded listener only after the new runtime folder is ready. Use `-Plan` to inspect the migration without changing anything.

The connection file contains a private capability token. Move it to the client, import it, and then delete it from both computers. Hearth Remote encrypts the imported token with Windows protection.

## Set up the Windows client

Download a Windows build from Releases, or build it from source:

```powershell
npm run dist:win
```

The first-run wizard explains and checks Tailscale, imports the connection file, encrypts its token, and connects to the host.

Codex allows one active writer for a task. Use **Switch to this device** before sending, and **Return control** before reopening that task in the host desktop app. Hermes does not use the same ownership handoff.

## Set up a phone

After host setup:

1. Connect the phone to the same tailnet.
2. Double-click **`scripts\New Hearth Phone Pairing Code.cmd`** on the host.
3. Open the displayed HTTPS address on the phone.
4. Enter the six-digit, single-use code.
5. Add Hearth Remote to the home screen if desired.

The phone receives its own revocable session. It never receives the more powerful Codex capability token.

## Diagnose a problem

Double-click **`scripts\Hearth Remote Doctor.cmd`**, or run:

```powershell
.\scripts\hearth-remote-doctor.ps1
```

Doctor is read-only. It checks Tailscale, the complete version-matched Codex runtime, the token without revealing it, the listener, and the phone gateway. See [Troubleshooting](docs/TROUBLESHOOTING.md) for common failures and bug-report guidance.

## Development

```powershell
npm ci
npm run typecheck
npm test
npm run dev
```

Phone/PWA development:

```powershell
npm run dev:pwa
npm run build:phone
```

## Security model

- Host services listen only on `127.0.0.1`.
- Tailscale Serve provides tailnet-only HTTPS/WSS access.
- The capability token lives in an ACL-restricted host folder.
- The Windows client stores it with Electron `safeStorage` (Windows DPAPI).
- Phones use expiring pairing codes and separate revocable device sessions.
- Attachments are size-limited and written inside the selected host project.
- The renderer is sandboxed and receives only a narrow preload API.

Read [SECURITY.md](SECURITY.md) before deploying or reporting a vulnerability.

## Compatibility boundary

Hearth Remote uses the official Codex app-server protocol intended for rich clients. OpenAI currently describes remote app-server WebSocket transport as experimental and not supported for production use. The listener therefore discovers the newest **complete** installed Codex runtime and its version-matched Code Mode host after updates instead of pinning an internal executable path. See the [official Codex app-server documentation](https://developers.openai.com/codex/app-server).

Hearth Remote is not affiliated with or endorsed by OpenAI, Tailscale, or Hermes Agent.

## License

[MIT](LICENSE)
