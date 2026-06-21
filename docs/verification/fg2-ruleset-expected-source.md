# FG2 Ruleset Expected Source Decision

- Date: 2026-06-21 Asia/Singapore
- Environment: staging
- Repository: `Ancienttwo/arch-context`
- GitHub App: `archcontext-staging`
- App ID: `4102781`
- Installation ID: `141544438`
- Decision: `required-and-implemented`

## Decision

`Commit Statuses: Write` is required for the staging GitHub App. The permission is included only so GitHub rulesets can bind `ArchContext / Developer Review` to the App as the expected source. ArchContext runtime still publishes Review state through GitHub Checks; no commit status endpoint is part of the runtime allowlist.

## Evidence

GitHub App definition and installation were updated through GitHub UI. API readback then returned:

```json
{
  "repository_selection": "selected",
  "permissions": {
    "checks": "write",
    "metadata": "read",
    "statuses": "write",
    "pull_requests": "read"
  },
  "events": ["check_run", "pull_request"]
}
```

Repository selection remained limited to `Ancienttwo/arch-context`.

Ruleset smoke used a temporary active repository ruleset targeting only `refs/heads/fg2-ruleset-smoke/*`. It first created a required status check for `ArchContext / Developer Review`, then updated the same ruleset with `integration_id: 4102781`.

Readback returned:

```json
{
  "ruleset_id": 17927634,
  "required_status_checks": [
    {
      "context": "ArchContext / Developer Review",
      "integration_id": 4102781
    }
  ]
}
```

The temporary ruleset was deleted immediately after readback, and `gh api repos/Ancienttwo/arch-context/rulesets` returned `[]`.

## Source

GitHub's ruleset documentation says expected-source App selection requires the App to be installed with `statuses:write`, to have recently submitted a check run, and to be associated with a pre-existing required status check in the ruleset:

- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging
- https://docs.github.com/en/rest/repos/rules

## Runtime Boundary

The live Worker and `GitHubGovernanceRestPort` allowlist still permits only:

- `GET /repositories/{repository_id}/pulls/{pull_number}`
- `POST /repositories/{repository_id}/check-runs`
- `PATCH /repositories/{repository_id}/check-runs/{check_run_id}`

No `POST /repos/{owner}/{repo}/statuses/{sha}` or equivalent commit status write path is added.
