# dsh-rollback-plugin 交接文档

> 独立 dsh 插件项目(会话回滚 + 归档任务)的实施交接。原仓库内方案
> (`dsh 回滚/` 工作树)方向已废弃;本目录是重新定位后的成品。
> 与 `dsh-rollback-plugin/PLAN.md`(评审蓝图)配套阅读。

## 开发约定(必读)

- **只改本插件仓库(dsh-undo),永远不改 dsh 本体源码。** 本插件是纯插件,
  依赖 npm 发布的 dsh 公开 API;改 dsh 源码对 npm 安装的用户无效,只会制造
  混乱。此前的 `SettingsRoot.tsx` 图标修复(`b4b7072`)即教训。
- **dsh 缺的能力一律在插件侧解决**(例:归档导航图标 → navIconPatch.tsx)。
- 确属 dsh 本体的 bug/改进时,以**独立 PR 提交 deepseek-ai 上游**,本插件
  不得依赖该 PR 合并后的行为。
- fork 分支(codex/conversation-undo-plugin)仅作主树改动暂存,不进入插件。

## 交付状态:已完成并通过

- **6 个包 + 1 个 vendored 依赖** 全部构建通过:
  - `packages/rollback-fork`(会话 fork 能力,近原样迁移)
  - `packages/rollback-archive`(重写:列表/只读/墓碑隐藏,无恢复/永久删除)
  - `packages/rollback-undo`(改写:去 terminate/去 restoreUndo,新增
    `admissionFailure` Remote,自动清理降级为墓碑)
  - `packages/client-rollback-button`(重写:挂 `conversation.session.header.actions`,
    自 `$mount` Remote,running 停止后轮询 admission-failed 并回填 composer)
  - `packages/client-rollback-settings`(重写:挂 `settings.section`,
    列表 + 只读查看 + 墓碑删除)
  - `packages/bundle-rollback`(cordis.patch.yml + 依赖清单)
  - `packages/typert-protocol`(vendor 的 `@deepseek-ai/dsh-typert-protocol` 源码)
- **验证**:`pnpm run typecheck`(host+client 双聚合)通过;`pnpm test`
  7 文件 19 用例全绿;`pnpm run build` 产出 host `lib/` 与两个
  `lib/client.js`(含 `__ModuleLoader__.load` banner,remote contribution inline)。

## 关键技术决策(重构要点)

1. **纯插件约束下的降级**(对照原 PLAN.md §2.2):
   - 强制终止 → `cancel()` + 0.5s 宽限 + force-stop 已注册 job/PTY + 仍忙拒绝;
   - 永久删除 → 墓碑(插件私有 `tombstones.json`,列表过滤;磁盘文件保留);
   - 恢复归档 / 撤销回滚 → 放弃(dsh 无 unarchive 公开 API);
   - 回滚按钮 → 会话头部(原版无用户消息级 slot);
   - `undo/admission-failed` → Host 内存缓存 + `@Remote('admissionFailure')`,
     浏览器在 `session.running` 由 true→false 时轮询一次(原版推送事件无法
     经 api-remotes 的硬编码 allowlist 转发)。
2. **typert 生成的三个必要条件**(否则 `pnpm run build:lib:host` 失败):
   - typert-protocol 必须是 workspace 注册包(vendor 源码);`pnpm-workspace.yaml`
     `overrides` 强制所有 dsh 包解析到它;
   - `tsconfig.base.json` `paths` 把 `@deepseek-ai/dsh-typert-protocol`
     (含 `/types`)映射到 `src/`——生成器把导出目标映射回 `src`,而 npm
     解析会落在 `lib/types/index.d.ts`;
   - `patches/typert-generator-workspace-only.patch`(patchedDependencies 应用):
     `typeMetaMapMembers` 只扫描 workspace 注册文件,否则 npm dsh 双胞胎
     实例(循环 peer 产生的两份 dsh-session 等)会重复声明 TypertLookupMap/
     TypertContextMap。
   - 包级 tsconfig 需 `references` typert-protocol(host+client 聚合同)。
3. **`@dsh-rollback/*` 内部依赖用 `workspace:^`**;dsh peer 一律
   `^0.1.0-rc.6`;`@deepseek-ai/cordis` 是 `^4.0.1`(不是 rc.6)。
4. **浏览器客户端不 inject `remote.<namespace>`**(自 mount 场景下会与
   $mount 形成循环依赖),只 inject `remote` 服务。

## 已踩的坑(复现指引)

- PowerShell 5.1 `Set-Content -Encoding UTF8` 写 BOM → tsdown/vite JSON
  parse 失败;统一用无 BOM UTF-8。
- vitest 转译 TS 6 standard decorators 失败 → `vitest.config.ts` 里
  `standardDecoratorPlugin()`(TS transpileModule 预转换,复刻自 dsh)。
- tsdown host pass 会把无 `src` 的 bundle 包当 entry 报错 → bundle 包
  tsdown.config.ts 返回 `[{ entry: '' }]`。
- pnpm 11 不再读 package.json 的 `pnpm` 字段,设置全在 pnpm-workspace.yaml。

## 遗留与建议

- **端到端手测未做**(需 `DEEPSEEK_API_KEY`):真装配 web profile 下验证
  回滚/归档/失败回填;安装命令
  `dsh plugin --profile web add <bundle 路径>` 的实测。
- 包名为本地 scope `@dsh-rollback/*`,`private: true`;发布前按
  PLAN §8 决定正式 scope 并去掉 private、补 README 双语与版本前置说明。
- 测试面比原工作树小(原 78 文件/1157 用例跨 9 包;本独立项目聚焦 6 包),
  核心逻辑(Shadow Git、journal schema、切分、控制器、UI)均有覆盖;
  rollback-undo 的完整状态机(arm/ready/quiescing/restoring/complete)与
  启动恢复(recoverJournals)尚无直接测试,建议后续补。
- `dsh-rollback-plugin/PLAN.md` 为评审蓝图(未改动);本文件为其实施记录。

## 本地装配记录(2026-08-16 已实测)

在 `~/.dsh/profiles/web` 上装配成功并启动验证:

```sh
# 1) 无空格 junction(路径含空格会导致 pnpm/dsh 参数拆分,链接悬空)
mklink /J C:\Users\34293\dsh-rb-link "C:\Users\34293\Desktop\dsh 回滚\dsh-rollback-plugin"

# 2) 装 5 个插件包(link 协议;包依赖已改为真实版本 ^0.1.0-rc.6)
dsh plugin --profile web add "link:C:\Users\34293\dsh-rb-link\packages\rollback-fork" \
  "link:C:\Users\34293\dsh-rb-link\packages\rollback-archive" \
  "link:C:\Users\34293\dsh-rb-link\packages\rollback-undo" \
  "link:C:\Users\34293\dsh-rb-link\packages\client-rollback-button" \
  "link:C:\Users\34293\dsh-rb-link\packages\client-rollback-settings"

# 3) 装 bundle(进入 dsh.profile.bundles 层)
dsh plugin --profile web add "link:C:\Users\34293\dsh-rb-link\packages\bundle-rollback"
```

