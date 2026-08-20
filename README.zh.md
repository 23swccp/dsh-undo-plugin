# dsh-undo-plugin

[English](README.md) | 中文

[![CI](https://github.com/23swccp/dsh-undo/actions/workflows/ci.yml/badge.svg)](https://github.com/23swccp/dsh-undo/actions/workflows/ci.yml)

## 大致介绍

[dsh-undo-plugin](https://github.com/23swccp/dsh-undo) 是 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的对话撤销插件:一句 `/undo` 就能把**工作区文件和对话一起**退回到最近一条已完成消息之前;被回滚的会话进入"设置 → 归档任务"统一管理(查看 / 恢复 / 永久删除 / 全部删除)。回滚错了也不要紧——输入框上方的"撤回回滚"折叠条可以完整恢复。

插件以**可安装 bundle** 形式交付:独立工作区、不打补丁、不修改 dsh 本体,只使用 npm 上发布的 dsh 公开 API(`@deepseek-ai/dsh-*@0.1.0-rc.6`)。文件回滚走插件私有的 Shadow Git 快照(独立 `GIT_DIR`,绝不碰你的 `.git`)。



## 具体功能

### 对话撤销(回滚)
- **四个入口**:合格用户消息操作行的回滚图标按钮(回车键图标,紧邻"复制")、会话头部"回滚"按钮、`/undo` 斜杠命令、输入框上方折叠条
- 消息级按钮只出现在当前回滚点指向的那条用户消息上(精确匹配消息 id),随回滚点移动;运行中禁用,DOM 补丁注入、React 重渲染自愈
- 文件树从私有 Shadow Git 快照恢复;对话 fork 成新会话(seed 是目标消息**之前**的完整事件前缀——模型永远看不到被回滚的提示词、回复与工具调用)
- 旧会话自动归档并从侧边栏消失,UI 自动切换到新会话
- 快照在 `agent/pre-step` 捕获;失败会拒绝该步骤(模型不收 prompt),并把原提示词与脱敏原因回填输入框

### 撤回回滚
- 仅在回滚后出现 `↩ 已回滚 <预览> [撤回回滚]` 折叠条,新 prompt 接纳后自动消失
- 完整反向事务:先校验工作区未被改动(已分叉则拒绝 `workspace-diverged`,不覆盖你的修改)→ 恢复源会话与文件 → 重新武装回滚点;回滚与撤回对称、可重复
- `restoring` / `revoking` 相位 journal 在启动时按磁盘证据确定性恢复

### 归档任务(设置 → 归档任务)
- 列出全部归档会话(标题 / 归档时间 / 创建时间 / 工作区),支持只读查看
- **恢复**:把归档对话 fork 回新会话(可重复恢复,归档条目保留)
- **删除**:永久删除该会话的磁盘日志(busy 的 agent 先 cancel 并等 idle)
- **全部删除**:一次批量 RPC + 二次确认;部分失败提示"已删除 X 个,Y 个失败"

### 推理与行动折叠条
- 每个 prompt 回合获得独立的「推理与行动」折叠条:该回合的思考(Think)、中间叙述、上下文注入与全部工具调用整段收起/展开;**最终结论与统计行永不折叠**
- 回合运行中显示"运行中…"并保持展开;回合结束且视图跟随到底部时自动收起;手动点击随时覆盖
- 无结论回合(如以报错工具调用收尾)不折叠——错误保持可见;加载的历史回合保持展开
- 纯 CSS/DOM 注入:只依赖官方渲染器发布的稳定 `data-chat-flow-kind` 边界(user / assistant-step / tool-call / turn-tail),不触碰 React 管理的节点结构

### 工具卡片配色
- 会话里每个工具调用(pwsh/bash、edit/write、read、grep/glob、web、run_code)展开后的内容卡片按工具类型着色:**bash 终端卡恒为黑底**(亮色主题下也保持)、**pwsh 终端卡为 PowerShell 窗口同款蓝**、其余工具为与主题协调的浅色调(edit 绿 / read 紫 / 搜索蓝 / web 青 / 代码琥珀)
- 纯 CSS 注入:只用官方渲染器已发布的稳定 `data-*` 钩子(`data-tool`、`data-terminal`、`data-diff` 等),不依赖哈希类名,React 重渲染自动生效

### 自更新
- 任意会话执行 `/update`:一键完成 `git pull --ff-only` → `pnpm install` → `pnpm run build`(分步超时保护;已是最新则跳过安装构建),重启 dsh 生效
- 无后台自动更新,永远由用户显式发起;`--ff-only` 绝不改写本地提交

### 性能与可靠性
- 7,400+ 文件工作区实测:**回滚 / 撤回各约 1 秒**(优化前感知 30–40s)
- 关键优化:单次 `diff-tree` 路径限定 restore、`untrackedCache` + `splitIndex`、fork ∥ restore 并行、stat 预热 + 下一代 prearm
- Windows 原子写入:`EPERM` / `EBUSY` / `EACCES` rename 退避重试 + 临时文件自动清理

## 安装办法

### 前置条件
- Node.js(`^22.19 || >=24`)与 dsh `0.1.0-rc.6` / `0.1.0-rc.7`
- 浏览器界面需要 `dsh-web-app` 表面(web profile 默认满足;headless profile 可删去 patch 里四行 `client-rollback-*`)

### 安装
```sh
git clone https://github.com/23swccp/dsh-undo.git
cd dsh-undo
pnpm install
pnpm run build
dsh plugin --profile web add ./packages/rollback-fork ./packages/rollback-archive ./packages/rollback-undo ./packages/client-rollback-button ./packages/client-rollback-settings ./packages/client-rollback-toolcards ./packages/client-rollback-trailfold ./packages/bundle-rollback
```

八个包都要 link:pnpm 的 `link:` 协议不会安装被链接 bundle 的依赖,而 dsh 加载器从 profile 的 `node_modules` 解析插件包名,因此七个插件包需要与 bundle 一起各自 link。

重启 dsh 后:会话头部出现"回滚"按钮,输入 `/undo` 可直接回滚;设置里出现"归档任务"页;每回合出现「推理与行动」折叠条;工具调用展开卡片按工具类型着色。

### 更新
在任意会话执行 `/update`(要求以 git clone 方式安装),完成后重启 dsh。手动等价:

```sh
git pull && pnpm install && pnpm run build
```


## 包结构

| 包 | 职责 |
|---|---|
| `packages/rollback-fork` | Session fork 能力:completed-turn / before-user-message 精确切分 |
| `packages/rollback-archive` | 归档能力:列表、只读查看、恢复、永久删除、全部删除 |
| `packages/rollback-undo` | Shadow Git journal + 回滚/撤回编排 + `/undo`、`/update` 命令 |
| `packages/client-rollback-button` | 浏览器:会话头部回滚按钮与撤回折叠条(自 mount Remote) |
| `packages/client-rollback-settings` | 浏览器:归档任务设置页(自 mount Remote) |
| `packages/client-rollback-toolcards` | 浏览器:工具卡片按工具类型着色(纯 CSS 注入) |
| `packages/client-rollback-trailfold` | 浏览器:每回合「推理与行动」折叠条(DOM 注入) |
| `packages/bundle-rollback` | 可安装 bundle:`cordis.patch.yml` + 依赖清单 |
| `packages/typert-protocol` | vendor 的 `@deepseek-ai/dsh-typert-protocol` 源码(typert 生成需要) |

## 开发

```sh
pnpm install
pnpm run typecheck   # 先构建 host 产物(typert 生成),再检查 client 面
pnpm test            # vitest,12 个文件 / 61 个用例
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

[MIT](LICENSE)
