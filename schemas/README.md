# Codex protocol references

Codex app-server is versioned with the installed Codex CLI. Refresh the local reference files after a Codex update:

```powershell
.\scripts\refresh-codex-schema.ps1
```

Generated files are intentionally ignored by Git. The small runtime types in `src/main/providers/codex-types.ts` cover the fields Hearth Remote consumes, while the normalizer ignores unknown future item types rather than crashing the client.
