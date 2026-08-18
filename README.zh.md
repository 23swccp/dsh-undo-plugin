# dsh-rollback-plugin

对话回滚与归档任务,以**可安装的 DeepSeek Harness(dsh)插件 bundle** 形式交付——独立工作区,不打补丁、不修改 dsh 本体,只使用 npm 上发布的 dsh 公开 API(`@deepseek-ai/dsh-*@0.1.0-rc.6`)。

## 功能

- 会话头部"回滚"操作:把工作区与对话回滚到最近一条已完成纯文本用户消息之前:
  - 文件树从插件私有的 Shadow Git 快照恢复(独立 `GIT_DIR`,绝不写用户 `.git`);
  - 对话 fork 出新 Session,其 seed 是目标消息之前的完整事件前缀——模型永远看不到被回滚的提示词、助手回复与工具调用;
  - 旧 Session 进入 Host 全局归档集合并从侧边栏消失。
- "设置 → 归档任务":列出全部归档 Session,支持只读查看与隐藏。
- 快照在 `agent/pre-step` 捕获;捕获失败会拒绝该步骤(模型不收 prompt),并把原提示词与已脱敏技术详情回填 composer。

## 包结构

| 包 | 职责 |
|---|---|
| `packages/rollback-fork` | Session fork 能力:completed-turn / before-user-message 精确切分 |
| `packages/rollback-archive` | 归档能力:列表、只读查看、墓碑隐藏 |
| `packages/rollback-undo` | Shadow Git journal + 单轮回滚编排 |
| `packages/client-rollback-button` | 浏览器:会话头部回滚按钮(自 mount Remote) |
| `packages/client-rollback-settings` | 浏览器:归档任务设置页(自 mount Remote) |
| `packages/bundle-rollback` | 可安装 bundle:`cordis.patch.yml` + 依赖清单 |
| `packages/typert-protocol` | vendor 的 `@deepseek-ai/dsh-typert-protocol` 源码(typert 生成需要,见下) |

## 安装

```sh
dsh plugin --profile web add /path/to/dsh-rollback-plugin/packages/bundle-rollback
```

headless profile 可删去 `packages/bundle-rollback/cordis.patch.yml` 中两行
`client-rollback-*`。

前置条件:dsh `0.1.0-rc.6`(peer 范围);浏览器侧需要 `dsh-web-app` 表面
(`conversation.session.header.actions`、`settings.section` 槽位与
`ctx.remote.$mount`)。

## 与原始规格的降级对照

原仓库内方案依赖未发布的核心 API;独立版保留核心体验(回滚 + 归档可见),
"打扫卫生"类功能降级:

| 原始规格 | 独立版行为 |
|---|---|
| 强制终止运行中的 Agent | `cancel()` + 静止等待(0.5 秒宽限,强制停止已注册 job/PTY,仍忙则拒绝) |
| 永久删除日志/附件 | 墓碑隐藏:条目离开归档列表,磁盘文件保留 |
| 恢复对话 / 撤销回滚 | 放弃(dsh 无 unarchive 公开 API) |
| 用户消息旁回滚按钮 | 会话头部"回滚最近消息"操作 |
| 实时 `undo/admission-failed` 推送 | Host 缓存失败,浏览器在回合停止时轮询一次并回填 composer |
| steer 排除 | 尽力而为:durable 侧无 `delivery` 字段,以 source-kind + 纯文本检查为边界 |

## 开发

```sh
pnpm install
pnpm run typecheck   # 先构建 host 产物(typert 生成),再检查 client 面
pnpm test            # vitest,7 个文件 / 19 个用例
pnpm run build       # host lib + client bundle(lib/client.js)
```

### 为什么 vendor typert-protocol 并打生成器补丁

typert 生成器只在声明包是 workspace 注册包时识别 `Remote` /
`TypertRemoteService`,并把导出目标映射回 `src/`。对 npm 解析的 dsh 包需要两件事:

1. `packages/typert-protocol` vendor 协议源码;`pnpm-workspace.yaml` 用
   overrides 让所有 dsh 包解析到它(`workspace:^`);`tsconfig.base.json` 把
   `@deepseek-ai/dsh-typert-protocol` 映射到 `src/`。
2. `patches/typert-generator-workspace-only.patch`(经 `patchedDependencies`
   应用)把 typert map/context 收集限制在 workspace 注册文件内——否则 npm
   解析的 dsh 双胞胎实例(如循环 peer 产生的两份 `dsh-session`)会重复声明
   map,导致生成失败。

## License

MIT
