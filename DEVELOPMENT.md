# DEVELOPMENT.md — dsh-trail-plugin 开发上下文（会话交接用）

> 本文件浓缩 2026-08-16（M1–M4 数据链路）+ 2026-08-17（真左栏 feature/left-column）两轮
> 开发对话的后续开发所需信息。
> 代码变更历史见 git log（`b32e2ba` 起，里程碑：skeleton → M1–M4 → 左栏 spike/拖宽/跳转/渲染协调）。
> 详细设计见 `DESIGN.md`（Session Tree / History Index 插件）。

## 1. 当前状态

- **已完成**：骨架、挂载验证、M1–M4、**真左栏**（`feature/left-column` 已合并回 main：shell.overlay 浮动列 + 内容让位 + 节点列表 + 折叠竖条（☰历史，可发现性）+ 拖拽调宽/记忆（240–480、聊天保 480、双击复位 280、localStorage）+ 点击行内跳转（含 loadOlder 分页兜底）+ **渲染协调修复**），81 测试全绿；`feature/left-column-interactions`（左栏交互补全：行尾「续写」按钮 hover 显现 + fork/open；**分叉交互重构**——行首分叉数字（hover 变官方 chevron）点击展开，展开体为**行下方 column 兄弟**（复刻官方 DisclosureRow 骨架），复用官方 `@deepseek-ai/dsh-client-ui-primitives` 的 chevron 元素；**行精简**——每节点单行标题（删 meta 与 kind emoji）+ hover 高亮，续写按钮改官方 pill 风格；**分支列表同款风格**——展开体内分支行与节点行同款单行样式 + hover 高亮，**只显示叶子摘要**（fork 标题多为「旧标题+数字后缀」无辨识度），无「切换」按钮、整行点击直接 `sessions.open` 跳转；**跳转缓冲指示**——点击节点跳转（尤其 loadOlder 翻页耗时）时，被点击行行尾显示官方 `IconLoadingOutline16` 旋转圆环（注入 style 标签定义 @keyframes），跳转结束/失败自动清除，jumpGenRef 世代守卫保证只由最新跳转清除），91 测试全绿。
- **待办**：① **host 侧补齐缺 history 的投影缓存**（25/45 会话缺，见 §3 机制与 §7 方案，需重启 GUI）；② 左栏交互补全剩 **窄屏自动折叠**（阈值触发，拖拽钳制已就位）+ 跳转高亮 polish；③ 旧 tab 去留；④ M5 二级完整路径。
- **验证约定**：client bundle 的 rev = 文件 sha1 前 12 位；**实测 web 服务器按请求实时计算 manifest**（`pnpm build` 后浏览器刷新即可见，无需重启 GUI——旧记录"重启才进 boot manifest"已过时）。host 侧（src/index.ts）改动仍需重启 GUI 生效。
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
| **左栏几何必须实时查询节点（渲染协调）** | `conversation` 槽位是 session-maybe：会话切换时内容按 `epoch` 重挂载（DOM 节点被替换）。若 layout effect 闭包缓存 convRoot/panel 引用 → 切换后指向 detached 节点 → RO 永不触发、`getBoundingClientRect` 全 0 → 面板钉死 (0,0)/0 高（表现：切走切回左栏消失、关侧栏竖条不回位）。**必须**：effect deps 含 current（切换即重跑）、每次 applyLayout/漂移轮询实时 `closest/querySelector`、cleanup 实时清理 |
| **历史投影对"注册前已沉睡"的旧会话缺失** | history 投影 2026-08-16 注册；此前存在且之后从未打开的会话，checkpoint 从未写 history 缓存行 → 列表行投影无 history（实测 45 会话仅 20 有）。会话**打开**会走 coldSnapshot（缓存行+尾部重放）补齐并写回。列表行投影来源：live 会话 = `sessionProjections.snapshot(session)`（实时），cold 会话 = `sessionProjectionCache.cachedSnapshot(meta)`（只读缓存行） |
| **client 半区用 esbuild 打自定义 loader bundle** | DSH 静态插件 client 包必须产出 `window.__ModuleLoader__.load({id, factory(require)})`；esbuild 内联所有源码模块，external 只留平台模块（react、@deepseek-ai/cordis、**@deepseek-ai/dsh-client-ui-primitives** 等）由浏览器模块表解析（清单见 `/app/packages/client/web/src/platform.ts` 的 PLATFORM_MODULES）。**zod 只在 host 侧**（`src/history/schema.ts`），client 严禁 import（会打进 bundle）。**官方模块复用走 `require('@deepseek-ai/dsh-client-ui-primitives')` + 本地最小类型**（本地 node_modules 无此包，import 语句会让 tsc 解析失败） |
| **分叉展开结构 = 行下方 column 兄弟（对齐官方 DisclosureRow）** | 展开体若作行内 flex item 会被横向挤压、撑高整行（曾现 bug：标题被挤占、胶囊被挤到中间）。官方 DisclosureRow 骨架：root column = [行, 展开体]，展开体是行下方兄弟、不参与行内 flex、行高恒定。**不复用 DisclosureRow 组件本体**：① 行点击模型冲突（官方整行点击=展开，我们=跳转，且其无行点击自定义入口）；② 官方 `.row` 固定 24px 行高（CSS module 无覆盖入口），放不下我们的摘要+meta 两行。**复用官方 chevron 元素**（`IconChevronDownOutline14`，模块表 external），hover/展开时行首数字变 chevron（v 型提示），交互语义与官方 tool 行一致 |
| **不用 host.call / harness.handle** | 那是**动态插件专用** RPC（静态 bundle 无此通道）；静态插件跨平面数据走 client 投影 / Remote（$mount + typert 生成产物，较重，已避免） |

