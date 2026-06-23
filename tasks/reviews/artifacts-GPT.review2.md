# Verdict: FAIL

PR #12 的 **HEAD、平台矩阵和 runtime state 默认位置已经基本验收通过**；但 legacy SQLite 迁移存在可留下“半迁移目标”、且后续自动永久跳过的缺陷，属于升级路径 blocker。

## Findings

### BLOCKER — Legacy SQLite 迁移不是原子操作，失败后可能永久跳过恢复

**文件：**

* `packages/local-runtime/local-store-sqlite/src/index.ts`
* `packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts`

迁移逻辑先检查目标 `runtime.sqlite` 是否存在；只要存在就返回 `target-exists`。真正迁移时，又直接把主库、`-wal`、`-shm` 依次复制到最终目录，没有临时 staging、完成标记、原子 publish 或完整性检查。([GitHub][1])

因此可以出现：

1. 主库刚被创建或只复制了一部分；
2. 进程崩溃、磁盘写入失败或被终止；
3. WAL/SHM 尚未完成复制；
4. 下次运行只看到目标主库“存在”，于是按 `target-exists` 永久跳过自动迁移。

源文件不会被删除，因此不等同于不可逆数据删除；但新路径会被认作 canonical target，旧的完整状态不再自动恢复，除非用户手工删除或修复目标目录。

现有测试只用普通字符串模拟 `runtime.sqlite` 和 WAL，然后比较复制结果；没有使用真实 SQLite WAL 数据库，也没有覆盖复制中断、partial target、重试恢复、并发旧 daemon 或 SQLite integrity check。([GitHub][2])

**通过条件：**

* 先复制或备份到临时 partition；
* 使用 SQLite backup/checkpoint，或明确取得 legacy store 的独占锁；
* 成功打开数据库并完成 integrity/migration 验证；
* 最后通过原子 rename 或 completion marker 发布；
* 发现 incomplete target 时能够自动重试或 quarantine，而不能仅凭主文件存在就跳过。

---

### MEDIUM — Repository/worktree identity 实际是 path-derived，rename/move 后无法找到旧 state

**文件：**

* `packages/local-runtime/local-store-sqlite/src/index.ts`
* `packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts`
* `docs/adr/ADR-0037-runtime-state-placement.md`

`repositoryId` 和 `workspaceId` 是 canonical Git common-dir/worktree 路径的 SHA-256 截断值。因此移动或重命名 repository/worktree 后，ID 会变化，原 global partition 仍保留在磁盘上，但新位置不会再发现它。([GitHub][1])

这不一定违反当前 ADR，因为 ADR 已公开选择 path-derived identity；而且 SQLite 被定义为可重建派生状态。但 daemon/session、review-run manifest 等状态也位于该 partition 中，rename 后的用户体验和清理策略尚未被锁定。

相关新增测试主要使用普通临时目录。未看到以下真实 Git fixture 的明确覆盖：

* `git worktree add` 后 repository ID 相同、workspace ID 不同；
* repository/worktree rename 或整体移动；
* monorepo 不同子目录解析到同一 workspace；
* 两个 sibling repositories 不发生 partition 冲突；
* symlink/case-insensitive path 的 canonicalization。

这项不是本次唯一 blocker，但建议至少补真实 linked-worktree、monorepo 和 sibling-repo 测试，并明确 rename 后采用 rebuild、alias registry 还是 migration。

---

### MEDIUM — Windows readiness 修复主要是扩大 timeout，并未证明根因已经消除

**文件：**

* `packages/surfaces/cli/src/main.ts`
* `packages/surfaces/cli/test/cli.test.ts`

第二个 commit 把 daemon readiness timeout 从 5 秒增加到 15 秒，并在超时时附加 daemon log tail；测试进程 timeout 则从 15 秒增加到 30 秒。核心启动或 readiness 机制没有其他修复。([GitHub][3])

当前 Windows Node.js 24/25 CI 已经成功，所以没有证据表明现版本仍会失败；增加诊断信息也有实际价值。但该改动只能证明 Windows runner 在 15 秒窗口内可以完成启动，不能证明原先超过 5 秒的根因已经定位。它仍可能受到 runner 负载、杀毒扫描或包启动开销影响。

本项为非阻塞 residual risk。

---

### LOW — `paths`/`doctor` 的 legacy 状态可观测性没有被验收测试锁定

**文件：**

* `packages/surfaces/cli/src/main.ts`
* `packages/surfaces/cli/test/cli.test.ts`

现有测试明确验证了：

