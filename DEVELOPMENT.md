# DEVELOPMENT.md — dsh-trail-plugin 开发上下文（会话交接用）

> 本文件把 2026-08-16 的开发对话中后续开发所需信息浓缩于此。
> 代码变更历史见 git log（`b32e2ba` 起，里程碑：skeleton → M1 数据链路 → M2 摘要 → M4 谱系）。
> 详细设计见 `DESIGN.md`（Session Tree / History Index 插件）。

## 1. 当前状态

- **已完成**：骨架、挂载验证、M1（投影数据链路）、M2（规则摘要）、M3（fork 续写）、M4（谱系角标/下拉，节点中心索引）、**真左栏 Spike**（`feature/left-column`：shell.overlay 浮动列 + 内容让位 + 当前会话节点列表 + 折叠，60 测试全绿）。
- **待办**：左栏交互补全（点击行内跳转 → fork 续写 → 谱系角标迁移 → 拖宽/记忆 → 窄屏自动折叠）、M5（二级完整路径）、行间跳转/续写 UI。
- **验证约定**：client bundle 的 rev = 文件 sha1 前 12 位；**实测 web 服务器按请求实时计算 manifest**（`pnpm build` 后浏览器刷新即可见，无需重启 GUI——旧记录"重启才进 boot manifest"已过时）。
- 环境：DSH 源码在 `/app`（只读参考，禁止修改）；`DSH_HOME=/data/dsh-home`；GUI 在 `127.0.0.1:3080`；dsh CLI 用 `node /app/apps/cli/lib/bin.js`。

## 2. 架构决策（含理由，勿轻易推翻）

| 决策 | 理由 |
| --- | --- |
| **投影缓存承载节点树**（非自建存储） | 事件驱动折叠、checkpoint、冷读、schema 校验、生命周期、client `useProjection` 通道全部官方托管；落盘 `$DSH_HOME/storages/session_projcache.json`（该文件已在跑 14 个投影 key，28 会话约 127KB）；写合并 200 事件/5s + turn/end + 会话关闭；`stateVersion` 不匹配自动重算。**host 零改动约束**：一切派生数据只从官方已下发数据计算 |
| **fork 边界 = turn/end 事件 seq** | `sessions.fork` 校验 boundary 必须是连续事件 seq 且前缀不能停在未闭合 turn（`OPEN_TURN` 报错）——turn/end seq 天然安全 |
| **nodeKey = `(rootId, boundarySeq)`** | 结构身份：fork 深拷贝保留事件 seq，同一逻辑节点在整棵 fork 树内 seq 唯一且位置对齐；rootId（沿官方 parentId 上溯）消除无关树之间的 seq 命名空间碰撞。**匹配键必须用结构身份，不能用内容**（内容相同是巧合信号，会假阳性） |
| **角标 = 共享该逻辑节点的全部会话**（排除自身） | 用户明确口径：如 A→B→C→D / A→B→F / A→B→C→G 中，会话 1 的节点 B 应显示分叉 2（会话 0 与 2），祖先/兄弟/后代都计入。节点中心索引桶成员即全部共享会话 |
| **挂载在 `conversation.view`（tab）→ 真左栏挂 `shell.overlay`** | 早期因"替换 session 体要继承草稿镜像 + 视图环职责、tab 选中态在内部 chatStore"搁置左栏；2026-08-17 研究确认槽位机制硬墙：子槽位声明排他（重复声明 register throw）+ chatStore/views 账本私有 + 无 renderSlot 授权 = 替换 = 重写聊天渲染。**改用 `shell.overlay` 浮动列**（list 槽、replaceRisk none、唯一可覆盖会话列的可加性座位），内容让位 = 会话列根元素 padding-left；tab 保留作对比，稳定后移除 |
| **行内跳转走官方 DOM 锚点（左栏后续迭代）** | 聊天行自带 `data-chat-anchor-key`（= 会话快照节点 key），滚动容器 `[data-conversation-scroll]`；历史节点 → 聊天节点映射用 `ctx.sessions.binding(id).session`（ObservableSnapshot\<ConversationSnapshot\>）按 turn/anchorSeq 对齐 |
| **client 半区用 esbuild 打自定义 loader bundle** | DSH 静态插件 client 包必须产出 `window.__ModuleLoader__.load({id, factory(require)})`；esbuild 内联所有源码模块，external 只留平台模块（react、@deepseek-ai/cordis 等）由浏览器模块表解析。**zod 只在 host 侧**（`src/history/schema.ts`），client 严禁 import（会打进 bundle） |
| **不用 host.call / harness.handle** | 那是**动态插件专用** RPC（静态 bundle 无此通道）；静态插件跨平面数据走 client 投影 / Remote（$mount + typert 生成产物，较重，已避免） |

## 3. 已验证的官方机制（事实清单）