## 3. 已验证的官方机制（事实清单）

- **投影**：`ctx.sessionProjections.register({key, schema, init, apply, view, stateVersion})`——`apply` 纯同步增量折叠，无关事件必须返回同一 state 引用；state 须 plain JSON；注册是 effect，卸载即消失。`sessionProjectionCache` 开 `session_projcache` 域；冷读阶梯 `cachedSnapshot`(零 I/O) → `coldSnapshot`(缓存行+尾部重放)。
- **client 读取**：`useProjection('history')`（标准 props）；`undefined` = 能力缺失。会话列表 `useSessions` 每行带 `parentId`（= header.parentSession，fork 父）与 `projectionValues.history`（该会话节点树）——**wire 上 projections.values 是 `z.record(string, unknown)` 开放 map，外部包新 key 原样通过**。这是 M4 纯 client 谱系的数据基础。
- **fork**：client `sessions.fork({sessionId, atSeq, increaseTitle})` → host `sessions.fork`，boundary=seq，seed=前缀拷贝；`sessions.open(childId)` 切换。
- **槽位**：`conversation.view` 是 list、可添加（replaceRisk none），注册 `{name, id, order, label}` + 组件；标准 props 含 `useSessions/useProjection/sessionId`。client slots 服务经 `ctx.get('slots')`（slots.inject + slots.register）。
- **挂载**：`dsh plugin --profile <name> add <路径>`（pnpm link 进 profile）；组合行写 `$DSH_HOME/profiles/<name>/cordis.patch.yml`（`- id / name / config`）；Loader 以 profile 目录为 baseUrl；client 半区经 package.json `dsh.client {platform:'web'}` + `exports["./client"]` 进浏览器 roster，URL `/plugins/@deepseek-ai/<包名>/client.js?rev=…`。
- **client bundle 契约**：`window.__ModuleLoader__.load({id: 包名, factory(require)})`；factory 返回 `{name, apply}`；模块表含 react / @deepseek-ai/cordis / @deepseek-ai/dsh-client-ui-slots 等。
- **会话快照访问（跳转/分页用）**：`ctx.sessions.binding(id)?.session` = `SessionFace` = `ISession & ObservableSnapshot<ConversationSnapshot>`。`loadOlder()` 是 **ISession 动词**（无需 scope().get('conversation')）；每页 `PAGE_MESSAGES=50` 条，守卫 `openState==='open' && hasMore && !loadingOlder`（不满足时静默 no-op），prepend 后快照同步更新。快照结构：`chat.nodes`（ChatNodeStore：`get(key)`/`values()`）、`chat.order`、`hasMore`、`loadingOlder`、`openState`；聊天节点 `location` = `{kind:'turn'|'step', turn: TurnLocation}`（turn 号与历史节点对齐，fork 前缀拷贝保留）。
- **DOM 锚点（跳转落点）**：聊天行 `data-chat-anchor-key`（= 快照节点 key，ChatView 内部滚动恢复也用同一属性）；`[data-chat-flow]` = 聊天视图容器（判断视图是否挂载）；滚动口 `[data-conversation-scroll]`（scrollBody）。`scrollIntoView({block:'start'})` 即滚到官方滚动口。
- **列表行投影管线（client）**：`session.list` 响应行带 `projections`（host 组装：live 用 `sessionProjections.snapshot()`，cold 用 `sessionProjectionCache.cachedSnapshot()`，失败/空则整块缺席）；client manager 逐 key `store.apply(key, value, asOfSeq)` 进 per-session `projectionStores`（higher-seq-wins），列表行 `projectionValues` = store.values()。**列表行投影 ≠ 会话作用域 `useProjection`**（后者是 per-session 完整投影通道）。
- **current 的 masked gap**：`projectList` 中 selected 会话暂不在 items（如切换间隙）→ `current=undefined`（UI 呈 hero 态、左栏隐藏），会话回列表后自动回填——是官方瞬态，非 bug。
- **useSessions 底层**：`useSyncExternalStoreWithSelector`（`packages/client/web-react/src/bind.ts`），默认 Object.is 相等；root scope 同样有 useSessions 且 state 含 `current`（SessionListState）。

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

