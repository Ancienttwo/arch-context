# Multi-repo Landscape Example

`landscape` is Git-tracked architecture metadata. It is not a sync service.

```yaml
schemaVersion: "archcontext.landscape/v1"
id: "landscape.archcontext-product"
name: "ArchContext Product"
repositories:
  - repositoryId: "repo.web"
    numericRepositoryId: 1001
    name: "archcontext-web"
    role: "frontend"
  - repositoryId: "repo.api"
    numericRepositoryId: 1002
    name: "archcontext-api"
    role: "runtime"
relations:
  - "relation.web-calls-api"
scope:
  defaultActiveRepositories:
    - "repo.web"
  maxActiveRepositories: 3
syncPolicy:
  mode: "git-worktree-only"
  archcontextSyncService: "forbidden"
```

Cross-repo context activates only repositories relevant to the task and records repo-scoped IDs such as `repo.web::module.checkout-ui`.
