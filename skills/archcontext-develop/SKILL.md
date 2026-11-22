# ArchContext Develop Skill

Use this skill for ordinary feature work in an ArchContext-enabled repository.

## SOP

1. Run `archctx prepare --task "<task>" --json` (or `archctx context --path <path> --json`) before editing code.
2. Code against the returned posture, constraints, and resources.
3. After meaningful changes, run `archctx check --changed <paths...> --json` or `archctx checkpoint --changed-path <path> --json`. These read debt without writing a practice baseline.
   When the workflow explicitly needs to advance practice guidance, run `archctx practices checkpoint --task-session-id <id> --changed <path> --json`.
4. If the work needs architecture model updates, run `archctx plan`; do not write model files directly.
5. Before final response, run `archctx complete --head-sha <sha> --json`.

## Checkpoint Debt And Practice Updates

- Read `items` and `actionsRequired` from the debt checkpoint. Empty items with partial/unknown
  coverage do not prove the absence of deferred dependency, flow or practice debt.
- `archctx prepare` seeds the local practice baseline. Debt `archctx checkpoint` and
  `archctx check --changed` do not change it. Only an explicit `archctx practices checkpoint` advances that baseline.
- For the explicit practice writer, treat `added/upgraded` as new practice issues and
  `removed/downgraded` as resolved practice issues. `requiresProof` remains a proof task.
- A `state-machine-stale` item means that an anchored declaration changed. Read the change, update
  the machine if its behaviour changed, then write the reported digest through a ChangeSet (`archctx plan` / `archctx apply`).
- A stale practice writer result requires a fresh `archctx prepare`; do not pass its session, digest or
  budget inputs to the debt reader, which rejects them.

## Rule

The skill is orchestration only. Runtime packages own pressure, policy, review, practice matching, and ChangeSet behavior. Do not copy practice prose, matching rules, or checker logic into this skill.
