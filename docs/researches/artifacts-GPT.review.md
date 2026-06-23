## 结论

**不要选择“纯 global”或“纯 repo-local”。正确边界应当是：**

* **项目事实放在 repo**
* **可变运行态放在 OS 用户数据目录，并按 repo/worktree 隔离**
* **用户与设备状态放在 OS 用户域**
* **绝不把状态写进 npm global installation 目录**

因此，就当前争议最大的 `runtime.sqlite` 而言，我建议回到原设计方向：**global storage root + repo/worktree partition**，而不是固定放在 `.archcontext/.local/`。

## 当前不是“文档残留”，而是尚未解决的设计冲突

截至当前 GitHub `main`：

* PRD §18.5 明确要求 SQLite 不放在 repository 内，而是放在 macOS、Linux、Windows 各自的 OS user-data 路径，并按 repository 分目录。([GitHub][1])
* 实现中的 `defaultLocalStorePath()` 却默认返回 `<repo>/.archcontext/.local/runtime.sqlite`。([GitHub][2])
* ADR-0004 只决定了“SQLite 是可重建的派生状态、Git 是事实源”，**没有决定 SQLite 的文件系统位置**。([GitHub][3])
* ADR-0005 明确 repo-local 的只是 daemon connection file 和 lock file，并不能推出数据库、日志、快照等所有运行态都应 repo-local。([GitHub][4])
* `cloud/hardening` 中仍然保留了 OS user-data 下的 platform state path contract。([GitHub][5])

所以前一份结论中“accepted ADR 和稳定 spec 已经决定 repo-local”说得过重了。更准确地说：

> 代码实现选择了 repo-local，但架构决策并没有完整批准这个变化，PRD 和部分代码仍保留 global-per-repo 设计。

你本地找不到 global 生成物，只说明当前实现没有往那里写；它不能反过来证明 global 设计已经被废弃。并且所谓 global state 也不应出现在 `/opt/homebrew/lib/node_modules/archctx`，那个目录只应该存安装包代码。

## 推荐的最终边界

| 状态类型                                   | 推荐位置                                        |
| -------------------------------------- | ------------------------------------------- |
| 架构事实源                                  | repo 内、Git tracked 的 `.archcontext/`        |
| model、policies、decisions、可审查 generated | repo 内、Git tracked                          |
| SQLite、daemon 状态、日志、快照、缓存              | OS user-data，按 repo/worktree 隔离             |
| 用户偏好、license、设备身份                      | OS user-data；密钥进入 Keychain/credential store |
| CodeGraph 索引                           | 保持 `.codegraph/`，由 CodeGraph 自身管理           |
| npm global 目录                          | 只放 executable/package，不放可变状态                |

示例布局：

```text
repository/
  .archcontext/
    manifest.yaml
    product.yaml
    model/
    policies/
    decisions/
    generated/

~/Library/Application Support/ArchContext/
  repositories/
    <repository-id>/
      shared/
        cache/
      worktrees/
        <workspace-id>/
          runtime.sqlite
          daemon.json
          daemon.lock
          logs/
          snapshots/
  device/
  config/
```

这里的 **global 并不是一个所有项目共用的 `state.db`**。它只是统一的存储根目录，下面仍按 repository 和 worktree 做强隔离。

## 为什么运行态更适合放 global root

### 1. 更符合 multi-repo 产品模型

ADR-0026 已经把 multi-repo landscape 纳入产品模型：每个 repo 保持自己的 Git 事实源，但本地可以维护跨 repo 的派生边。([GitHub][6])

如果 SQLite 位于启动 daemon 时所在的某个 repo：

```text
repo-A/.archcontext/.local/runtime.sqlite
```

而数据库又记录 repo A、B、C 的 session、landscape 和 cross-repo edge，就会出现一个不自然的问题：

> 为什么 B、C 的派生状态由 A 的工作目录拥有？

它会形成“anchor repo”语义：从哪个目录启动 daemon，哪个 repo 就意外成为整个 landscape 的状态宿主。global root 下按 landscape/repository/workspace 分区更自然。

### 2. 更符合 daemon 生命周期

ADR-0005 让 daemon 负责 session、锁、CodeGraph lifecycle、SQLite 和写串行化；ADR-0034 又把 daemon、CLI、迁移和数据保留视为同一套本地产品生命周期。([GitHub][4])

这更像用户级本地服务，而不是“仓库里的一个临时脚本”。其数据库、日志、迁移备份和诊断文件放在统一的 OS 应用数据目录，生命周期更容易管理。

### 3. 避免 repo 文件系统成为运行条件

repo-local SQLite 隐含要求：

* checkout 可写；
* 文件系统适合 SQLite WAL；
* repo 不是只读 mount；
* 不在共享或网络文件系统上运行；
* 清理、复制 repo 时接受运行状态一起移动或丢失。

但 `.archcontext/` 的核心价值是可版本控制的 architecture truth。当前 spec 也明确把 Git 中的 `.archcontext/` 定义为架构事实源，把 SQLite 定义为本地派生状态。([GitHub][7])

把两者物理混在同一个目录树中，虽然 `.gitignore` 可以防止普通误提交，但会弱化这个边界。

