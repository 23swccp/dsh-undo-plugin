# dsh-rollback-plugin 完整计划

> 独立 DeepSeek Harness（dsh）插件：会话回滚 + 归档任务。
> 目标：做成**纯独立插件**，发布到作者自己的 GitHub 账号，别人一条命令安装即可使用，**不修改 dsh 本体**。
> 本文件是实施蓝图，评审通过后按"实施步骤"逐条执行。

---

## 1. 项目目标（大白话）

做一个 dsh 的"后悔药"插件：

- 用户在对话里发了一条消息（AI 回答完），点"回滚"，工作区的文件回到发这条消息之前，对话也回到那条消息之前。
- 被回滚掉的旧对话收进"归档任务"页，可以查看。
- 发布到 GitHub，别人运行 `dsh plugin --profile web add <你的包名>` 就能装。

**硬约束**：不修改 dsh 本体任何源码（dsh 核心包从 npm 安装，直接用它的公开能力）。

---

## 2. 技术结论（为什么能做到 / 哪里要打折扣）

### 2.1 已确认的前提

1. **dsh 核心包已发布到 npm**（实测：`@deepseek-ai/dsh-agent@0.1.0-rc.6`、`@deepseek-ai/dsh-session@0.0.1-rc.1`、`@deepseek-ai/cordis@4.0.1`）→ 独立仓库可以 `npm install` 依赖，不依赖 dsh 源码。
2. **dsh 的插件机制完整可用**：
   - bundle = npm 包 + `package.json` 里声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。
   - 安装命令：`dsh plugin --profile <name> add <包>`（CLI 已有 `plugin` 子命令，`apps/cli/src/plugin.ts`）。
   - 插件的浏览器部分能被 web 装配加载（`client-modules` 扫描 `dsh.client` 声明 → serve `/plugins/<id>/client.js` → 注入 `window.__DSH_BOOT__`）。