* global `localStorePath`；
* runtime repository ID；
* storage repository/workspace ID；
* runtime path 不位于 repository；
* npm global installation state 被禁止。([GitHub][4])

但相关断言没有验证：

* legacy `.archcontext/.local/runtime.sqlite` 是否存在；
* 是否已迁移；
* 是否因 target 已存在而跳过；
* partial/incomplete legacy migration 状态。

`doctor` 会包含 paths report，但当前 GitHub 测试证据不足以证明用户一定能够从 `archctx paths` 或 `doctor` 判断 legacy migration 状态。建议增加结构化字段和测试，例如：

```text
legacyLocalStore:
  path: ...
  exists: true
  migrationStatus: pending | migrated | target-exists | incomplete
```

## Verification

### PR 与 commits

GitHub 当前 PR 是：

* PR #12，`codex/runtime-state-global-partition` → `main`
* 当前最新 HEAD：`5b826174cb5a76b1f8c3e73595fcf5a240349d8f`
* commits：

  * `ff6c942 feat: partition runtime state under user data`
  * `5b82617 fix: relax daemon readiness timeout`

当前 HEAD 与验收 prompt 中的 expected HEAD 一致。([GitHub][5])

### GitHub Actions Verify

检查的是 PR 当前 HEAD 对应的 **Verify #76，run `28005380583`**。该 run 状态为 SUCCESS。([GitHub][6])

以下 jobs 全部成功：

* Governance Verify
* Ubuntu / Node.js 24
* Ubuntu / Node.js 25
* macOS / Node.js 24
* macOS / Node.js 25
* Windows / Node.js 24
* Windows / Node.js 25

特别是之前失败的 Windows Node.js 24/25，本次均为 SUCCESS。([GitHub][6])

### Runtime state placement

实现已经把默认 mutable runtime state 放入 OS user-data root，并按 repository/worktree 分区：

```text
<OS user-data>/ArchContext/
  repositories/<repository-id>/
    worktrees/<workspace-id>/
      runtime.sqlite
      daemon.json
      daemon.lock
      logs/
      developer-review-runs/
```

平台默认 root 分别使用 macOS Application Support、Windows Local AppData、Linux XDG data home；SQLite、daemon connection/lock/log 和 review-run state 均从相同 partition resolver 得出。([GitHub][1])

Runtime daemon 使用新的默认 local-store path，CLI/daemon 集成测试也验证了 global control/lock 路径的创建和清理。([GitHub][7])

`.archcontext/.local` 在实现中作为 legacy control/store 位置保留，不再是默认 canonical runtime location。

### Repo-local `.archcontext` 边界

**适合提交：**

```text
.archcontext/manifest.yaml
.archcontext/product.yaml
.archcontext/model/**
.archcontext/policies/**
.archcontext/decisions/**
.archcontext/generated/**   # 仅限配置为 commit-to-git 的可审查 projection
```

这些属于 repository-owned architecture truth 或可审查生成物。ADR 明确区分了 Git-tracked repository truth 与 mutable runtime state。([GitHub][8])

**必须 ignore：**

```text
.archcontext/.local/**
.codegraph/**
```

当前 `.gitignore` 已覆盖：

```gitignore
.codegraph/
.archcontext/.local/
```

([GitHub][9])

默认情况下，以下内容不应再生成到 repo 中：

```text
runtime.sqlite
runtime.sqlite-wal
runtime.sqlite-shm
daemon connection/control file
daemon lock
daemon logs
private review-run state
```

PR changed files 中未发现上述 private/runtime 文件被纳入 Git tracked。

### 设计文档一致性

当前 ADR 已明确规定：

* Git 中的 `.archcontext` 是 repository architecture truth；
* mutable runtime state 位于 OS per-user application-data；
* 按 repository/worktree identity 分区；
* package installation directory 不得承载可变 state；
* repo-local `.archcontext/.local` 仅用于迁移、显式 override 或兼容发现，不是默认 runtime location。([GitHub][8])

ADR-0004 继续把 SQLite 定义为可重建派生状态，而不是 Git truth；ADR-0005 的 daemon connection/lock 描述也已指向 OS user-data runtime state。([GitHub][10])

Quickstart/CLI 文档展示的 `paths` 输出同样使用 global partition，并保留 repo-local `.archcontext` 给 init 后的产品、模型和策略文件。([GitHub][11])

在本次检查的当前 authoritative docs 中，没有发现仍把 `.archcontext/.local/runtime.sqlite` 描述为默认 canonical runtime path 的冲突。

## Scope Judgment

本次验收范围是：