**浏览器侧诊断（F12 Console）**——左栏相关问题快速定位（面板在不在 DOM / 几何对不对）：

```js
(() => {
  const slot = document.querySelector('[data-slot="shell.overlay"]');
  const panel = slot?.firstElementChild;
  const conv = document.querySelector('[data-slot="conversation"] > div[data-phase]');
  return {
    overlaySlot: slot ? `存在，子元素 ${slot.childElementCount} 个` : '不存在',
    panelStyle: panel ? { left: panel.style.left, top: panel.style.top, width: panel.style.width, height: panel.style.height } : null,
    panelText: panel ? panel.textContent.replace(/\s+/g,' ').slice(0,60) : null,
    convPadding: conv?.style.paddingLeft,
    convRect: conv ? JSON.stringify(conv.getBoundingClientRect()) : null,
    slotErrors: [...document.querySelectorAll('[data-slot-error]')].map(e => e.getAttribute('data-slot-error')),
  };
})()
```

判读：`overlaySlot` 缺 → 条目未注册；`panelText` 是 `☰历史` → 折叠态（localStorage 记忆，非 bug）；`panelStyle.left/height` 异常（0/0）或 convPadding 空但面板在 → 几何未定位（渲染协调问题，见 §2）。

## 5. 踩坑记录

- **BRE grep**：`\(` 是分组符不是字面括号；固定串用 `grep -F`。
- **tsc 产物保留 JSDoc**：旧 build-client 靠 `export default ` 标记切片（现已被 esbuild 取代）。
- **pnpm 11** 首次装 esbuild 自动生成 `pnpm-workspace.yaml` 的 `allowBuilds` 占位，需显式 `esbuild: true`。
- **测试不参与 typecheck**（tsconfig 只 include src），vitest 只转译不查类型——`pnpm verify` 的 typecheck 步骤不可省。
- **审批已禁用**：动态插件（cordis_define/cordis_run）的 client 授权会被自动拒绝，验证别走动态插件路径。
- 当前会话若无后代（例如是 fork 叶子），角标为 0 是**正确行为**；验证角标要切到有 fork 子会话的会话（可先用上面 curl 找 `parentSessionId` 反指某会话的行）。
- **"刷新后左栏消失"多半是折叠态误判**：折叠态持久化在 localStorage `dsh-trail.left-column`（`{width, collapsed}`），刷新后保持折叠 → 28px 竖条太隐蔽被当成"没了"。先看竖条（诊断 `panelText`），不是 bug；竖条必须保持可发现性（☰ + 竖排"历史"文字 + hover）。
- **会话切换后左栏消失/竖条漂移 = 引用过期**：conversation 槽位会话切换重挂载（DOM 节点替换），layout effect 闭包若缓存节点引用 → RO 观察 detached 节点永不触发、几何读取全 0。修复组合：effect deps 含 current + 每次实时查询节点 + 几何未就绪 rAF 重试（≤20 帧）+ 250ms 漂移轮询 + panelStyle 初始 height:100%。**改几何逻辑时务必保持这套防御**。
- **RO 对 grid 列过渡（侧栏开合）时序不可靠**：开侧栏触发、关侧栏可能漏触发 → 位置漂移。250ms 漂移轮询兜底（对比 panel.left 与会话列左缘，漂移>1px 重新定位；拖拽中跳过）。

## 6. 代码结构约定