### 4. worktree 语义更清楚

一个 Git repository 可以有多个 worktree。更合理的拆分是：

* repo-level：共享可重建索引、repository identity；
* worktree-level：当前分支对应的 session、任务、锁和运行数据库；
* landscape-level：跨 repo 的派生关系。

简单地在每个 worktree 放 `.archcontext/.local/runtime.sqlite` 虽然能隔离，但会复制大量数据，并且无法自然表达共享的 repository/landscape 状态。

## repo-local 的优势确实存在

repo-local 并非错误设计，它的优点包括：

* 从 `cwd` 就能定位状态；
* 删除 repo 等于删除全部本地状态；
* repo 移动时状态一起移动；
* 每个 worktree 天然隔离；
* 不需要维护 global registry。

如果 ArchContext 的产品约束是“一个 worktree 一个独立进程、没有 multi-repo daemon、没有设备级状态、没有跨 repo landscape”，我会倾向 repo-local。

但当前 ADR 已经包含单写 daemon、multi-repo 和统一本地产品生命周期，因此整体模型更偏向 global-partitioned。

## 对你目前本地改动的建议

**先不要把“全面对齐 repo-local”的五个改动作为最终设计提交。**

尤其不要仅为了匹配当前实现，就把 PRD §18.5 和 `PLATFORM_STATE_PATHS` 全部改成 repo-local。这样做相当于用实现反向覆盖尚未正式决策的架构边界。

更好的提交顺序是：

1. 新增一个明确的 ADR，例如 `ADR-0037 Runtime State Placement and Identity`。
2. 决定三种状态边界：project truth、workspace runtime、user/device state。
3. 引入统一的 state-path resolver。
4. 把 SQLite 默认路径迁到 OS user-data 下的 repo/worktree 分区。
5. 增加旧 `.archcontext/.local/runtime.sqlite` 的迁移或重建流程。
6. 最后同步 PRD、spec、runbook、hardening 和测试。

`.archcontext/.local/` 的 ignore 规则可以暂时保留，用于向后兼容和迁移；但不应再被描述为长期 canonical runtime location。当前 `.gitignore` 确实已经忽略 `.archcontext/.local/` 与 `.codegraph/`。([GitHub][8])

## 建议锁定的 contract

可以直接写进 ADR：

> Git-tracked `.archcontext/` is the repository architecture source of truth.
> Mutable ArchContext runtime state MUST be stored under the operating system’s per-user application-data directory and partitioned by stable repository and workspace identity.
> ArchContext MUST NOT write mutable state into its package installation directory.
> Repository-local runtime paths are supported only for migration, explicit overrides, or non-secret discovery pointers.

同时建议提供：

```bash
archctx paths
```

输出类似：

```text
Repository truth:
  /project/.archcontext

Repository ID:
  repo_01J...

Workspace ID:
  ws_01J...

Runtime database:
  ~/Library/Application Support/ArchContext/repositories/repo_01J.../worktrees/ws_01J.../runtime.sqlite

CodeGraph index:
  /project/.codegraph
```

以及一个统一 override：

```bash
ARCHCONTEXT_STATE_DIR=/some/path
```

供 CI、测试、便携环境使用。

**最终判断：项目产物继续 repo-level；SQLite、daemon、日志和快照改为 global-root、repo/worktree-scoped。** 这既保留原设计意图，也避免“一个全局数据库管理所有项目”的耦合。

[1]: https://raw.githubusercontent.com/Ancienttwo/arch-context/main/plans/prds/20260619-2039-archcontext.prd.md "raw.githubusercontent.com"
[2]: https://github.com/Ancienttwo/arch-context/blob/main/packages/local-runtime/local-store-sqlite/src/index.ts "arch-context/packages/local-runtime/local-store-sqlite/src/index.ts at main · Ancienttwo/arch-context · GitHub"
[3]: https://github.com/Ancienttwo/arch-context/blob/main/docs/adr/ADR-0004-sqlite-local-store.md "arch-context/docs/adr/ADR-0004-sqlite-local-store.md at main · Ancienttwo/arch-context · GitHub"
[4]: https://github.com/Ancienttwo/arch-context/blob/main/docs/adr/ADR-0005-single-writer-runtime-daemon.md "arch-context/docs/adr/ADR-0005-single-writer-runtime-daemon.md at main · Ancienttwo/arch-context · GitHub"
[5]: https://github.com/Ancienttwo/arch-context/blob/main/packages/cloud/hardening/src/index.ts "arch-context/packages/cloud/hardening/src/index.ts at main · Ancienttwo/arch-context · GitHub"
[6]: https://github.com/Ancienttwo/arch-context/blob/main/docs/adr/ADR-0026-multi-repo-architecture-context.md "arch-context/docs/adr/ADR-0026-multi-repo-architecture-context.md at main · Ancienttwo/arch-context · GitHub"
[7]: https://github.com/Ancienttwo/arch-context/blob/main/docs/spec.md "arch-context/docs/spec.md at main · Ancienttwo/arch-context · GitHub"
[8]: https://github.com/Ancienttwo/arch-context/blob/main/.gitignore "arch-context/.gitignore at main · Ancienttwo/arch-context · GitHub"