* PR #12；
* personal/local runtime state placement；
* legacy repo-local state migration；
* Windows Verify regression；
* repo-owned `.archcontext` 与 private runtime state 的边界。

**没有因为 collaboration rollout、managed runners、cloud deployment 或 production GA 尚未完成而判定失败。**

本次 `FAIL` 仅由 PR #12 自身的 legacy migration correctness blocker 导致。global partition 方向、文档边界和当前平台 CI 本身均已基本通过。

## Residual Risk

* CI 中不少路径测试通过 `ARCHCONTEXT_STATE_DIR` override，不能完全替代三个操作系统真实安装环境下的默认目录和权限验证。
* Windows 当前成功依赖更宽的 readiness window；慢 runner、杀毒软件或 cold-start 下仍可能出现尾部延迟。
* 路径派生 ID 在 rename、repo move、worktree move、大小写变化或 symlink canonicalization 后可能产生新 partition。
* 旧 daemon 仍在写入 WAL 时进行迁移的行为没有被真实 SQLite 并发测试证明安全。
* 尚未看到 orphaned global partitions 的发现、清理或容量管理策略。

[1]: https://github.com/Ancienttwo/arch-context/blob/5b826174cb5a76b1f8c3e73595fcf5a240349d8f/packages/local-runtime/local-store-sqlite/src/index.ts?plain=1 "arch-context/packages/local-runtime/local-store-sqlite/src/index.ts at 5b826174cb5a76b1f8c3e73595fcf5a240349d8f · Ancienttwo/arch-context · GitHub"
[2]: https://github.com/Ancienttwo/arch-context/blob/5b826174cb5a76b1f8c3e73595fcf5a240349d8f/packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts?plain=1 "arch-context/packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts at 5b826174cb5a76b1f8c3e73595fcf5a240349d8f · Ancienttwo/arch-context · GitHub"
[3]: https://github.com/Ancienttwo/arch-context/commit/5b826174cb5a76b1f8c3e73595fcf5a240349d8f "fix: relax daemon readiness timeout · Ancienttwo/arch-context@5b82617 · GitHub"
[4]: https://github.com/Ancienttwo/arch-context/blob/5b826174cb5a76b1f8c3e73595fcf5a240349d8f/packages/surfaces/cli/test/cli.test.ts?plain=1 "arch-context/packages/surfaces/cli/test/cli.test.ts at 5b826174cb5a76b1f8c3e73595fcf5a240349d8f · Ancienttwo/arch-context · GitHub"
[5]: https://github.com/Ancienttwo/arch-context/pull/12 "Partition runtime state under user data by Ancienttwo · Pull Request #12 · Ancienttwo/arch-context · GitHub"
[6]: https://github.com/Ancienttwo/arch-context/actions/runs/28005380583 "Partition runtime state under user data · Ancienttwo/arch-context@5b82617 · GitHub"
[7]: https://github.com/Ancienttwo/arch-context/blob/5b826174cb5a76b1f8c3e73595fcf5a240349d8f/packages/local-runtime/runtime-daemon/src/index.ts?plain=1 "arch-context/packages/local-runtime/runtime-daemon/src/index.ts at 5b826174cb5a76b1f8c3e73595fcf5a240349d8f · Ancienttwo/arch-context · GitHub"
[8]: https://github.com/Ancienttwo/arch-context/commit/ff6c942 "feat: partition runtime state under user data · Ancienttwo/arch-context@ff6c942 · GitHub"
[9]: https://github.com/Ancienttwo/arch-context/blob/5b826174cb5a76b1f8c3e73595fcf5a240349d8f/.gitignore?plain=1 "arch-context/.gitignore at 5b826174cb5a76b1f8c3e73595fcf5a240349d8f · Ancienttwo/arch-context · GitHub"
[10]: https://github.com/Ancienttwo/arch-context/blob/5b826174cb5a76b1f8c3e73595fcf5a240349d8f/docs/adr/ADR-0004-sqlite-local-store.md?plain=1 "arch-context/docs/adr/ADR-0004-sqlite-local-store.md at 5b826174cb5a76b1f8c3e73595fcf5a240349d8f · Ancienttwo/arch-context · GitHub"
[11]: https://github.com/Ancienttwo/arch-context/blob/5b826174cb5a76b1f8c3e73595fcf5a240349d8f/docs/runbooks/local-core-quickstart.md "arch-context/docs/runbooks/local-core-quickstart.md at 5b826174cb5a76b1f8c3e73595fcf5a240349d8f · Ancienttwo/arch-context · GitHub"
