# FG6 Release Security Scan

- Generated At: 2026-06-21T19:25:34.536Z
- Environment: staging-release-readback
- Scanner: fg6-release-security-bundle
- Critical: 0
- High: 0

| Surface | Tool | Result | Notes |
|---|---|---|---|
| Dependency vulnerability | bun audit --json | critical 0; high 0; advisories 0 | exit 0 |
| SBOM | bun pm ls --all | components 37 | docs/security/scans/fg6-release-sbom.cdx.json; sha256:6448e03c9887b1f6b80fa18d21a85010cc885afc2a00a2f9ed291c27e8a8e062 |
| SAST | repo pattern scan | critical 0; high 0; findings 0 | scanned 108 files |
| Secret scan | repo pattern scan | critical 0; high 0; findings 0 | scanned 375 files; excludes _ops |

## Scope

The scan covers dependency advisories from the Bun audit database, a CycloneDX-style SBOM from the installed Bun dependency graph, high/critical SAST patterns in source roots, and real secret token/key material patterns in release-relevant repository text roots. Test fixtures and the _ops, .git, .wrangler, node_modules, and generated artifacts directories are excluded from secret scanning.