3. **GitHub 上已有 dsh 插件生态**（[vlln/plugin-registry](https://github.com/vlln/plugin-registry)、[w2112515/dsh-plugin-development](https://github.com/w2112515/dsh-plugin-development)、官方 [RFC #1629](https://github.com/deepseek-ai/deepseek-harness/discussions/1629)），独立 bundle 是生态惯例做法。

### 2.2 与原始规格（PLAN.md）的重要功能对照

以下逐条对照原始交付规格（`dsh 回滚/PLAN.md`）的重要功能，标注路线 B（纯插件）下的状态。**核心体验（回滚 + 归档可见）完整保留；凡降级/放弃均有明确原因。**

| # | 原始规格功能（PLAN.md 出处） | 路线 B 状态 | 说明 |
|---|---|---|---|
| 1 | 回滚文件到消息前（§1, §4.1） | ✅ 完整 | Shadow Git 快照，插件自有 `GIT_DIR`，不碰用户 git |
| 2 | 对话回滚到消息前，模型看不到被回滚内容（§2.1） | ✅ 完整 | 事件前缀切分 + `ctx.agents.create(seed)`，新会话只读前缀 |
| 3 | 旧会话 S1 进全局归档集合并从侧边栏消失（§1, §2.2） | ✅ 完整 | `ctx.workspaceRegistry.archiveSession`（公开） |
| 4 | 归档任务页：查看只读对话（§5） | ❌ 去掉 | dsh 原版无归档查看界面，插件不自建只读对话渲染；归档 = 隐藏，不提供查看 |
| 5 | 单轮回滚对 journal（S1/S2/beforeTree/redoTree）（§2.2, §4.1） | ✅ 完整 | 插件自有持久化 journal，含事务 phase |
| 6 | 回滚互斥锁 + 二次点击 `rollback-in-progress`（§4.3.1） | ✅ 完整 | 插件进程内锁 + 工作区粒度锁 |
| 7 | 快照失败：模型不收 prompt、composer 回填原 prompt + 脱敏详情（§4.2） | ✅ 完整 | `agent/pre-step` 瀑布可拒绝（公开事件），RPC 错误回填 |
| 8 | 运行中回滚：等待 0.5 秒后强制停止（§4.3.3-4） | ⚠️ 降级 | 只能 `agent.cancel()` 请求停止 + 等待 idle；**无强制终止**（`dispose` 是创建者私有 capability） |
| 9 | 永久删除旧会话日志/附件/归档记录（§2.2, §5） | ⚠️ 降级 | 改为"墓碑标记"：插件记录已删除，UI 隐藏；磁盘文件保留（dsh 无删除 API） |
| 10 | 自动永久删除旧回滚对（新 prompt 接纳后）（§2.2, §5） | ⚠️ 降级 | 自动"墓碑标记"旧 S1；物理删除不可做 |
| 11 | 恢复归档对话（取消归档 + 打开）（§2.2, §5） | ❌ 放弃 | dsh 原版无 unarchive，归档后不可逆 |
| 12 | 撤销回滚（恢复 redoTree + 反转归档）（§2.2） | ❌ 放弃 | 反转归档需 unarchive（无公开 API），不可做；且 dsh 无归档查看界面，无可视化回退入口 |
| 13 | 按钮位于用户消息 Copy 旁（§6） | ⚠️ 调整 | 原版无用户消息级 slot；改挂会话头部/输入区现成 slot |
| 14 | 仅普通纯文本消息生成回滚点，steer/图片/注入不算（§2.1） | ⚠️ 部分 | 图片/非文本可判（content 检查）；**steer 无法 durable 区分**（原版无 delivery 标记，需插件侧启发式或文档声明） |
| 15 | 刷新/重连/多标签归档集合一致（§2.2, §5） | ✅ 完整 | 归档集合是 Host 全局状态，插件只读该集合 |
| 16 | 普通分支/普通手动归档行为不变（§8） | ✅ 完整 | 不碰 apiproxy fork；手动归档本就用公开 `archiveSession` |
| 17 | 启动恢复未完成 journal（§4.3） | ✅ 完整 | 插件自有 manifest + phase，可启动扫描 |
| 18 | 失败补偿（恢复失败/归档失败 → redoTree 补偿）（§4.3.6-7） | ✅ 完整 | 插件内逻辑，不依赖核心 |

### 2.3 一句话概括取舍

**回滚这个核心功能 100% 可用，且与原始规格一致；"打扫卫生"类功能（强制停止、永久删除、恢复、撤销回滚、只读查看）在纯插件约束下降级或放弃**——这是"不改 dsh 本体"的必然代价，§2.2 已逐条标注原因，方案评审时已确认接受。

---

## 3. 包结构设计

### 3.1 保留哪些、重写哪些（基于当前工作树）

当前工作树已有 5 个插件包，但其中依赖"dsh 尚未发布的新增 API"（terminate/unarchive/delete/removeImage/用户消息 slot），必须改写为只用公开 API：

| 包 | 当前状态 | 路线 B 处理 | 主要改动 |
|---|---|---|---|
| `session-fork`（前缀切分能力） | 用 `ctx.agents.create` + 公开 `seed`，**本来就纯插件** | ✅ 直接迁移 | 无 |
| `conversation-undo`（核心回滚） | 依赖 `agents.terminate`（未发布） | ✏️ 改写 | `terminate` → `cancel()` + 等待；其余（Shadow Git、journal）保留 |
| `session-archive`（归档能力） | 依赖 `unarchiveSession`/`delete`/`removeImage`（全部未发布） | ✏️ 重写 | 去掉恢复/删除；归档改单向 + 只读 |
| `ui-conversation-undo`（回滚按钮） | 依赖新增 `user-actions` slot（未发布） | ✏️ 重写 | 按钮改挂 `conversation.session.header.actions` 等现成 slot |
| `ui-settings-archive`（归档页） | 依赖远程装配在 `api/remotes`（未发布） | ✏️ 重写 | 改为插件自己在 `apply` 里 `$mount` 自己的 remote；只做列表 + 墓碑删除，不做只读查看/恢复/撤销回滚 |

### 3.2 建议的最终结构（可在实施时微调）

```
dsh-rollback-plugin/                    # 本仓库根（= 将来的 GitHub 仓库）
├── package.json                        # 根：pnpm workspace + 构建脚本
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── rollback-fork/                  # 前缀切分（原 session-fork 迁移）
│   ├── rollback-archive/               # 归档能力（重写，单向）
│   ├── rollback-undo/                  # 核心回滚（改写）
│   ├── client-rollback-button/         # 回滚按钮（重写，挂现成 slot）
│   ├── client-rollback-settings/       # 归档任务页（重写，自 mount remote）
│   └── bundle-rollback/                # 可安装 bundle（patch + 依赖声明）
├── docs/                               # 使用文档（英/中）
└── examples/                           # 最小可运行 cordis.yml 演示
```

> 包名实际用 `@<你的scope>/dsh-rollback-*` 或保持 `@deepseek-ai/dsh-*` 命名需评审时定（见 §8 评审点 2）。

---

## 4. 关键技术设计（实施依据）

### 4.1 回滚文件：Shadow Git（纯插件，不碰用户 git）

- 每个可回滚消息进入模型前，插件在当前工作区抓一次文件快照（`beforeTree`）。
- 快照存插件自己的独立 `GIT_DIR`（如 `$DSH_HOME/rollback/<workspace>/shadow.git`），**绝不写用户 `.git`、HEAD、branch、stash、index**。
- 点回滚时抓当前状态（`redoTree`），然后把工作区恢复成 `beforeTree`。
- 支持范围：git 可记录且未被 `.gitignore` 忽略的文件；忽略内容/子模块不恢复。

### 4.2 回滚对话：事件前缀切分 + `ctx.agents.create`

- 读源会话事件流（`ctx.sessions.get(id).events` 或 `ctx.sessionPersistence.inspect(id)`）。
- 找到目标 `user/message` 所属回合的 `turn/start`，取它之前的完整前缀作为 `seed`。
- `ctx.agents.create({ sessionId: 新id, seed, meta: { parentSession, cwd, ... } })` 创建新会话（公开 API，`CreateAgentOptions` 必填仅 `sessionId`）。
- 新会话 attach 到原工作区（`workspace.attachSession`）。
- 旧会话 `ctx.workspaceRegistry.archiveSession(旧id)` → 从侧边栏消失。

### 4.2a 合格消息判定（agent/pre-step 拦截）

- 监听 `agent/pre-step`（公开 waterfall 事件，`runtime-types.ts` 已定义，payload 含 `agent/messages/turn/step/signal`），在消息进入模型前判定并捕获。
- 合格：主会话、`source.kind === 'user'`、content 全部为 text 块（图片/附件/注入通过 content 与 source 形态排除）。
- **steer 无法 durable 区分**（原版无 delivery 标记）：插件在 `pre-step` 时对 messages 统一捕获（steer 也在其中），或仅在浏览器确认"普通发送"后才建立回滚点。实施时二选一并在 README 声明（对照表 #14）。
- 捕获失败：瀑布返回 `reject`，消息不写 `user/message`、不进模型；RPC 返回可读错误，浏览器用原 prompt + 脱敏详情回填 composer（对照表 #7）。

### 4.2b 单轮 journal、锁与启动恢复

- 每个活动回滚对存插件专属目录（journal = `manifest.json` + `shadow-git/`），字段与原始规格一致：`logicalConversationId`、`workspacePath`、`sourceSessionId`、`rollbackSessionId`、`messageId`、`beforeTree`、`redoTree`、phase、generation、schemaVersion（对照表 #5）。
- 互斥：按 `logicalConversationId` 与规范化工作区路径加锁；并发第二次点击返回 `rollback-in-progress`（对照表 #6）。
- 失败补偿：恢复 `beforeTree` 失败 → 处置新会话并用 `redoTree` 补偿；归档失败同理；补偿也失败则保留 journal 供启动恢复（对照表 #18）。
- 启动扫描：未完成 phase 按 manifest + 实际归档集合 + Shadow Git 树继续或返回可操作错误，不把未知中间态显示为成功（对照表 #17）。

### 4.3 浏览器通信：插件自挂 remote（不依赖 `api/remotes`）

- 主机插件类继承 `TypertRemoteService`，方法标 `@Remote(...)`（`@deepseek-ai/dsh-typert-protocol` 是已发布公开机制）。
- 浏览器插件 `apply` 里自己调用 `ctx.remote.$mount(<生成的自带 remote contribution>)`——`$mount` 是公开 API（`packages/typert/protocol/src/types.ts:228`），**不需要**改 dsh 的 `api/remotes` 装配清单。

### 4.4 归档页

- 列表：遍历 `ctx.workspaceRegistry.archivedSessionIds`（公开 getter），显示标题与归档时间。
- 查看只读对话：**不提供**（dsh 原版无归档查看界面，插件不自建；归档 = 隐藏）。
- 恢复：**不提供**（原版无 unarchive）。
- 删除：**墓碑标记**——插件在 `$DSH_HOME/rollback/` 记录"已删除"清单，UI 过滤掉；不碰磁盘文件。
- 撤销回滚：**不提供**（反转归档需 unarchive，且无归档查看界面）。

### 4.5 回滚前停止 AI（降级版）

- 检测 `ctx.agents.get(id).status`；非 idle 时 `agent.cancel({ kind: 'user' })`（公开）。
- 轮询 `whenIdle()` 等待停止；超时则提示"未能停止，仍继续回滚（风险自负）"或放弃。
- 明确不提供强制终止（`dispose` 是创建者私有 capability）。

---

## 5. 实施步骤（评审后逐条执行）

### 阶段 0：仓库初始化
1. 用 `pnpm create dsh-plugin`（若可用）或手搭 pnpm workspace 骨架。
2. 根 `package.json`：`type: module`、workspaces、`@deepseek-ai/cordis` 等 peer。
3. 确认依赖全部来自 npm（`@deepseek-ai/dsh-*` 已发布版本）。

### 阶段 1：迁移 `rollback-fork`（纯插件，改动最小）
1. 从当前工作树复制 `session-fork` 源码与测试，调整包名。
2. `pnpm install && pnpm test` 跑绿。

### 阶段 2：重写 `rollback-archive`（单向）
1. 去掉 `unarchiveSession`/`delete`/`removeImage` 调用。
2. 归档 = `archiveSession` + 只读 inspect；删除 = 墓碑清单。
3. 补测试（原包 0 测试，需补：归档列表、只读、墓碑过滤）。

### 阶段 3：改写 `rollback-undo`（核心）
1. `agents.terminate` → `cancel()` + `whenIdle()` 等待。
2. 保留 Shadow Git、journal 状态机、失败补偿。
3. 补/改测试（含"AI 运行中回滚"的降级路径）。

### 阶段 4：重写两个 client 包
1. 按钮挂现成 slot（`conversation.session.header.actions`），UI 文案说明"回滚最近一条消息"。
2. 归档页自 mount remote；列表/查看/墓碑删除。
3. 构建 `lib/client.js`（`tsdown` bundle）。

### 阶段 5：bundle 装配
1. `packages/bundle-rollback/`：`cordis.patch.yml` 注册 5 个包（host 3 + client 2，`dshHomePath` 配置）。
2. 依赖声明齐全（含被插入 client 包，供 `client-modules` 解析）。

### 阶段 6：验证
1. `pnpm run typecheck`
2. 各包 vitest 全绿
3. `verify-cordis-config` 对 bundle patch 生效
4. 本机模拟安装：`dsh plugin --profile web add <本地包>` + `dsh --profile web --dump-config`
5. 端到端手测（需要 `DEEPSEEK_API_KEY`）：发消息→改文件→回滚→文件与对话恢复、旧会话进归档页。

### 阶段 7：发布
1. 初始化 git、写 README（含安装/卸载/前置条件/已知限制）。
2. 推 GitHub → `npm publish`（或让用户直接 `dsh plugin add git+https://...`）。
3. README 写明：需要 dsh 版本含"归档、cancel、现成 header slot"（即当前已发布版本即满足）。

---

## 6. 验收标准

- [ ] 独立仓库，零依赖 dsh 源码（只从 npm 装 `@deepseek-ai/dsh-*`）。
- [ ] `dsh plugin --profile web add <包>` 一条命令装上。
- [ ] 回滚后：文件回消息前、对话回消息前、旧会话进归档页（对照表 #1-#3）。
- [ ] 归档页可列出归档会话、可墓碑删除（对照表 #4、#9）。
- [ ] 单轮 journal 成立：S1 归档、S2 继承前缀、beforeTree/redoTree 关联（对照表 #5）。
- [ ] 并发点击回滚得到 `rollback-in-progress`，UI 保持 pending（对照表 #6）。
- [ ] 快照失败：模型不收 prompt、composer 回填原 prompt + 脱敏详情（对照表 #7）。
- [ ] AI 运行中回滚：请求停止并等待，不停则明确提示，不假装成功（对照表 #8）。
- [ ] 重启后未完成 journal 可识别并处理（对照表 #17）。
- [ ] 失败补偿路径（恢复失败/归档失败）有测试覆盖（对照表 #18）。
- [ ] 所有测试、typecheck 在独立仓库内通过（不依赖 dsh 工作树）。
- [ ] 文档（README 英/中）完整，含 §2.2 的降级/放弃清单。

---

## 7. 风险与限制（诚实清单）

1. **降级功能**：强制停止→请求停止、永久删除→墓碑。**放弃功能**：恢复归档、撤销回滚、归档只读查看。详见 §2.2 对照表 #4、#8-#12。
2. **按钮位置**：不在用户消息旁，在会话头部/输入区，语义需 README 说明。
3. **归档不可逆**：归档后旧会话无法恢复，UI 需明确提示。
4. **Shadow Git 边界**：忽略文件、子模块、未注册后台写入不保证；回滚会覆盖之后受支持路径的本地修改。
5. **端到端验证依赖 key**：无 `DEEPSEEK_API_KEY` 时只能跑单元/装配验证，真实链路需有 key 环境。
6. **版本漂移**：dsh npm 版本演进可能影响 `ctx` 服务签名，发布前锁定 peer 版本范围。

---

## 8. 评审点（需要作者/维护者确认）

1. **包命名 scope**：`@<GitHub用户名>/dsh-rollback-*` 还是 `@deepseek-ai/dsh-*`？（推荐前者，独立身份）
2. **仓库名**：`dsh-rollback-plugin`？（可改）
3. **bundle 是否进同一仓库**：推荐是（monorepo 内 `packages/bundle-rollback`），发布时单仓库出多个 npm 包。
4. **降级取舍确认**：§2.3 的四项降级是否接受（评审时已口头接受，此处书面确认）。
5. **要不要 headless 版**：只做 web（带 UI）即可，还是额外出 host-only bundle？（默认先 web）