验证结果:
- `dsh --profile web --dump-config`:5 行插件从 bundle 层插入 ✓
- `dsh --profile web` 启动,`http://127.0.0.1:3080` HTTP 200 ✓
- `window.__DSH_BOOT__.entries`(40 条)含 `@dsh-rollback/client-rollback-button` 与
  `client-rollback-settings` ✓
- `/plugins/@dsh-rollback/client-rollback-button/client.js` 等 200(151/176 KB)✓

**踩坑**:`link:C:\...\dsh 回滚\...`(路径含空格)被 pnpm 拆成 `link:C:\...\dsh` +
`回滚\...` 两个 spec,产生悬空链接;必须经无空格 junction。改代码后需在
`dsh-rollback-plugin` 内重跑 `pnpm run build`(link 实时可见)。

**使用前提**:浏览器需先有会话并发送过合格纯文本消息,回滚按钮(会话头部)
才会出现;模型调用仍需 `DEEPSEEK_API_KEY`。

## 浏览器实测记录(2026-08-16,脚本 `scripts/debug-browser.mjs` + puppeteer-core)

通过驱动系统 Chrome 验证了完整链路,并修复了三个隐藏 bug:

1. **react 双实例**(`slot entry crashed in 'conversation.session.header.actions':
   Cannot read properties of null (reading 'useState')`):bundle 把 react inline 了,
   `scripts/client-externals.ts` 补上平台种子(`react`/`react/jsx-runtime`/`react-dom`/
   `react-dom/client`/cordis/ui-slots 等)——模块表共享一份 react。
2. **`UserMessageNode.messageId` 发布版不存在**(工作树里是本功能加的):
   按钮判定改为"Host 持有回滚点即显示"(journal 只保留最近一条合格消息,
   `view.value.messageId !== undefined` 即可),不再比对消息节点。
3. **`ctx.remote.<namespace>` 属性访问必须声明 inject,但声明会与自 mount
   死锁**(cordis 在 apply 前等命名空间服务注册):改用
   `ctx.get('remote.<namespace>')`(mount 后读取,无需 inject)。

同时加了 `/rollback` host 命令(rollback-undo 注册,`ctx.commands.register`),
无参数,报错带会话 id 与工作区;这是消息级按钮之外最直接的触发入口。

**实测结果**:`/rollback` 在消息回合完成后执行成功——journal `ready`→`complete`,
S2(`conversation-undo-*`)创建、S1 归档;header 回滚按钮在持有回滚点的会话上
正常显示(aria-label `回滚到此消息之前`)。**命令路径也连贯了**:host 归档源会话
后,客户端 `followRollbackChild`(client-rollback-button)监听到 workspaces
归档增量,调用新增 `rollbackChild` Remote 拿回 child id,自动 `sessions.open`——
实测 `/rollback` 成功后约 20 秒内 UI 自动切到新会话,无需手动点击。

**时序提示**:模型回合未完成时 `/rollback` 会报"没有可回滚的消息"(journal 未
就绪);等"用时 xx 秒"统计出现后再执行。刚分叉出的 child 会话没有自己的
journal,必须先发一条新消息建立回滚点才能再 `/rollback`(报错文案明确)。

## 2026-08-16 会话:修复"回滚后退出会话"

用户报告:执行 `/rollback` 后 UI 退出会话,要手动再点进新会话才能继续。

根因:命令路径(host 端 `/rollback` 命令)成功归档源会话后,没有任何客户端
联动;workspaces 投影把被归档的当前会话清出视图,UI 停在会话列表。

修复(独立插件内,不动 dsh 本体):
- host:新增 `@Remote('rollbackChild')`(types.ts 加 `ConversationRollbackChildRequest`),
  对 `phase: 'complete'` 且持有 `rollbackSessionId` 的 journal 返回 child id。
- client:client-rollback-button 订阅 `workspaces.list`,对每个归档增量调用
  `rollbackChild`;有 child 就 `sessions.open(child)`。手动归档无 journal 的
  会话不触发;冷启动基线里的旧归档也不触发(prevArchived 初始化时已含)。
- 验证:浏览器自动化在真实会话里发消息→回答→`/rollback`→UI 自动导航到新
  会话(`scripts/e2e-auto-navigate.mjs`,断言 localStorage `dsh.sessions.current`
  变化)。19 个单元测试 + typecheck + build 全绿。

## 2026-08-16 会话:输入框上方的"撤回"折叠条(opencode 样式)

按用户要求(参考 opencode 界面),新增 `RollbackFold` 组件:紧贴 composer
卡片上方的折叠消息条(`conversation.input.dock` slot,id `rollback-fold`):

- 有回滚点(最近一条已完成的纯文本消息)时显示一行:
  `↩ 可撤回 <prompt 预览(>48 字可展开/收起)> [撤回]`
- "撤回"按钮触发 `undo(messageId)`,成功后沿用既有逻辑自动 `sessions.open`
  新会话(实测 33s 内完成,`撤回中` 状态禁用按钮)
- 无回滚点/会话运行中不显示;运行中按钮禁用
- 实现:`packages/client-rollback-button/src/client/RollbackFold.tsx`(+ CSS
  module),apply 里与 header action 共用 controller 与 open 逻辑
- 验证:`scripts/e2e-fold.mjs` 驱动真实会话:回答完成 → 折叠条出现 → 点撤回 →
  自动导航到新会话(连续两轮 `ebccfc4e→04b4f6d8→2096ba0a` 均成功);
  单测 `previewLine`(短消息不截断/长消息省略号),20 个测试全绿
- 宽度对齐(用户要求,后修正):`.fold` 消费会话根上的 composer 宽度轴变量
  `width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px))` +
  `max-width: var(--dsh-composer-card-max-width, 780px)`(均带 fallback),与输入框
  卡片同 cap 同侧距,任意视口下两边完全对齐。先前硬编码 `max-width: 1152px`
  的对齐结论是错误的(旧 measure 脚本按"第一个有水平 padding 的祖先"找卡片,
  而 composer 卡片只有 padding-top,匹配到的是全宽的 InputBar 容器)。
- 注意:上一轮曾有一次点击撤回后无反应的偶发(重启后立即测试的竞态),
  复测连续成功;host 日志无错误

## 2026-08-16 会话:折叠条语义改为"撤回回滚"(仅回滚后出现)

用户修正语义:折叠条只在执行 `/rollback`(或头部回滚按钮)之后出现,功能是
**撤回回滚**(撤销这次回滚,恢复到被回滚的会话和文件状态),且在新 prompt
被接纳后消失。原"可撤回 [撤回]"语义(在普通会话上回滚最近消息)从折叠条
移除,回滚入口保留头部按钮与 `/rollback` 命令。

