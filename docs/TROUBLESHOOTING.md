# Troubleshooting

Start with `scripts\Hearth Remote Doctor.cmd`. It is read-only and does not reveal the capability token.

## Codex tools fail after a desktop update

Typical message: the local command runner reports a missing-host executable or the expected helper is absent from its installed path.

Codex desktop versions bundle a matching `codex.exe` and `codex-code-mode-host.exe`. Hearth Remote must run that complete pair. The listener supervisor rechecks the installed version and restarts the dedicated listener when the desktop app updates.

1. Let the Codex desktop update finish.
2. Open Codex desktop once, then close it.
3. Run Hearth Remote Doctor.
4. If **Complete Codex runtime** fails, repair or update Codex desktop.
5. If the runtime passes but the listener fails, rerun host setup.

Do not copy a helper executable from one version directory into another.

## “This is open in another app” or “active writer” persists

Finish or stop any running turn. In Hearth Remote choose **Return control** and wait for confirmation before opening the task in Codex desktop.

If ownership remains stale, run Doctor and rerun host setup. The normal return path unsubscribes loaded tasks and schedules a clean restart of only the dedicated listener. A full computer reboot should not be the routine fix.

## The Windows client cannot connect

- Confirm Tailscale says **Connected** on both computers.
- Confirm both devices are in the same tailnet.
- Run Doctor on the host.
- Rerun host setup to produce a fresh connection file, then import it from Settings.
- Do not replace `wss://` with `ws://` for a tailnet address.

## Tailscale asks to enable HTTPS

This is expected the first time Tailscale Serve uses HTTPS in a tailnet. Approve the certificate option in the browser page Tailscale opens, then run host setup again. Hearth Remote does not use Tailscale Funnel and should not be public.

## Phone page does not open

- Confirm Tailscale is connected on the phone.
- Run Doctor and check **Phone gateway**.
- Run `tailscale serve status` on the host and confirm HTTPS port 4520 forwards to `127.0.0.1:4520`.
- Create a fresh pairing code; codes are single-use and expire.

## Phone jumps to the bottom while reading

Current builds preserve an upward-scrolled reading position during background refreshes. Clear the PWA cache or remove and reinstall the home-screen app if an older service worker remains active.

## Useful bug-report evidence

Include the Hearth Remote, Codex desktop, Windows, and Tailscale versions; Doctor output; whether the failure affects Electron, phone, or both; exact steps; and exact error text.

Do not include tokens, connection files, private tailnet DNS names, usernames, or unredacted prompt/session logs.