- host：`src/index.ts`（注册投影单元，`stateVersion=2`）；client：`src/client.ts`（default-export factory(require)）。
- 纯逻辑层 `src/history/`：`types.ts`（节点类型）、`text.ts`（摘要/文本工具）、`summarize.ts`（整句规则摘要）、`fold.ts`（事件折叠 reducer）、`schema.ts`（zod，host-only）、`lineage.ts`（isDescendantOf / sharedPrefixLength）、`index.ts`（节点中心索引：rootOf / buildHistoryIndex / lineageForNode）。
- **左栏模块**：`src/client.ts` 内 `createLeftColumn`（shell.overlay 面板：几何/让位/拖宽/折叠/行内跳转/瞬态提示）+ `src/left-column.ts`（纯逻辑：`clampColumnWidth` 钳制 240–480/聊天保 480、`readLeftColumnPrefs`/`writeLeftColumnPrefs` localStorage 记忆）+ `src/jump.ts`（纯逻辑：`resolveJumpTarget` 历史节点→聊天节点 key（同 turn 最小 anchorSeq，seq 范围回退）、`minAnchorSeq` 翻页进度判断、`JumpChatNodeLike`/`JumpChatNodeRawLike`）。
- 测试 `tests/*.test.ts`，import `../src/*.js`；bundle 安全（client 不 import zod、不 import node 内置）；**client.ts 用 DOM API（document/window/ResizeObserver/requestAnimationFrame）**，tsconfig lib 已含 DOM。

## 7. 下一步（按数据就绪度）

0. **host 侧补齐缺 history 的投影缓存**（首个待办，涉及旧会话左栏空）：history 投影注册前已存在、之后未再打开的会话，持久化缓存行无 history → 列表行投影空 → 切到它们左栏空态。机制上会话**打开**会自动走 coldSnapshot 补齐并写回，但为了一次性解决：
   - 在 `src/index.ts` apply 里后台（不阻塞启动）遍历 `ctx.sessionPersistence.list()` 的 meta；对 `ctx.sessionProjectionCache.cachedSnapshot(meta)` 缺 `history` 的会话调 `coldSnapshot(meta.id)` 补齐（写回缓存）；
   - 用 ctx.effect 管理 + AbortSignal 支持；只对缺失的会话补（20/45 已有）；
   - **host 改动需重启 GUI 生效**（会中断会话，选时机重启）；改完验证：切到任一旧会话左栏都有节点。
1. **左栏交互补全**（骨架/拖宽/跳转已完成；fork 续写 ✅、谱系角标/下拉 ✅）：
   a. ~~点击节点行内跳转~~（完成：`src/jump.ts` 纯映射 + 左栏行 onClick；落点=轮首用户行；**超出已加载窗口自动 `session.loadOlder()` 逐页翻页**（每页 50 条，上限 20 页；hasMore/openState/窗口起点三重守卫防空转）；翻页后轮询等行渲染进 DOM（4s 超时）；失败提示：聊天视图未激活 / 目标节点未加载或不存在）。
   b. ~~fork 续写入口迁移到左栏行~~（完成：行尾「续写」按钮 hover 显现（opacity/pointerEvents 随行 hover 态），点击 `sessions.fork({sessionId: current, atSeq: boundarySeq, increaseTitle: true})` → `open(childId)`，失败走 showHint 瞬态提示；进行中节点不渲染按钮）。
   c. ~~谱系角标/下拉迁移~~（完成：左栏新增全量 `useSessions` selector → `toLineageSessions` → `buildHistoryIndex` → **行首分叉数字**（hover/展开变官方 chevron）点击展开共享会话下拉（叶子摘要 + 切换）；展开体是**行下方 column 兄弟**（复刻官方 DisclosureRow 骨架，marginLeft 20 缩进，不再作为行内 flex item——修复撑高/挤占 bug）；`lineageForNode` 复用，`src/history/*` 零改动）。
   d. **窄屏自动折叠**：convRoot 宽度低于阈值（约 MIN_CHAT + MIN 列宽）自动折叠（拖拽钳制已就位，仅差阈值触发）。
   e. 已知边界：非聊天视图（trajectory/旧 tab）无法编程切换（chatStore 私有）→ 提示用户手动切回；超深历史（>20 页）放弃并提示；跳转高亮留待 polish。
2. **旧 tab 去留**：左栏稳定后移除 `conversation.view` 注册（或加配置项 A/B）。
3. **M5 二级完整路径**：数据已全在 client（每会话完整节点路径），基本是 UI。
