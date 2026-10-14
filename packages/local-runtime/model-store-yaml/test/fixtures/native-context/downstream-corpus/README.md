# Frozen native parser consumer corpus

Public source: Ancienttwo/repo-harness@902c4ed7866f2b7359b1553a8cd64934496ea3c7. The 454 manifest/node/relation/flow inputs retain exact UTF-8 source strings, content digests and values from the consumer's actual Bun.YAML.parse path. The unmodified shared parser at 5e144af06c56a9d564d8a06356b732ded7f7fb22 and the ambiguity-only revision both matched all frozen values when this artifact was created. Tests verify source hashes, baseline value digests and every consumer value. Unsupported syntax/value mismatches are coverage blockers, never a fallback.
