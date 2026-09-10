# projection-journal-read decisions

The fix removes journal-read session initialization instead of broadening digest ignores, which preserves generic source identity semantics and all write guards. Durable evidence and consumer boundary are recorded in docs/researches/20260910-projection-journal-read.md. No public release is authorized.