实现(独立插件内):
- **host(rollback-undo)**:新增 `@Remote('revokePair')`(child 会话读取保留的
  complete 回滚对)与 `@Remote('revoke')`(完整反向事务:校验工作区当前树等于
  `beforeTree`(否则 `workspace-diverged` 拒绝,不覆盖用户改动)→ fork 已归档
  源会话到 `completed-turn`(全量会话,归档会话仍可从 persistence 读取)→
  `shadow.restore(redoTree, beforeTree)` 恢复文件 → 归档 child → journal 改写为
  `{source: restored, phase: 'ready'}` 重新武装回滚点(可再次回滚,对称)。
  事务相位 `revoking` + `revokeSessionId` 字段,`recoverRevoking` 在启动时
  按"child 已归档且文件==redoTree"提交、"文件==beforeTree"回滚,否则
  `recovery-required`(与 `recoverRestoring` 对称)。
- **arm 陈旧 journal 清理**:每次接纳新 prompt 时删除同 source 的其他 journal
  (旧 lineage/代),修复两个问题:① 潜在 bug——child 会话连续两条 prompt 时
  第二条走新 lineage 目录,第一条 journal 残留导致 readJournal 歧义;
  ② revoke 回写的 ready 点被下一条 prompt 正确取代。
- **client**:controller 视图加 `revokePair`,refresh 同时取 current+revokePair;
  `revoke()` 成功后清空 pair 并返回 restored 会话 id 供导航。折叠条仅当
  `revokePair` 存在且会话非运行中时显示(运行中即时隐藏,配合新 prompt 接纳
  后 host 删除 pair);文案 `↩ 已回滚 <预览> [撤回回滚]`。
- 单测 28 个(新增 controller revoke 三例、fold 四例、schema revoking 一例)。

## 2026-08-16 会话:回滚/撤回回滚性能优化(实测 40s+ → 1.5s/10s)

用户反馈回滚与撤回回滚过慢,并发现折叠条宽度规则丢失(被某次回滚覆盖)。
实测定位与修复:

**慢的根因(真实工作区 7412 个跟踪文件,复刻 GIT_DIR 模式实测):**
- `git add --all`(capture):冷启动 31.7s / 热 5.8s
- `git write-tree`:冷 6.3s / 热 1.0s
- `read-tree` + `checkout-index --all --force`(restore):全量 11.1s
- 每条消息 arm 一次 capture;每次回滚 capture(redoTree)+restore;
  每次撤回回滚 capture(校验)+restore。加上 fork 新 Agent、归档、
  客户端 `sessions.open` 拉全量历史,感知 30-40s。

**优化(shadow-git.ts,不动 dsh 本体):**
1. restore 只对变更路径 `checkout-index --force -- <paths>`(diff-tree 已算出
   变更列表),不再 `--all` 全量重写;>400 路径回退全量(Windows 命令行限制)。
2. shadow repo 启用 `core.untrackedCache` + `core.splitIndex`(私有配置,不碰
   用户仓库):热 add 5.8s → 0.3s(untracked-cache 缓存目录扫描,split-index
   减 index 写)。

**实测(带轮询计时 e2e):** 回答完成后折叠条不出现 → 头部回滚 → **1.5s**
自动导航 child、折叠条出现 → 撤回回滚 → **10.3s** 自动导航 restored 会话、
折叠条消失。宽度规则已恢复(同 cap 780px、同 16px 侧距)。

**注意**:期间发现上轮"撤回回滚语义"全部实现(types/spec/index/controller/
fold/apply/8 个测试)曾被回滚丢失,已按原样恢复;e2e-fold.mjs 改为轮询
导航计时,不再固定 sleep。

## 2026-08-17 会话:文件未回滚根因 + revoke 提速(9.2s→3.2s)

**"写桌面文件 7777 后回滚未恢复"的根因**:`7777.txt` 写在桌面根
(`C:\Users\34293\Desktop\`),而会话 workspace 是 `C:\Users\34293\Desktop\dsh 回滚`。
shadow-git 快照只覆盖 workspace 内路径(git worktree 边界),桌面根不属于快照,
回滚自然不恢复。workspace 内文件回滚验证正常(diag:46s 创建→回滚→4.8s→文件删除)。
这是设计边界:回滚恢复"工作区文件";工作区外的 agent 写入不在快照内。

**revoke 慢的根因与修复(9.2s→3.2s)**:
- 分解:verifyMatches 校验"工作区==beforeTree"是瓶颈。原实现 capture 全量
  `git add + write-tree`(8.9s)。改用 `git diff --quiet <tree>` + `ls-files -o`
  校验——但 git diff 冷态(index stat 被 read-tree 重置)仍要 9.96s 全量 stat,
  热态仅 0.34s。
- 修复:undoLatest 完成时后台 `update-index --refresh` 预热 stat 缓存,并把
  promise 记录到 `statWarmers`(按 shadow 目录);revoke 的 verify 前 await 该
  promise(完成则立即,未完成则等,最长 ~3s)。正常路径 revoke RPC 3.2s。
- `verifyMatches` 语义:git diff 只查 tracked 文件,`ls-files -o` 补 untracked;
  工作区有修改或新文件都返回 false(workspace-diverged 拒绝)。
- 恢复逻辑(recoverRestoring/recoverRevoking)同步改用 verifyMatches。

**事故记录(重要)**:用 PowerShell `Get-Content -Raw` + `Set-Content -Encoding UTF8`
改含中文的源文件会把整个文件按 ANSI(GBK)误解码再写回,全文件中文损坏且部分
不可逆(引号被吞)。index.ts 曾因此损坏,靠 `lib/types/index.js`(tsc 正确产物)
提取 20 个中文串 + 逐行修复恢复。教训:修改含中文的源码用 node 脚本或编辑器,
不要用 PowerShell 文本管道;`lib/types/*` 是修复乱码的可靠参照。

实测(带轮询计时):回滚 2.1s、撤回回滚 3.2-6.7s、宽度规则正常、折叠条
"仅回滚后出现/新 prompt 消失"语义完整。

## 2026-08-17 会话:归档任务"删除"不可用修复

用户反馈归档任务页删除显示"操作未完成，请重试"。排查三层:

1. **patch 冲突**:base bundle 的 `ui-settings-archive`(dsh-client-ui-settings-archive)
   先注册 `sessionArchive` 命名空间,插件的贡献被 mountOnce probe 跳过 → 客户端
   `remote.sessionArchive` 无 tombstone 方法。修复:插件 bundle patch 禁用该行
   (`{ id: ui-settings-archive, disabled: true }`),插件贡献正常挂载。
2. **参数形态 bug**:`tombstone(sessionId: SessionId)` 生成裸值参数
   (wire `sessionId`,schema `z.intersection(z.string(), z.unknown())`),
   但客户端调用传对象 `archive.tombstone({ sessionId })` → gateway 位置参数
   parse 对对象做 string 校验失败(`rejected "sessionId"`,ZodError expected string)。
   对比:rollback-undo 的方法参数都是 `request`(对象)形态,传对象正确。
   修复:客户端改位置参数 `archive.tombstone(sessionId)`。
   **教训**:typert Remote 调用必须匹配生成参数的形态(裸值 vs 对象),看
   `lib/typert.remote-client.js` 的参数 `name/wire` 决定。
3. **tsc 增量缓存失效**:多次 `build:lib:client` 没重新编译(src 新于产物,
   tsbuildinfo 未失效)——改动"看起来没生效"的假象。修复:改动后显式
   `pnpm exec tsc -b tsconfig.client.json --force` 再打包;或删 tsbuildinfo。

验证:UI 删除 → 确认 → tombstone 请求发出、无错误、列表减少(46→45)。
host 端 list 过滤 tombstones、tombstone/untombstone 直接 RPC 均正常。
29 个单测全绿;临时诊断脚本已清理。

## 2026-08-17 会话:归档任务改为"可恢复 + 永久删除"

用户要求:归档对话可恢复;删除改为删除磁盘数据(原为 tombstone 隐藏)。

**实现(纯插件,rc.6 公开 API 内)**:
- **restore**(`@Remote('restore')`):用 rollback-fork 的 `completed-turn` 全量 fork
  归档会话为新可见会话(归档会话仍在 persistence,readSource 可读),返回新
  sessionId;客户端 `sessions.open` 直接打开。旧归档保留在列表(可重复恢复)。
- **delete**(`@Remote('delete')`):live 检查(agents/sessions 无实例)→
  `sessionPersistence.locate(header)` 拿 jsonl artifact 路径 → 删整个会话目录
  (`rm -rf dirname(path)`,含 session.jsonl.zstd)→ 清 archiveTimes → tombstone。
  其他 backend(locate undefined)拒绝(`backend-unsupported`)。
  rc.6 无 `unarchiveSession`/`sessionPersistence.delete`/`agents.terminate`
  (主仓库工作树有,未发布)——故 restore 用 fork 替代、delete 用 locate+rm。
- **客户端**:每项加"恢复"按钮(直接 open 新会话)与"删除"(真删,确认文案
  "永久删除此对话的磁盘日志?此操作不可撤销。");文案改为
  "归档对话可恢复为新的会话;删除会永久删除磁盘上的日志。";tombstone 的
  hide 入口移除(host 端 tombstone/untombstone 保留供回滚清理用)。
- **bundle patch**:额外禁用 base 的 `session-archive` host 行(与插件的
  restore/delete 端点冲突,禁用后插件完全接管 sessionArchive)。
- 已验证:restore 返回新会话(磁盘目录生成、workspace 归属保留)、delete 后
  磁盘目录消失、列表减少;UI 三按钮齐全;30 个单测全绿。

## 2026-08-17 会话:回滚后新分支发消息冷启动优化(31s→3s)

用户问速度优化,实施了最大可优化点:回滚产生的新分支第一条消息的 arm
快照要冷启动 `git add --all`(31.7s),用户回滚后立刻发消息会卡住。

**实现(rollback-undo)**:undoLatest complete 后**后台预初始化**下一 generation
的 shadow 目录(`new ShadowGit(workspace, childShadowDir).capture()`)。此时工作区
恰等于 beforeTree(restore 刚落地),正是新分支第一条消息的 beforeTree;用户
手动改过文件时 arm 的增量 add 自动修正。`prearms` Map 记录 promise,arm 的
capture 前 `await prearms.get(dir)` 避免与预初始化争用 shadow index(锁冲突
会让 capture 失败并拒绝消息)。

**验证**:磁盘证据——child shadow 目录含完整对象库(objects=258,冷启动产物),
arm 3s 内完成(此前冷 31s+);完整 e2e 无回归,且回滚/撤回回滚导航均 1.0s
(statWarmer 预热 + 系统缓存热)。30 个单测全绿。

剩余优化空间:verifyMatches 的 2.9s stat 是 NTFS+Defender 物理成本(建议
Defender 排除 ~/.dsh 和工作区);sessions.open 历史加载是 dsh 本体行为。

## 2026-08-17 会话:撤回回滚后再回滚变慢修复

现象:第一次回滚快,撤回回滚后再执行回滚明显变慢。

根因:revoke 的 verifyMatches/restore 会 read-tree 把 S3 的 shadow index stat
弄冷,而 revoke 完成时没有像 undoLatest 那样后台预热——再回滚的 redoTree
capture 变成全量冷 stat(10s+)。

修复:revoke commit 后与 undoLatest 相同,启动 statWarmer 预热当前 journal
目录的 shadow index(失败静默,verify 回退冷路径)。

验证:回滚#1 1.6s → 撤回 1.6s → 再回滚 1.6s,三者一致;30 单测全绿。

## 2026-08-17 会话:归档任务"全部删除"

设置-归档任务页新增"全部删除"按钮:host 端 `@Remote('deleteAll')` 遍历所有
非 tombstoned 归档会话逐个永久删除(复用 delete 逻辑,单个失败不中断),
返回 { deleted[], failed[] };客户端一次 RPC,确认框二次确认,成功后刷新,
部分失败提示"已删除 X 个，Y 个失败"。文案含参数插值
(`deleteAllPartial` 用 t(key, {deleted, failed}))。

验证:66 个归档一次清空(deleted 全量、failed 空、列表归零);31 单测全绿
(新增 deleteAll 确认用例)。注意:deleteAll 删除会话日志后,rollback-undo
的 journal 会残留引用已删会话(数据已删,无功能影响;undoLatest 对已删
source 报 not found,符合预期)。

## 2026-08-17 会话:"全部删除"无法执行修复

现象:UI 点"全部删除"无效果(用户报"无效操作")。

根因1(主):delete 的 live 检查把"agent 实例残留的归档会话"全部判为
session-live 拒绝——回滚只归档源会话、不销毁其 agent 对象,导致刚回滚的
归档几乎总是"live"。修复:busy agent 先 `cancel({kind:'user'})` + 轮询等
idle(2s 超时),仍 busy 才拒绝;idle 的 agent 残留不影响删除(日志删除后
内存对象无害,重启后消失)。TS 窄化坑:异步变化的 status 用独立变量
`Agent['status']` 从 `agent?.status` 读取,避免窄化误报。

根因2(次):deleteAll 的 partial 提示被 `reload()` 清掉(setFailure 先于
reload 的 setFailure(undefined))——调整为先 reload 再 setFailure。

验证:发消息→回滚(1.9s)→归档任务→全部删除→确认→请求发出、无错误、
列表归零、归档源会话日志从磁盘消失(当前活跃 child 会话日志保留,正确)。
31 单测全绿。

## 2026-08-18 会话:回滚/撤回回滚再提速 + 主树移植

发现此前全部性能优化(untrackedCache/splitIndex、路径限定 restore、
statWarmer、prearm)只做在本插件;web profile 实际运行的**主树
`packages/undo/conversation-undo` 仍是旧实现**(全量 checkout-index --all)。
本次两份同步优化:

- **restore(两份 shadow-git.ts)**:单次 `diff-tree --name-status` 直接得出
  删除/检出方向,省掉全量 ls-tree 目标树;仅检出变更路径(>400 回退全量)。
- **assertWorkspace 缓存(两份 index.ts)**:workspace 断言按工作区进程内
  缓存(失败不缓存)——此前每条消息 arm 都重跑 rev-parse + ls-files --stage
  (输出随整棵跟踪树线性增长)。
- **fork ∥ restore 并行(两份)**:journal(restoring/revoking) 落盘后,
  会话 fork 与文件 restore 并行(fork 只读会话持久化、restore 只写工作区
  文件)。journal 先行保证崩溃恢复视图与串行一致;fork 失败时 settle
  restore 并补偿反向 restore 归位文件后才走通用恢复。revoke 的 verify
  仍在 fork 之前(diverged 拒绝不产生会话)。
- **arm 扫描合并(插件)**:lineage 查找与陈旧点清扫共用一次 readJournals。
- **验证**:两份 tsc 通过;插件 31 单测全绿;主树 6 单测全绿;重启后浏览器
  实测(主树路径,7400+ 文件工作区):**回滚 1169ms、撤回回滚 653ms**
  (本插件时代最优 2.1s/3.2-6.7s)。状态转换与恢复语义全部正常。

## 2026-08-18 会话:`/update` 自更新命令

rollback-undo 新增 `/update` host 命令(与 `/undo` 同一注册点),一键更新
本插件安装:`git pull --ff-only` → `pnpm install` → `pnpm run build`,全部
经 shell spawn(Windows 解析 pnpm.cmd),分步超时 30s/120s/300s/600s,
超时 kill。HEAD 未移动时报告"已是最新(短哈希)"并跳过安装构建;任一步
失败返回带该步 stderr 的错误文案,提示手动执行的等价命令。更新后仍需重启
dsh(link 安装加载的是构建产物 lib/,重启后生效)。

- 工作区根由 `pluginWorkspaceRoot()` 从模块路径三级向上定位并校验
  `pnpm-workspace.yaml` 存在(src 与 lib 两种布局均成立,防布局变化静默
  错根)。
- 新增 `tests/update.spec.ts`(真实临时 git 仓库:克隆源+克隆):up-to-date
  不动 / 上游前进 HEAD 跟进 / 分叉克隆被 `--ff-only` 拒绝(不改写用户本地
  提交)。pluginWorkspaceRoot 在本仓库真实布局上断言成立。
- 命令无后台自动更新;永远由用户显式发起,拒绝带参调用(返回用法文案)。

## 2026-08-18/19 会话:GitHub 发布与文档收尾

- **发布**:插件整体上传至 **https://github.com/23swccp/dsh-undo**(公开,
  MIT,topics: dsh-plugin/deepseek/cordis/plugin/rollback;本地 origin 仍指
  `23swccp/dsh-rollback-plugin`,两仓库同源同步)。README 展示名改为
  **dsh-undo-plugin**,仓库与包名沿用历史 `rollback`,README 注记说明。
- **本地路径迁移**:插件工作区已从 `Desktop\dsh 回滚\dsh-rollback-plugin`
  独立为 `Desktop\dsh-rollback-plugin`(自包含,只依赖已发布 npm 包)。
  旧的 `dsh-rb-link` junction 指向已失效;重新 link 安装需按新路径建
  junction(仍需无空格路径)。
- **README 三段式重构**(中英双语):大致介绍 / 具体功能 / 安装办法。
  安装命令从占位符 `/path/to/...` 改为可复制的
  `git clone https://github.com/23swccp/dsh-undo.git` 全流程。
- **归档任务导航图标**(主树修复,非本插件):dsh `SettingsRoot.tsx` 的
  `navIcon` 原来只认 {models, agent-presets, plugins},本插件注册的
  `id: 'archive'` 落入 fallback 显示设置齿轮。主树改为 `NAV_ICONS` 查表
  (防 vite tree-shake)并映射 `archive` → `IconArchiveOutline20`。本插件
  以 `id: 'archive'` 注册 settings.section,主树修复后自动受益,无需改动。
- **"暂时无法读取归档任务"误报**:server 停止后浏览器旧页面所有 RPC 失败,
  归档页落到 `loadFailed` 兜底文案——不是数据 bug,重启 server 即恢复。

## 2026-08-19 会话:跨平台适配(macOS/Linux)与 CI 三平台矩阵

用户要求插件适配 Windows 之外的环境。全仓库平台耦合审计:运行时核心本就
平台无关(Shadow Git 管道命令走无 shell 的 spawn argv、`core.autocrlf false`
锁死行尾、`node:path` `sep` 拼接、`/update` 经 `shell: true` 由各平台默认
shell 解析 pnpm、原子写按错误码比较重试);仅两处 Windows-only,已修:

1. **4 个开发脚本硬编码 Windows Chrome 路径**(`scripts/debug-browser.mjs`、
   `e2e-fold.mjs`、`measure-fold.mjs`、`e2e-auto-navigate.mjs`):改为
   `process.platform` 三平台默认值 + `CHROME` 环境变量覆盖(Linux 非
   google-chrome 发行版用 `CHROME=` 指定)。
2. **rollback-archive `writeDocument` 非原子写**(writeFile 直接覆盖,有写
   半截 JSON 风险):补上与 shadow-git `writeJson` 对称的临时文件 + rename +
   `EPERM/EBUSY/EACCES` 退避重试;依赖方向 undo→archive 单向,不能反向复用,
   包内复制同模式。

- **CI**(`.github/workflows/ci.yml`):push master / PR 触发
  ubuntu/macos/windows 三平台矩阵跑 `pnpm install → typecheck → test →
  build`(fail-fast 关闭);首跑三平台全绿(29s/40s/1m5s),无 POSIX 实机的
  验证缺口就此补上。
- README 中英双语:加 CI 徽章;"Windows 注意"改为"平台支持"节;原子写
  描述修正(实为线性退避,非指数)。
- 提交:`9b16895` 跨平台修复、`4bd9def` CI、本次文档更新。

## 2026-08-19 会话:npm 版 dsh 安装实测,发现并修复 README 安装流程 bug

在全新修复的 npm 全局 dsh(0.1.0-rc.6,旧安装的 commander 依赖损坏,卸载重装
解决)上实测"全新用户按 README 安装":

- **Bug**:README 原安装命令只 `dsh plugin add ./packages/bundle-rollback`。
  pnpm 的 `link:` 协议不安装被链接 bundle 声明的依赖,而 dsh 加载器从 profile
  的 node_modules 解析插件包名——五个插件包不在 profile node_modules,启动
  直接 `ERR_MODULE_NOT_FOUND: Cannot find package '@dsh-rollback/rollback-fork'
  imported from profiles/web`。旧 junction 装配能用,正是因为当时六个包
  是逐个 link 的。
- **修复**:README(中英)安装命令改为一条命令 link 全部六个包,并注明原因。
- **验证**(npm 版 dsh + 新路径 Desktop\dsh-undo,工作区从 dsh-rollback-plugin
  改名而来,无空格不再需要 junction):
  - `dsh --profile web --dump-config`:5 个插件行从 bundle 层插入 ✓
  - `dsh web` 启动 HTTP 200 ✓;`/plugins/@dsh-rollback/client-rollback-button/
    client.js` 200(153KB)、client-rollback-settings 200(178KB)✓
- **无害警告**:dump-config 报 patch 的 `ui-settings-archive` / `session-archive`
  "entry not found"(npm rc.6 base 无这两个 id,disable 行为 no-op,不影响启动);
  5 个插件包 add 时的 "declares no dsh.bundle" 警告亦为预期(只有 bundle 是
  profile 层)。
- 顺带:profile 里五个指向已删 junction 的孤儿链接已清理;桌面残留的
  build-log/build-done 临时文件已删。

## 2026-08-19 会话:dsh 升级 rc.7 + 安装 dshmarket 插件市场

用户要装插件市场插件(dshmarket)。其 peer 依赖 `@deepseek-ai/dsh-settings@^0.1.0-rc.7`,
而全局 dsh 是 rc.6 → 直接 `npm i -g @deepseek-ai/dsh@latest` 升到 rc.7(插件包 peer
`^0.1.0-rc.6` 的 semver 范围涵盖 rc.7,插件零改动)。

- **dshmarket 安装**:`dsh plugin --profile web add dshmarket` 默认解析到 1.13.1——
  pnpm 的 `minimumReleaseAge` 供应链策略排除了当天发布的 1.15.0;显式
  `add dshmarket@1.15.0`(自动写入 minimumReleaseAgeExclude 豁免)后落到 1.15.0。
- **rc.7 下回归验证**(插件工作区依赖仍是 rc.6,双版本并存,与此前结构相同):
  - `dsh --profile web --dump-config`:dshmarket `dsh-market` 行 + 全部 5 个
    rollback 插件行装配 ✓
  - `dsh web` 启动 HTTP 200、日志干净 ✓;rollback 两个客户端包 200
    (153KB/178KB,与 rc.6 启动时逐字节同尺寸)✓;dshmarket client.js 200(299KB)✓
  - 说明:仅启动级验证;rc.7 下的完整回滚功能链路未重跑(需 API key 真实会话)。
- **发现**:profile node_modules 里有一个悬空 `dsh` junction(指向已删的旧源码树
  位置 `Desktop\dsh`),无害残留——核心 @deepseek-ai/* 包解析走全局 dsh 安装,
  不经 profile;此前 rc.6 下能正常启动也印证了这点。
- README 前置条件更新为 dsh `0.1.0-rc.6` / `0.1.0-rc.7`。

## 2026-08-19 会话:归档任务导航图标改为插件侧修补(修复 npm dsh 下回退齿轮)

用户报告:归档任务图标在 npm 版 dsh(rc.6→rc.7)下又变回设置齿轮。根因:NAV_ICONS
修复(`b4b7072`)做在 fork 主树,只有从源码树启动才生效;npm 安装的 dsh 用上游
`SettingsRoot`,其 `navIcon(id)` 仍是硬编码 if-chain(models / agent-presets /
plugins 之外全 fallback 齿轮),而 `settings.section` 注册接口没有 icon 字段
——插件无法通过注册声明图标。

**实现(client-rollback-settings,新增 `src/client/navIconPatch.tsx`)**:
浏览器端 MutationObserver 修补——设置面板挂载/重渲染后,按 label 文本匹配本插件
的 nav 行,把 `IconArchiveOutline20`(宿主模块表 external)渲染出的 svg 克隆插到
齿轮前,齿轮 `display:none` 保留(节点不删)。**关键教训:React 管理的子树里
不能用 replaceWith 删节点**——v1 直接替换齿轮,实测把该行 label 破坏成空字符串
(React diff 假设失效);v2 只隐藏+插入外来节点,React diff 不碰,label 正常。
locale 变化由 observer 幂等重扫覆盖(`data-nav-icon` 标记防重复)。

- 依赖:`@deepseek-ai/dsh-client-ui-primitives` 补进 peer/dev(externals 表已有);
  `@types/react-dom` 补 dev;`react-dom/client` + `flushSync`(模板同步渲染)。
- **验证**(npm dsh rc.7 + dshmarket 1.15.0 共存环境):puppeteer 打开设置面板,
  6 行 nav 中仅"归档任务"行 `data-nav-icon=dshArchiveNavIcon`、label 完好、
  克隆 svg 带 navIcon class;通用/模型/插件/Agent 预设/插件市场行未受影响。
- 新增测试 `tests/navIconPatch.client.spec.tsx`(4 例:匹配行才修/幂等/后挂载
  行由 observer 补上/无匹配不动);primitives 在测试里 mock(其入口 import
  katex CSS,node 加载不了)。settings 包 10/10,typecheck/构建通过。
- **已知环境问题(非本次改动)**:rollback-undo 的 4 个真实 git 测试
  (shadow-git×2、update×2)本机稳定超时 30s + EBUSY——stash 对照实验证明与
  本次改动无关(不 stash 同样失败);Defender/索引器锁 Temp 目录所致,CI
  (ubuntu/macos/windows 隔离环境)为准。

## 2026-08-19 会话:工具卡片按工具类型着色(client-rollback-toolcards)

用户报告:从 dsh 主树源码切到 npm rc.7 后,会话里工具调用的「推理行动
折叠条」与「工具专属配色卡片」两个表现消失。

**诊断(先于修复,结论与任务描述的猜测不同)**:
- 折叠条**并未丢失**。rc.7 的 `@deepseek-ai/dsh-client-ui-tool` 完整实现
  折叠条(GenericToolCard/ToolRow + DisclosureRow、keyed BashRow),禁缓存
  加载历史会话实测 5 条工具行全部渲染、可展开——用户看到的缺失只是
  浏览器缓存/旧页面层面的假象,无需修补装配。
- 真正缺失的是**工具专属配色**:rc.7 的 ui-tool CSS 只有统一
  `--dsw-alias-*` 主题变量,所有卡片(terminal/diff/read/search/web/code)
  一律 `var(--dsw-alias-markdown-code-block)`(浅色主题下
  `rgb(249,250,251)`)。主树曾有「bash 终端卡恒黑」
  (bash-sample.module.css 作用域 token 覆盖,2026-08-17 会话),该改动
  未进 npm 发布——这正是用户记忆中「bash 黑底」的来源。
- rc.7 渲染器已发布稳定 DOM 钩子(非哈希类名),CSS 注入完全可行:
  通用行根 `[data-tool]` + 卡片 `[data-terminal]`/`[data-diff]`/
  `[data-read]`/`[data-search]`/`[data-web]`/`.md-code-block`(CodeBlock
  的字面量 marker class);keyed BashRow 行根 `[data-sample="bash"]`,
  展开体是它的**下一个兄弟**(`+ div > div`,card 包裹层内 row 与 body
  是兄弟,不能写后代选择器);pwsh 标题存在(`TOOL_TITLES.pwsh`)但
  **没有 keyed 行**,落 GenericToolCard 路径(`data-tool="pwsh"`)。

**实现(纯插件侧,零运行时代码)**:
- 新包 `packages/client-rollback-toolcards`:单文件 CSS
  (`src/client/toolcards.module.css`)+ 空 apply。构建链把它编译成
  `lib/client.js`(`__ModuleLoader__.load` 闭包),import 即注入
  `<style data-plugin="@dsh-rollback/client-rollback-toolcards">`;每条规则
  只用 data 属性钩子,specificity(≥0,2,0)压过宿主哈希单类规则,
  React 重渲染由层叠自动覆盖——不需要 MutationObserver。
- 两种着色策略:**外壳型**(bash/pwsh)把卡片元素的
  `--dsw-alias-markdown-code-block/label-*/border-*` 自定义属性整体改指
  静态深色值 + `background` 钉死(bash `#0d1117` GitHub 暗色黑、pwsh
  `#012456` PowerShell 窗口蓝),亮暗主题下都保持深色、后代文字/横幅/
  复制按钮全部跟随;**浅染型**(其余工具)用
  `color-mix(in srgb, <hue> 10~12%, var(--dsw-alias-markdown-code-block))`
  在当前主题色上叠色(edit/write 绿 #2da44e、read 紫 #8957e5 且 banner
  加深、grep/glob 蓝 #4493f8 且 header 加深、web 青 #12a5b0、run_code
  琥珀 #d29922)。
- **css-modules 哈希陷阱**:`.md-code-block` 会被 lightningcss 当模块局部
  类哈希成 `.x_md-code-block` 而永不匹配 DOM——必须写
  `:global(.md-code-block)`;测试有守卫(选择器不得出现哈希模式/裸类)。
- 接线:bundle patch 插入 `client-rollback-toolcards` 行 + 依赖清单;
  pnpm-workspace overrides、tsconfig.client references、README 中英
  (安装命令改为七个包)同步。

**验证(npm rc.7 + dshmarket 1.15.0,带 DEEPSEEK_API_KEY 真实会话)**:
- 装配:`dsh plugin --profile web add <包>` 后 dump-config 出现该行;
  `__DSH_BOOT__.entries` 含 id 且 `/plugins/.../client.js` 200(3KB)。
- 历史会话(禁缓存加载):pwsh terminal 卡 `rgb(1,36,86)`(#012456)、
  read 紫、glob 蓝、write diff 绿全部生效;合成 DOM 验证 BashRow 选择器
  → `rgb(13,17,23)`(#0d1117)与 `--dsw-alias-label-primary:#e6edf3`。
- 真实新会话(一条 prompt 触发 pwsh/write/read/glob 四工具):4 条折叠
  条全部渲染、展开后卡片底色分别为蓝/绿/紫/浅蓝,plugin style tag 在。
- 回归:同会话头部回滚按钮正常(回滚链路不受影响);rollback 两个
  client 包、dshmarket 装配未动;42 单测通过(新增 toolcards 7 例;
  4 例已知环境失败同上节)。
- 新增脚本:`scripts/e2e-toolcards.mjs`(历史会话扫描+合成 bash 验证)、
  `scripts/e2e-toolcards-live.mjs`(真实会话四工具触发,需服务端带 key)。

**注意**:服务的 API key 只经环境变量注入启动,未写入任何文件;e2e 产生
的 `toolcards-e2e.txt` 已清理,live 会话留在「dsh 回滚」工作区供肉眼复核
(侧边栏「PowerShell目录文件操作任务」)。

## 2026-08-19 会话:Edge 验证 + 推理行动折叠条 + 全部删除按钮圆角 + trailfold 包

用户在 Edge 打开验证,报告「折叠条没有出现」,问是否缓存、能否做到任何
情况都显示;并要求「全部删除」按钮去掉棱角、符合 dsh 圆角风格;完成后
推送 GitHub。

**Edge 诊断(结论:不是代码 bug)**:
- 全新 Edge 配置(无缓存)在 `127.0.0.1:3080` 与 `localhost:3080` 两个源
  下,历史会话的 4 条工具折叠行全部渲染、可展开、零控制台错误——渲染
  路径完好。
- `index.html` 响应**没有任何缓存头**(无 Cache-Control/ETag/Last-Modified)
  → Edge 对其做启发式缓存,旧标签页/旧缓存壳会拿旧 boot manifest
  (旧插件集、旧资源)——「是缓存问题」成立,Ctrl+Shift+R 或重开标签即恢复。
  这是 dsh 宿主响应头问题,插件侧不可代修(不改本体)。
- 但「任何情况均能显示」指向一个真实缺口:rc.7 只有**每条工具调用**的
  折叠行,没有主树时代的**每回合「推理与行动」一级折叠**(整段思考+叙述
  +工具收起/展开)。纯文本/纯思考回合在 rc.7 下没有任何折叠条。

**rc.7 消息流 DOM 契约(实现基础,Edge 实测)**:消息流容器
`[data-chat-flow]`,每个子节点带 `data-chat-flow-kind`(user / context /
assistant-step / tool-call / turn-tail)与稳定 `data-chat-flow-key`。回合边界
清晰:user 开回合 → trail(context 注入、Think/叙述 step、tool-call)→
最后一个 assistant-step(tail 前锚定 = 结论)→ turn-tail(产物+统计)。
Think 思考行 rc.7 确实渲染(Sxvs8a_root)。

**实现一:client-rollback-trailfold(新包,8 号包)**
- `planTurns` 纯规划器:user 锚定回合;closedByTail 且尾元素是
  assistant-step 才有结论(trail = 结论之外的全部);被下一 user 抛弃的
  回合视为无结论(不折叠,错误可见);flow 末尾无 tail = running。
- `mountTrailFold` DOM 补丁:外来折叠条插在 trail[0] 前(控制位恒居轨迹
  上方);折叠 = 逐 flowItem `style.display='none'`(DOM 保留,React 安全,
  与主树策略一致);MutationObserver 全量幂等重扫(React 重渲染/虚拟化
  重挂载/会话切换自愈);按 user key 记忆状态。
- 行为对齐主树:运行中显示「运行中…」保持展开;回合闭合且视图钉在底部
  (`[data-conversation-scroll]` 距底 <80px)时自动收起,用户上滚阅读时不
  收;历史首见保持展开;手动点击随时覆盖;无结论/空 trail 无条。
- **两个深坑**:① `sync()` 无条件重写 `counts.textContent` 会替换文本节点
  → 触发自己的 observer → 无限循环(vitest 挂死定位)——只在值变化时写;
  ② 测试里 planner 组遗留的 flow 也会被(正确地)挂条,`document.querySelector`
  命中别人的 bar——文件级 afterEach 清 body。

**实现二:全部删除按钮圆角**
- 根因:`.bulk` 容器在 CSS 里**完全没有规则**(TSX 用了、CSS 没写),
  「全部删除/确认/取消」回落浏览器默认样式(灰底直角 outset 边框)。
- 修复:补 `.bulk` 布局 + `.bulk button` 共用既有 dsh 配方
  (28px 高、`border-radius:14px` 胶囊、12px 字号,与 `.actions button`
  及 dsh `_sm` Button 同款)+ `.bulk .danger` 红色变体。
- **构建坑再现(HANDOFF 前科)**:根目录 `pnpm run build` 对 settings 的
  client 产物未重写(mtime 不动,`_bulk` 不进 bundle);在包目录内直跑
  `pnpm exec tsdown --env.DSH_BUILD_FACE client` 立即正确。改 CSS 后要在
  包内重建或核对产物含新规则。CI 全新环境无此缓存问题。

**验证(Edge 实测,服务带 key)**:
- 折叠条:历史回合条在且展开(「推理与行动 2 思考 · 4 工具」);手动收放
  trail 隐藏/恢复、结论与统计行不动;新回合流式时「运行中…」,闭合后
  (视图在底)自动收起为「1 工具」;恢复出的会话 4 条 bar 全部正常。
- 配色回归:pwsh 蓝 rgb(1,36,86)×3、read 紫、glob 浅蓝 ✓。
- 全部删除:`border-radius:14px`、高 28px、danger 红、12px 字号;确认/
  取消同款 ✓(回滚→归档→撤回流程顺带回归:回滚/撤回/恢复链路正常)。
- 测试:11 文件 53 用例通过(trailfold 9 + 归档样式契约 2 新增);
  4 例已知环境失败不变。
- 新增脚本:`scripts/edge-verify.mjs`(折叠条+配色+自动收起)、
  `scripts/edge-verify-archive.mjs`(回滚→按钮样式→撤回);一次性诊断
  脚本已清理。

## 2026-08-20 会话:消息操作行回滚按钮(client-rollback-button 扩展)

用户报告:「之前设置的 message actions 消息操作按钮:回滚又消失了」,
要求恢复并采用与回车键一致的图标。

**消失原因**:消息级回滚按钮(合格用户消息 Copy 旁)是主树
`ui-conversation-undo` 的实现,主树源码删除切到 npm rc.7 后自然消失;
插件侧从未有过(rc.7 **没有用户消息级 slot**——MessageIconActions 的
extraActions 只在 turn-tail 暴露 `conversation.chat.assistant-actions`,
UserMessageNodeView 不传)。插件此前用会话头部按钮替代。

**实现(messageActionsPatch.ts,DOM 补丁,navIconPatch 模式)**:
- **精确匹配**:rc.7 聊天流每节点发布 `data-chat-flow-kind` +
  `data-chat-flow-key`,用户消息 key 的 `input-message<uuid>` 尾部**就是
  durable message id**(conversation assembler `match: id:
  String(event.data.id)` = journal `messageId: message.id`,实测两轮 live
  发消息验证一致)。`key.endsWith(controller.view.value.messageId)` 唯一
  命中回滚点指向的消息——按钮只在那条消息的操作行,随回滚点移动。
- **按钮形态**:操作行末尾(复制按钮后)的外来 icon button,28px 圆形
  (MessageIconActions 同款 recipe);`MutationObserver(childList)` +
  sessions list 订阅(current/running)+ controller 视图订阅共同驱动幂等
  rescan,React 重渲染/虚拟化/会话切换自愈;运行中与 pending 禁用;
  点击走与头部按钮相同的 undo 流(controller.undo → sessions.open)。
- **图标(用户要求「与回车键一样」)**:composer 发送键是
  ui-conversation 的**内联 SVG**(非 primitives 导出;其 IconSendOutline16
  副本坐标与内联版差第 3-4 位小数)——补丁内联了 composer 的精确路径
  `M8.3125 0.980183C…`,Edge 实测 `iconMatchesComposer: true`(逐字节
  相同)。图标纯 DOM 构造,无 React/primitives 依赖。
- **坑**:① `dataset[dshRollback…]` 写出 kebab-case 属性,选择器若用
  camelCase 永远匹配不到已有按钮 → 每次扫描重复插入(测试暴露);必须
  显式 `data-dsh-rollback-message-action` 字面量。② 侧边栏行文本带时效
  后缀("xx分钟"),按标题 includes 点击会随时间漂移——e2e 用稳定字面量
  ('4242')定位。

**验证(Edge,服务带 key,真实会话)**:
- 按钮出现在合格消息操作行(复制后、行末),aria/title 与头部按钮一致,
  图标路径与 composer 发送键逐字节相同;另一条用户消息无按钮。
- 点击 → 回滚成功导航 child 会话,「↩ 已回滚…撤回回滚」折叠条出现;
  撤回 → 恢复导航 restored 会话,消息按钮、头部按钮、trailfold 折叠条
  全部在位(全功能回归)。
- 测试 12 文件 61 用例通过(新增 messageActionsPatch 8 例:插入/无点
  无按钮/运行禁用/随点移动/点击调用/重挂载自愈/销毁清理/图标逐字节契约);
  typecheck/build 通过;已知环境失败(shadow-git Defender 锁)不变。
- 新增脚本:`scripts/edge-verify-messageactions.mjs`(完整 e2e)。

**回滚入口现为四个**:消息操作行图标按钮(回车键图标)、会话头部按钮、
`/undo` 命令、输入框上方撤回折叠条。

## 2026-08-20 会话:回滚/撤回回滚变慢排查(根因:机器级进程创建开销,非代码)

用户报告:回滚与撤回回滚速度变慢,"之前优化过,现在又回到原来了"。

**排查过程(先证伪代码回归,再实测定位)**:
1. 优化代码齐全:`src` 与 `lib`(statWarmer/prearm/untrackedCache/
   splitIndex/路径限定 restore/diff-tree)全部在位,lib mtime 新——代码
   无回归。
2. 计时 e2e(100ms 轮询):回滚 4359ms、撤回 4138ms(此前最优 1169/653)。
3. 相位分解:live 会话工作区是 `Desktop\对话`(**仅 6 个跟踪文件**),
   却连 `git ls-files` 都要 1790ms——问题不在仓库大小,在**每次 git
   spawn 本身**。
4. spawn 隔离实验:`git --version` ~1.5-2s、`node -e ""` ~1s、
   `cmd /c echo` ~1s(PowerShell 原生同样慢)→ **机器级进程创建开销**,
   每进程 +0.5~1.5s。回滚一次 ~6 个 git spawn ≈ 4s,与实测吻合。
5. 系统排查:CPU 仅 18%;SecurityCenter2 注册了 Kaspersky+Defender+
   McAfee 三家(Defender 已被禁用,0x800106ba);发现可疑进程
   **DocUpdate(隐藏路径、svchost 拉起、累计 CPU 4600+ 秒)**。
6. **A/B 实验**:`Stop-Process DocUpdate` 后 `git --version` 1500ms→
   **48ms**(30 倍),`node -e` → 53ms——**真凶就是 DocUpdate**,不是
   Kaspersky。

**根因**:迅读PDF(`C:\Program Files (x86)\MasterPDF\`)的
`DocUpdate.exe` 干扰全机进程创建;其自启服务 `DocService`(Auto,
Running)负责拉起。2026-08-19 起的「4 个 shadow-git/update 测试稳定
超时 30s + EBUSY」同根因(此前记为 Defender 锁,实际是它)。

**处置**:
- 已杀 DocUpdate 进程(未复活);停/禁 DocService 服务需管理员权限,
  当前 shell 无权(拒绝访问)——**用户需手动**(管理员 PowerShell:
  `Stop-Service DocService; Set-Service DocService -StartupType Disabled`,
  或直接用其 Uninstall.exe 卸载迅读PDF;Defender 处于禁用状态也建议
  重新开启排查)。
- 杀掉后实测:**回滚 430ms、撤回 332ms、再回滚 432ms、再撤回 344ms**
  (超过历史最优);全量测试 **12 文件 65 用例全部通过**(此前 4 例
  "环境失败"消失)。

**工具沉淀**:`scripts/edge-timing.mjs`(回滚/撤回计时 e2e)、
`scripts/timing-spawn.mjs`(机器健康检查:spawn 是否又变慢)。
**经验**:机器整体变慢(git/测试/e2e 同时劣化)时,先测
`timing-spawn.mjs` 排除第三方进程干扰,再怀疑代码。
