# dsh-rollback-plugin

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`)的对话回滚与归档任务管理插件,以**可安装的插件 bundle** 形式交付——独立工作区,不打补丁、不修改 dsh 本体,只使用 npm 上发布的 dsh 公开 API(`@deepseek-ai/dsh-*@0.1.0-rc.6`)。

## 功能

### 对话回滚

三个触发入口:会话头部的"回滚"按钮、`/undo` 斜杠命令、以及下文撤回条所述的回滚操作。一次回滚会:

- 从插件私有的 Shadow Git 快照恢复文件树(独立 `GIT_DIR`,绝不写用户 `.git`);
- 把对话 fork 成新 Session,其 seed 是目标消息**之前**的完整事件前缀——模型永远看不到被回滚的提示词、回复与工具调用;
- 归档旧 Session(从侧边栏消失),并自动把 UI 导航到 child 会话;
- 快照在 `agent/pre-step` 捕获;捕获失败会拒绝该步骤(模型不收 prompt),并把原提示词与已脱敏技术详情回填 composer。

### 撤回回滚

回滚后,输入框上方折叠条显示 `↩ 已回滚 <提示词预览> [撤回回滚]`。仅当回滚对存在时出现,新 prompt 被接纳后自动消失。撤回是完整的反向事务:

- 先校验工作区树仍等于回滚前的树——工作区已分叉则拒绝(`workspace-diverged`),不覆盖用户改动;
- 把归档的源会话 fork 回可见会话、恢复文件、重新武装回滚点,回滚与撤回对称且可重复;
- `restoring` / `revoking` 相位 journal 在启动时按磁盘证据确定性恢复。

### 归档任务(设置 → 归档任务)

- 列出全部归档 Session(标题、时间、工作区)。
- 只读查看对话内容。
- **恢复**:把归档对话 fork 回新会话(可重复恢复;归档条目保留)。
- **删除**:永久删除该会话的磁盘日志目录;busy 的 agent 先 cancel 并等 idle。
- **全部删除**:一次批量 RPC,二次确认;部分失败提示"已删除 X 个,Y 个失败"。

### 性能

在约 7,400 文件的工作区实测(优化前 → 优化后):

- 路径限定 restore:单次 `git diff-tree --name-status` 驱动(全量 `checkout-index --all` ≈ 9.7s → 仅检出变更路径)。
- 影子仓库启用 `core.untrackedCache` + `core.splitIndex`(热 `git add --all` 5.8s → 0.3s)。
- 后台 stat 预热 + 下一代 prearm:回滚产生的新分支第一条消息不再付出约 31s 的冷快照成本。
- fork ∥ restore 并行;每次 arm 的按工作区断言缓存。
- 综合效果:回滚与撤回各约一秒完成(此前感知 30–40s)。

### 可靠性

- Windows 友好的原子写入:`EPERM` / `EBUSY` / `EACCES` 的 rename 指数退避重试,失败临时文件自动清理。
- bundle patch 禁用基础 bundle 的 `session-archive` / `ui-settings-archive` 行,由本插件完全接管 `sessionArchive` 命名空间。

## 包结构

| 包 | 职责 |
|---|---|
| `packages/rollback-fork` | Session fork 能力:completed-turn / before-user-message 精确切分 |
| `packages/rollback-archive` | 归档能力:列表、只读查看、恢复、永久删除、全部删除 |
| `packages/rollback-undo` | Shadow Git journal + 回滚/撤回编排 + `/undo` 命令 |
| `packages/client-rollback-button` | 浏览器:会话头部回滚按钮与撤回折叠条(自 mount Remote) |
| `packages/client-rollback-settings` | 浏览器:归档任务设置页(自 mount Remote) |
| `packages/bundle-rollback` | 可安装 bundle:`cordis.patch.yml` + 依赖清单 |
| `packages/typert-protocol` | vendor 的 `@deepseek-ai/dsh-typert-protocol` 源码(typert 生成需要,见下) |

## 安装

```sh
# 在带 dsh web 表面的 profile 里
dsh plugin --profile web add /path/to/dsh-rollback-plugin/packages/bundle-rollback
```

前置条件:dsh `0.1.0-rc.6`(peer 范围);浏览器侧需要 `dsh-web-app` 表面(槽位 `conversation.session.header.actions`、`conversation.input.dock`、`settings.section`,以及 `ctx.remote.$mount`)。headless profile 可从 `packages/bundle-rollback/cordis.patch.yml` 删去两行 `client-rollback-*`。

Windows 注意:从含空格的路径以 `link:` 安装会被 pnpm 拆分——请经由无空格的 junction 安装。

## 更新已安装的插件

在任意会话运行 `/update` 命令(要求本插件以 git clone 方式安装):自动执行 `git pull --ff-only` → `pnpm install` → `pnpm run build`(分步超时保护);HEAD 没有移动时报告"已是最新"并跳过安装构建。完成后重启 dsh——link 安装的 profile 自动使用重建后的 `lib/`。

手动等价操作:

```sh
git pull
pnpm install        # 仅依赖变化时需要
pnpm run build
# 重启 dsh
```

没有后台自动更新;更新永远由用户显式发起。

## 开发

```sh
pnpm install
pnpm run typecheck   # 先构建 host 产物(typert 生成),再检查 client 面
pnpm test            # vitest,8 个文件 / 35 个用例
pnpm run build       # host lib + client bundle(lib/client.js)
```

### 为什么 vendor typert-protocol 并打生成器补丁

typert 生成器只在声明包是 workspace 注册包时识别 `Remote` / `TypertRemoteService`,并把导出目标映射回 `src/`。对 npm 解析的 dsh 包需要两件事:

1. `packages/typert-protocol` vendor 协议源码;`pnpm-workspace.yaml` 用 overrides 让所有 dsh 包解析到它(`workspace:^`);`tsconfig.base.json` 把 `@deepseek-ai/dsh-typert-protocol` 映射到 `src/`。
2. `patches/typert-generator-workspace-only.patch`(经 `patchedDependencies` 应用)把 typert map/context 收集限制在 workspace 注册文件内——否则 npm 解析的 dsh 双胞胎实例(如循环 peer 产生的两份 `dsh-session`)会重复声明 map,导致生成失败。

## 限制

- 回滚只恢复会话工作区(git worktree 边界)内的文件;工作区外的 agent 写入不在覆盖范围。
- steer 消息排除是尽力而为:rc.6 的 durable 侧没有 `delivery` 字段,以 source-kind + 纯文本检查为边界。
- 接纳失败在回合停止时轮询一次得知(rc.6 的 api-remotes allowlist 无法转发推送事件)。

## License

MIT
