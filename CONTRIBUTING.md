# Contributing

Bug reports and narrowly scoped pull requests are welcome during the public alpha.

Before opening a pull request:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run build:phone
```

Please preserve these invariants:

- host services remain loopback-only;
- no token or credential crosses into the renderer or phone client;
- Codex ownership transfer targets only verified Codex processes;
- mobile transcript refresh does not move a reader who has scrolled upward;
- Hermes remains optional; and
- no user-specific names, paths, tailnet domains, or session data enters fixtures or documentation.

Security reports containing sensitive details should not be filed publicly. See [SECURITY.md](SECURITY.md).

To inspect the first-run wizard without changing a working Hearth Remote profile, build the portable app and double-click `scripts\Preview First Run.cmd`. It uses a disposable Electron user-data directory and removes it when the preview closes.
