# Beta Launch Preflight Checklist

- [x] Source exfiltration route audit passes.
- [x] ChangeSet path traversal tests pass.
- [x] Review result binds HEAD and worktree digest.
- [x] CodeGraph version is pinned.
- [x] ChatGPT data sharing disclosure exists.
- [x] Critical/High security findings are zero in local deterministic hardening report.
- [ ] Production security scan or external review has zero Critical/High findings.
- [x] Proxy eval tests cover compatibility debt, target vs migration, and proof required.
- [ ] Representative eval report reaches the PRD recall targets.
- [x] Crash recovery runbook exists.
- [x] Install-to-first-task walkthrough exists.
- [ ] Timed install-to-first-task rehearsal completes within 10 minutes.
- [x] Independent Threat Review is complete for the deterministic MVP surface.
- [x] Cross-platform support matrix and installation walkthrough are documented.
- [x] macOS/Linux/Windows and Node 24/25 CI matrix is configured.
- [ ] macOS/Linux/Windows and Node LTS CI matrix passes.
- [ ] Large-repo benchmark passes on measured data.
