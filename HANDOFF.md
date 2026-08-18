# dsh-rollback-plugin 交接文档

> 独立 dsh 插件项目(会话回滚 + 归档任务)的实施交接。原仓库内方案
> (`dsh 回滚/` 工作树)方向已废弃;本目录是重新定位后的成品。
> 与 `dsh-rollback-plugin/PLAN.md`(评审蓝图)配套阅读。

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