- **投影**：`ctx.sessionProjections.register({key, schema, init, apply, view, stateVersion})`——`apply` 纯同步增量折叠，无关事件必须返回同一 state 引用；state 须 plain JSON；注册是 effect，卸载即消失。`sessionProjectionCache` 开 `session_projcache` 域；冷读阶梯 `cachedSnapshot`(零 I/O) → `coldSnapshot`(缓存行+尾部重放)。
- **client 读取**：`useProjection('history')`（标准 props）；`undefined` = 能力缺失。会话列表 `useSessions` 每行带 `parentId`（= header.parentSession，fork 父）与 `projectionValues.history`（该会话节点树）——**wire 上 projections.values 是 `z.record(string, unknown)` 开放 map，外部包新 key 原样通过**。这是 M4 纯 client 谱系的数据基础。
- **fork**：client `sessions.fork({sessionId, atSeq, increaseTitle})` → host `sessions.fork`，boundary=seq，seed=前缀拷贝；`sessions.open(childId)` 切换。
- **槽位**：`conversation.view` 是 list、可添加（replaceRisk none），注册 `{name, id, order, label}` + 组件；标准 props 含 `useSessions/useProjection/sessionId`。client slots 服务经 `ctx.get('slots')`（slots.inject + slots.register）。
- **挂载**：`dsh plugin --profile <name> add <路径>`（pnpm link 进 profile）；组合行写 `$DSH_HOME/profiles/<name>/cordis.patch.yml`（`- id / name / config`）；Loader 以 profile 目录为 baseUrl；client 半区经 package.json `dsh.client {platform:'web'}` + `exports["./client"]` 进浏览器 roster，URL `/plugins/@deepseek-ai/<包名>/client.js?rev=…`。
- **client bundle 契约**：`window.__ModuleLoader__.load({id: 包名, factory(require)})`；factory 返回 `{name, apply}`；模块表含 react / @deepseek-ai/cordis / @deepseek-ai/dsh-client-ui-slots 等。

## 4. 验证配方

```bash
pnpm verify                        # typecheck + vitest + build（build 含 esbuild 打 client bundle）
DSH_BIN='node /app/apps/cli/lib/bin.js' ./scripts/smoke.sh   # 起 trail-test profile 断言 hello world
# 直接查运行中 host 的会话列表（含每会话投影与 fork 父）：
curl -s -X POST http://127.0.0.1:3080/api/session.list -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"p","method":"session.list","payload":{}}'
# 模拟浏览器执行 bundle（fake __ModuleLoader__ + fake React/useState/useProjection/useSessions）
# 验证浏览器拿到新 bundle：curl / 看 __DSH_BOOT__ 里 rev == sha1(lib/client.js).slice(0,12)
```

## 5. 踩坑记录

- **BRE grep**：`\(` 是分组符不是字面括号；固定串用 `grep -F`。
- **tsc 产物保留 JSDoc**：旧 build-client 靠 `export default ` 标记切片（现已被 esbuild 取代）。
- **pnpm 11** 首次装 esbuild 自动生成 `pnpm-workspace.yaml` 的 `allowBuilds` 占位，需显式 `esbuild: true`。
- **测试不参与 typecheck**（tsconfig 只 include src），vitest 只转译不查类型——`pnpm verify` 的 typecheck 步骤不可省。
- **审批已禁用**：动态插件（cordis_define/cordis_run）的 client 授权会被自动拒绝，验证别走动态插件路径。
- 当前会话若无后代（例如是 fork 叶子），角标为 0 是**正确行为**；验证角标要切到有 fork 子会话的会话（可先用上面 curl 找 `parentSessionId` 反指某会话的行）。

## 6. 代码结构约定

- host：`src/index.ts`（注册投影单元，`stateVersion=2`）；client：`src/client.ts`（default-export factory(require)）。
- 纯逻辑层 `src/history/`：`types.ts`（节点类型）、`text.ts`（摘要/文本工具）、`summarize.ts`（整句规则摘要）、`fold.ts`（事件折叠 reducer）、`schema.ts`（zod，host-only）、`lineage.ts`（isDescendantOf / sharedPrefixLength）、`index.ts`（节点中心索引：rootOf / buildHistoryIndex / lineageForNode）。
- 测试 `tests/*.test.ts`，import `../src/*.js`；bundle 安全（client 不 import zod、不 import node 内置）。

## 7. 下一步（按数据就绪度）

1. **左栏交互补全**（`feature/left-column`，Spike 已完成骨架）：
   a. 点击节点行内跳转：历史节点 → 会话快照（`sessions.binding(id).session`）按 turn/anchorSeq 映射聊天节点 key → `[data-chat-anchor-key]` 行 `scrollIntoView`；未加载窗口先提示/`loadOlder`。
   b. fork 续写入口迁移到左栏行（现有 `sessions.fork + open` 逻辑）。
   c. 谱系角标/下拉迁移（M4 的节点中心索引在 root scope 直接用 `useSessions` 全量会话列表即可）。
   d. 拖宽（handle 参照 AppFrame 的 pointer capture + rAF 模式）+ localStorage 记忆 + 窄屏自动折叠。
2. **旧 tab 去留**：左栏稳定后移除 `conversation.view` 注册（或加配置项 A/B）。
3. **M5 二级完整路径**：数据已全在 client（每会话完整节点路径），基本是 UI。
