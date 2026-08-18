# DEVELOPMENT.md — dsh-trail-plugin 开发上下文（会话交接用）

> 本文件浓缩 2026-08-16（M1–M4 数据链路）+ 2026-08-17（真左栏 feature/left-column）+
> 2026-08-17（左栏交互 feature/left-column-interactions，已 no-ff 合并回 main）+
> 2026-08-17（半圆按钮 feature/expand-button-shape，已 no-ff 合并回 main）+
> 2026-08-17（交接核查：回退破坏性分支 + 补全官方层叠/结构调研）+
> 2026-08-18（host 缓存补齐 feature/host-backfill：启动后台顺序冷读补齐缺 history 的旧会话）+
> 2026-08-18（移除历史索引 tab feature/remove-history-tab：conversation.view 注册删除，保留 shell.overlay 左栏）+
> 2026-08-18（交接同步：两轮功能 GUI 实测通过 + git 分支状态刷新 + 本轮新验证的官方机制补充）
> 七轮开发对话的后续开发所需信息。
> 代码变更历史见 git log（`b32e2ba` 起，里程碑：skeleton → M1–M4 → 左栏 spike/拖宽/跳转/渲染协调 →
> 分叉交互 → 行精简 → 分支列表 → 背景统一 → 跳转指示 → header 对齐 → 折叠按钮 → 半圆按钮 →
> host 缓存补齐 → 移除历史索引 tab）。
> 详细设计见 `DESIGN.md`（Session Tree / History Index 插件）。

## 1. 当前状态

- **已完成**：骨架、挂载验证、M1–M4、**真左栏**（`feature/left-column` 已合并回 main：shell.overlay 浮动列 + 内容让位 + 节点列表 + 折叠竖条（☰历史，可发现性）+ 拖拽调宽/记忆（240–480、聊天保 480、双击复位 280、localStorage）+ 点击行内跳转（含 loadOlder 分页兜底）+ **渲染协调修复**），81 测试全绿；`feature/left-column-interactions`（已 no-ff 合并回 main，8 个提交，91 测试全绿）：
  - 行尾「续写」按钮 hover 显现 + fork/open（`sessions.fork` → `open(childId)`）；
  - **分叉交互重构**——行首分叉数字（hover/展开变官方 chevron）点击展开；展开体为**行下方 column 兄弟**（复刻官方 DisclosureRow 骨架，不参与行内 flex、行高恒定，marginLeft 20 缩进无线框）；
  - **行精简**——每节点单行标题（删 meta 与 kind emoji），行 hover 高亮（interactive-bg-hover），续写按钮改官方 pill 风格（radius 999px）；
  - **分支列表同款风格**——展开体内分支行与节点行同款单行样式 + hover 高亮，**只显示叶子摘要**（fork 标题多为「旧标题+数字后缀」无辨识度），无「切换」按钮、整行点击直接 `sessions.open` 跳转；
  - **跳转缓冲指示**——点击节点跳转（尤其 loadOlder 翻页耗时）时，被点击行行尾显示官方 `IconLoadingOutline16` 旋转圆环（注入 style 标签定义 @keyframes），跳转结束/失败自动清除，`jumpGenRef` 世代守卫保证只由最新跳转清除；
  - **背景统一**——左栏 panel 与 tab 面板 `bg-layer-1` → `bg-base`（官方主表面惯例），展开体去线框（缩进即区分）；
  - **标题区分隔线对齐官方会话 header**——左栏标题区复刻官方两段式（titleRow 32 + 类 tabs 行 27，节点计数占位），分隔线落 75px 与右侧对话区平齐（box-sizing 坑见 §5）；
  - **折叠按钮重构**——移除 28px 竖向 rail，折叠态面板 0 宽，☰ 展开按钮作为 Fragment 兄弟悬浮，与 header「«」关于分割线镜像对称（见 §2）。
  - **半圆按钮重构**（feature/expand-button-shape）——折叠按钮 `<-` 配**左半圆**、展开按钮 `->` 配**右半圆**：两半圆**同半径 r=10（20×20）、gap 0 紧贴各自边缘**——折叠态右半圆直径边贴对话区内容左缘（恰好落在官方 header 左 padding 20px 区内，不压标题）、展开态左半圆直径边贴面板右缘（header 右 padding 0）——直径边都对着内容左缘、弧朝外，视觉拼成一个整圆；垂直中心 = titleRow 中心 y=28（translateY(-50%) 精确定心）；hover 高亮勾勒半圆 + title 描述；两按钮互斥出现，共用 `railHovered`（见 §2 决策表）。**GUI 实测通过**（用户确认无问题），已 no-ff 合并回 main（`7daec7d` + merge `544056d`），91 测试全绿。
  - **host 缓存补齐**（feature/host-backfill，已 no-ff 合并回 main `fdaae76`）——启动后台顺序冷读补齐缺 history 投影缓存的旧会话（`src/backfill.ts` 纯编排 + `src/index.ts` ctx.effect 接线，幂等/可中断/每会话错误隔离，见 §2 决策行与 §7.0）；重启 GUI 后 **GUI 实测通过**（用户确认：打开旧对话稍等片刻即显示逻辑节点，功能无问题），102 测试全绿。
  - **移除历史索引 tab**（feature/remove-history-tab，当前分支，**未合并**）——删除 `conversation.view` 注册与 `createHistoryView` 整块（含 `VIEW_ID`/`HistoryViewProps`/`KIND_ICONS`），保留左栏共享代码（`toLineageSessions`/接口/`history/*`/`jump`/`left-column`）与 `shell.overlay` 注册；官方 view 环剩 chat/trajectory 两项 → tabs 行照常 → 左栏 75px header 对齐不受影响；**GUI 实测通过**（用户确认无问题），98 测试全绿（102 − 4 个 tab 用例）；client 改动刷新即生效。
  - **能力必选化**（feature/required-capabilities，当前分支，**未合并**）——把四个能力从「可选（`ctx.get` 缺席静默跳过）」改为「必选（cordis fiber `inject`，缺席则 fiber 保持 PENDING、DSH boot 失败 loud）」。host `inject = ['sessionProjections', 'sessionProjectionCache']`（`src/index.ts` 具名导出，`apply` 内直读 `ctx.sessionProjections` / `ctx.sessionProjectionCache`，删除提前 return；`sessionPersistence` 保持可选 `ctx.get`）；client factory 返回对象 `inject = ['slots', 'sessions']`（`apply` 内直读 `ctx.slots` / `ctx.sessions`，`timer` 保持可选 `ctx.get`）；`package.json` `dsh.client.inject` 同步为 `["slots","sessions"]`（信息性 wire 依赖边，运行时权威是 factory 返回对象的 inject）。**行为变化**：无这些服务的组装（如 headless）里插件从静默 no-op 变为 PENDING；`trail-test` smoke profile 需补装 `sessionProjectionCache` 及其 storage 栈（`scripts/smoke.sh` 已加，见 §4）。99 测试全绿。
- **git/分支状态**：main 领先 `origin/main` **5 个提交（未 push）**（`7daec7d` 半圆按钮 + `544056d` merge + `df49aa8` 交接文档 + `084507d`/`fdaae76` host 缓存补齐）。本地分支：`feature/expand-button-shape` / `feature/left-column` / `feature/left-column-interactions` / `feature/host-backfill`（均已 no-ff 合并回 main，保留）、`feature/plugin-skeleton`（历史）、**`feature/remove-history-tab`**（已 no-ff 合并回 main `480db5a`）、**`feature/required-capabilities` = 当前分支**（领先 main 1 个提交，待测试后 no-ff 合并）、**`feature/narrow-auto-collapse` = 破坏性分支**（上次开发破坏了左栏功能后被放弃回退，**勿在其上继续开发**，保留仅作参考）。开发约定：中文 commit + 左栏 scope（`feat/fix/style/docs(left-column): …`，host 侧用 `feat(host)`）、特性合并回 main 一律 **no-ff**、feature 分支合并不删。
- **待办**：① **host 侧补齐缺 history 的投影缓存** — ✅ 已实现并 GUI 实测通过（`src/backfill.ts` 启动后台顺序冷读补齐 + `src/index.ts` 接线，幂等/可中断；已 no-ff 合并回 main `fdaae76`）；③ **旧 tab 去留** — ✅ 已移除（`feature/remove-history-tab`：删除 `conversation.view` 注册与 `createHistoryView` 整块，保留左栏共享的 `toLineageSessions`/接口/`history/*`；**client 改动刷新即生效无需重启**）；② 左栏交互补全剩 **窄屏自动折叠**（阈值触发，拖拽钳制已就位）+ 跳转高亮 polish；④ M5 二级完整路径。
- **验证约定**：client bundle 的 rev = 文件 sha1 前 12 位；**实测 web 服务器按请求实时计算 manifest**（`pnpm build` 后浏览器刷新即可见，无需重启 GUI——旧记录"重启才进 boot manifest"已过时）。**注意 curl 首查可能命中 index.html 缓存返回旧 rev，加 cache-buster（`?cb=$(date +%s%N)`）再查**。host 侧（src/index.ts）改动仍需重启 GUI 生效。
- 环境：DSH 源码在 `/app`（只读参考，禁止修改）；`DSH_HOME=/data/dsh-home`；GUI 在 `127.0.0.1:3080`；dsh CLI 用 `node /app/apps/cli/lib/bin.js`。

## 2. 架构决策（含理由，勿轻易推翻）

| 决策 | 理由 |
| --- | --- |
| **投影缓存承载节点树**（非自建存储） | 事件驱动折叠、checkpoint、冷读、schema 校验、生命周期、client `useProjection` 通道全部官方托管；落盘 `$DSH_HOME/storages/session_projcache.json`（该文件已在跑 14 个投影 key，28 会话约 127KB）；写合并 200 事件/5s + turn/end + 会话关闭；`stateVersion` 不匹配自动重算。**host 零改动约束**：一切派生数据只从官方已下发数据计算 |
| **fork 边界 = turn/end 事件 seq** | `sessions.fork` 校验 boundary 必须是连续事件 seq 且前缀不能停在未闭合 turn（`OPEN_TURN` 报错）——turn/end seq 天然安全 |
| **nodeKey = `(rootId, boundarySeq)`** | 结构身份：fork 深拷贝保留事件 seq，同一逻辑节点在整棵 fork 树内 seq 唯一且位置对齐；rootId（沿官方 parentId 上溯）消除无关树之间的 seq 命名空间碰撞。**匹配键必须用结构身份，不能用内容**（内容相同是巧合信号，会假阳性） |
| **角标 = 共享该逻辑节点的全部会话**（排除自身） | 用户明确口径：如 A→B→C→D / A→B→F / A→B→C→G 中，会话 1 的节点 B 应显示分叉 2（会话 0 与 2），祖先/兄弟/后代都计入。节点中心索引桶成员即全部共享会话 |
| **挂载在 `conversation.view`（tab）→ 真左栏挂 `shell.overlay`** | 早期因"替换 session 体要继承草稿镜像 + 视图环职责、tab 选中态在内部 chatStore"搁置左栏；2026-08-17 研究确认槽位机制硬墙：子槽位声明排他（重复声明 register throw）+ chatStore/views 账本私有 + 无 renderSlot 授权 = 替换 = 重写聊天渲染。**改用 `shell.overlay` 浮动列**（list 槽、replaceRisk none、唯一可覆盖会话列的可加性座位），内容让位 = 会话列根元素 padding-left；~~tab 保留作对比，稳定后移除~~（**已移除**：feature/remove-history-tab 删除 `conversation.view` 注册；官方 view 环仍剩 chat order0 + trajectory order10 两项 → tabs 行照常显示 → 左栏 header 75px 分隔线对齐不受影响） |
| **行内跳转走官方 DOM 锚点（左栏后续迭代）** | 聊天行自带 `data-chat-anchor-key`（= 会话快照节点 key），滚动容器 `[data-conversation-scroll]`；历史节点 → 聊天节点映射用 `ctx.sessions.binding(id).session`（ObservableSnapshot\<ConversationSnapshot\>）按 turn/anchorSeq 对齐 |
| **左栏几何必须实时查询节点（渲染协调）** | `conversation` 槽位是 session-maybe：会话切换时内容按 `epoch` 重挂载（DOM 节点被替换）。若 layout effect 闭包缓存 convRoot/panel 引用 → 切换后指向 detached 节点 → RO 永不触发、`getBoundingClientRect` 全 0 → 面板钉死 (0,0)/0 高（表现：切走切回左栏消失、关侧栏竖条不回位）。**必须**：effect deps 含 current（切换即重跑）、每次 applyLayout/漂移轮询实时 `closest/querySelector`、cleanup 实时清理 |
| **历史投影对"注册前已沉睡"的旧会话缺失** | history 投影 2026-08-16 注册；此前存在且之后从未打开的会话，checkpoint 从未写 history 缓存行 → 列表行投影无 history（实测 45 会话仅 20 有）。会话**打开**会走 coldSnapshot（缓存行+尾部重放）补齐并写回。列表行投影来源：live 会话 = `sessionProjections.snapshot(session)`（实时），cold 会话 = `sessionProjectionCache.cachedSnapshot(meta)`（只读缓存行） |
| **启动后台补齐缺失 history 缓存（顺序、幂等、自愈）** | 官方冷读阶梯即补齐路径：`cachedSnapshot(meta)` 判定（`values.history` 缺失 = 无可用行/version 不匹配/缓存读抛错，一律按缺失），`coldSnapshot(id, signal)` 补齐（缓存行+尾部重放→重折叠→**fail-soft 写回**）——与「会话打开时自动补齐」同一机制，只是批量提前到启动时。顺序执行（27 会话毫秒级）、每会话错误隔离、`ctx.effect` + AbortSignal（插件停止/更新即中断循环，abort 导致的失败不计 skipped）。只处理当前缺失：空 log 会话补齐 init 空态行后 cachedSnapshot 有值、不再重复。不加 config 开关（幂等、开销可忽略、自愈未来任何新缺失）。`src/backfill.ts` 纯编排（最小本地接口，不 import dsh 包），`src/index.ts` 在投影注册后接线，`sessionPersistence` 缺席（headless）跳过补齐 |
| **四个能力必选（fiber inject）** | 本插件功能本质依赖：host 的 `sessionProjections`（投影注册表）/ `sessionProjectionCache`（缓存）+ client 的 `slots`（槽位注册）/ `sessions`（fork/open/跳转）。`ctx.get` 缺席静默跳过会掩盖装配错误（注册了但没生效、无从报错）；改 cordis `inject` 声明后 fiber 进入 PENDING、DSH boot 的 `assertEntriesActivated` **失败 loud**（`pending (waiting for service: …)`），装配缺失在启动时暴露而非运行时静默。官方同款用法：host `web-app` `export const inject = ['webServer']`、`client-modules` `static inject = ['webServer','loader']`、client `app-shell` `inject = ['slots','sessions','layout']` 与所有 `ui-*` 插件。**注意**：client 侧本插件 bundle（esbuild factory handoff）与官方 tsdown 包不同——官方 bundle 把整个 CJS 命名空间（含顶层 `export const inject`）交给 loader，本插件 factory 只返回插件对象，所以 **`inject` 必须挂在 factory 返回对象上**（`{name, inject, apply}`），顶层具名导出不会到达 loader。`sessionPersistence` / `timer` 维持可选（`ctx.get`），不在必选列表 |
| **client 半区用 esbuild 打自定义 loader bundle** | DSH 静态插件 client 包必须产出 `window.__ModuleLoader__.load({id, factory(require)})`；esbuild 内联所有源码模块，external 只留平台模块（react、@deepseek-ai/cordis、**@deepseek-ai/dsh-client-ui-primitives** 等）由浏览器模块表解析（清单见 `/app/packages/client/web/src/platform.ts` 的 PLATFORM_MODULES）。**zod 只在 host 侧**（`src/history/schema.ts`），client 严禁 import（会打进 bundle）。**官方模块复用走 `require('@deepseek-ai/dsh-client-ui-primitives')` + 本地最小类型**（本地 node_modules 无此包，import 语句会让 tsc 解析失败） |
| **分叉展开结构 = 行下方 column 兄弟（对齐官方 DisclosureRow）** | 展开体若作行内 flex item 会被横向挤压、撑高整行（曾现 bug：标题被挤占、胶囊被挤到中间）。官方 DisclosureRow 骨架：root column = [行, 展开体]，展开体是行下方兄弟、不参与行内 flex、行高恒定。**不复用 DisclosureRow 组件本体**：① 行点击模型冲突（官方整行点击=展开，我们=跳转，且其无行点击自定义入口）；② 官方 `.row` 固定 24px 行高（CSS module 无覆盖入口），放不下我们的摘要+meta 两行。**复用官方 chevron 元素**（`IconChevronDownOutline14`，模块表 external），hover/展开时行首数字变 chevron（v 型提示），交互语义与官方 tool 行一致 |
| **主表面一律 `bg-base`（官方惯例）** | 官方大面积表面全部 bg-base：会话区 ConversationRoot / DetailsPanel / AppFrame / QueueDock / ReasoningRow / GenericCommandCard；`bg-layer-1/2` 只用于 trajectory 表格树 / JsonTree / settings 卡片等深嵌套表面（Modal/HoverCard 用专用 token + 阴影）。左栏 panel 与 tab 面板 bg-layer-1 → bg-base；展开体同底靠边框/缩进区分层级（官方 ioCard 模式），再简化为纯缩进（去线框） |
| **左栏标题区分隔线 = 官方会话 header 分隔线（75px）** | 官方 header（ConversationRoot.module.css）：padding-top 12 + titleRow min-height 32 + tabs 行（margin-top 4 + tab 高 27 = line-height 16 + padding-bottom 11）；view 环 ≥2 项显示 tabs（chat order0 / trajectory order10 / 我们的 history order20 → **移除 tab 后当前 2 项**：chat + trajectory，tabs 行仍显示）。分隔线在 12+32+4+27 = **75px** 处。左栏无 tabs，复刻两段式：titleRow(32) + 类 tabs 行（「N 个逻辑节点」占位，样式对齐官方 .tab：13px/16 + label-tertiary），minHeight 75（border-box）使线平齐。**官方布局数值变动需同步此值** |
| **半圆按钮 = 折叠 `<-` 左半圆 / 展开 `->` 右半圆（直径边都贴内容左缘，拼成一个整圆）** | 自 2026-08-17 取代 §41 的裸字符按钮：形状用纯 CSS border-radius（左半圆 `r 0 0 r` / 右半圆 `0 r r r`，元素 2r×2r），官方 primitives 模块表无 hamburger/箭头图标（只有 check/chevron/close/copy/warning），自绘是唯一轻量路线。几何常量 `EXPAND_BUTTON_RADIUS=10`（20×20，折叠态右半圆恰好落在官方 header 左 padding 20px 区内不压标题）、`EXPAND_BUTTON_CENTER_Y=28`（titleRow 中心 = padding-top 12 + 32/2）、`EXPAND_BUTTON_DIVIDER_GAP=0`（直径边紧贴边缘：折叠态贴对话区内容左缘、展开态贴面板右缘 = header 右 padding 0）。**锚点语义**：折叠分支 `left = convRect.left − frameRect.left`（**不再加记忆宽度**——旧版锚定"虚拟分割线"导致按钮悬在对话区中间）；垂直定心 = `top: CENTER_Y` + `transform: translateY(-50%)`。展开态折叠按钮在 header titleRow 内（flex 流，天然跟随面板右缘/拖拽），**`zIndex: 3` 盖过拖拽手柄（zIndex 2，面板右缘 8px 命中条）**——否则按钮右半被手柄抢占点击。两按钮互斥出现、共用 `railHovered` hover 态（半圆 hover 高亮 + title 描述「折叠左栏」/「展开历史索引」） |
| **官方 primitives 复用面** | 从 `@deepseek-ai/dsh-client-ui-primitives`（浏览器模块表 external）复用：`IconChevronDownOutline14`（分叉 chevron）、`IconLoadingOutline16`（跳转缓冲圆环）。均通过 `require('...')` + 本地最小 `ClientPrimitives` 接口（本地 node_modules 无此包）。**无 CSS 基建**：旋转动画用注入 `<style>` 标签定义 @keyframes（SPIN_CSS，静态注入一次） |
| **不用 host.call / harness.handle** | 那是**动态插件专用** RPC（静态 bundle 无此通道）；静态插件跨平面数据走 client 投影 / Remote（$mount + typert 生成产物，较重，已避免） |

## 3. 已验证的官方机制（事实清单）

- **投影**：`ctx.sessionProjections.register({key, schema, init, apply, view, stateVersion})`——`apply` 纯同步增量折叠，无关事件必须返回同一 state 引用；state 须 plain JSON；注册是 effect，卸载即消失。`sessionProjectionCache` 开 `session_projcache` 域；冷读阶梯 `cachedSnapshot`(零 I/O) → `coldSnapshot`(缓存行+尾部重放)。
- **client 读取**：会话列表 `useSessions` 每行带 `parentId`（= header.parentSession，fork 父）与 `projectionValues.history`（该会话节点树）——**wire 上 projections.values 是 `z.record(string, unknown)` 开放 map，外部包新 key 原样通过**。这是 M4 纯 client 谱系的数据基础。~~`useProjection('history')`（标准 props；`undefined` = 能力缺失）~~ —— 会话作用域投影通道**已随 tab 移除**（feature/remove-history-tab 后本插件不再注册 `conversation.view`，无需 useProjection）；左栏数据全部走**列表行投影 `projectionValues.history`**。
- **fork**：client `sessions.fork({sessionId, atSeq, increaseTitle})` → host `sessions.fork`，boundary=seq，seed=前缀拷贝；`sessions.open(childId)` 切换。
- **槽位**：`conversation.view` 是 list、可添加（replaceRisk none），注册 `{name, id, order, label}` + 组件；标准 props 含 `useSessions/useProjection/sessionId`。client slots 服务经 `inject` 必选后直读 `ctx.slots`（slots.inject + slots.register；官方 ui-* 插件同款）。**本插件已不再注册 `conversation.view`**（tab 已移除），只注册 `shell.overlay`（id `dsh-trail-left-column`，order 10）。
- **缓存冷读阶梯（host 补齐用，本轮实测确认）**：`sessionPersistence.list(signal?)` → `SessionHeader[]`（轻量 meta 列举，不解析 log）；`sessionProjectionCache.cachedSnapshot(meta)` 同步零 I/O（identity 校验 + `viewCheckpoint` 只服务 version 匹配的 key）；`coldSnapshot(id, signal?)` 异步冷读（缓存行 + `readFrom` 尾部重放 → registry `restore` 重折叠 → `putSoft` fail-soft 写回）；`restoreFloor` 算出重放起点——version 不匹配/超界的行被丢弃，若 floor>0 则整段从 seq0 重读（coldSnapshot 内部已处理）。`sessionProjectionCache` 服务 `requireTable()` 在 `[Service.init]` 完成后才可注入——`ctx.get` 拿到即已就绪。
- **ctx.effect 语义（本轮接线与测试确认）**：cordis `ctx.effect(fn)` **立即执行** setup、返回其 cleanup（插件停止/更新时调用）。测试 fakeCtx 的 `effect` 桩必须模拟立即调用 + 记录 cleanup，才能测到「注册即触发」的异步行为（如 backfill 启动）。
- **挂载**：`dsh plugin --profile <name> add <路径>`（pnpm link 进 profile）；组合行写 `$DSH_HOME/profiles/<name>/cordis.patch.yml`（`- id / name / config`）；Loader 以 profile 目录为 baseUrl；client 半区经 package.json `dsh.client {platform:'web'}` + `exports["./client"]` 进浏览器 roster，URL `/plugins/@deepseek-ai/<包名>/client.js?rev=…`。
- **client bundle 契约**：`window.__ModuleLoader__.load({id: 包名, factory(require)})`；factory 返回 `{name, apply}`；模块表含 react / @deepseek-ai/cordis / @deepseek-ai/dsh-client-ui-slots 等。
- **会话快照访问（跳转/分页用）**：`ctx.sessions.binding(id)?.session` = `SessionFace` = `ISession & ObservableSnapshot<ConversationSnapshot>`。`loadOlder()` 是 **ISession 动词**（无需 scope().get('conversation')）；每页 `PAGE_MESSAGES=50` 条，守卫 `openState==='open' && hasMore && !loadingOlder`（不满足时静默 no-op），prepend 后快照同步更新。快照结构：`chat.nodes`（ChatNodeStore：`get(key)`/`values()`）、`chat.order`、`hasMore`、`loadingOlder`、`openState`；聊天节点 `location` = `{kind:'turn'|'step', turn: TurnLocation}`（turn 号与历史节点对齐，fork 前缀拷贝保留）。
- **DOM 锚点（跳转落点）**：聊天行 `data-chat-anchor-key`（= 快照节点 key，ChatView 内部滚动恢复也用同一属性）；`[data-chat-flow]` = 聊天视图容器（判断视图是否挂载）；滚动口 `[data-conversation-scroll]`（scrollBody）。`scrollIntoView({block:'start'})` 即滚到官方滚动口。
- **列表行投影管线（client）**：`session.list` 响应行带 `projections`（host 组装：live 用 `sessionProjections.snapshot()`，cold 用 `sessionProjectionCache.cachedSnapshot()`，失败/空则整块缺席）；client manager 逐 key `store.apply(key, value, asOfSeq)` 进 per-session `projectionStores`（higher-seq-wins），列表行 `projectionValues` = store.values()。**列表行投影 ≠ 会话作用域 `useProjection`**（后者是 per-session 完整投影通道）。
- **current 的 masked gap**：`projectList` 中 selected 会话暂不在 items（如切换间隙）→ `current=undefined`（UI 呈 hero 态、左栏隐藏），会话回列表后自动回填——是官方瞬态，非 bug。
- **useSessions 底层**：`useSyncExternalStoreWithSelector`（`packages/client/web-react/src/bind.ts`），默认 Object.is 相等；root scope 同样有 useSessions 且 state 含 `current`（SessionListState）。
- **shell.overlay 层叠结构（AppFrame.module.css，半圆按钮调研结论）**：`.overlayLayer { position:absolute; inset:0; z-index:20; pointer-events:none }` + `.overlayLayer > * { pointer-events:auto }`；对话区列 `.centerCol` **z-index auto** → 对话区整体（含其内部 z-index 1/7/8/100 的 sticky 元素）都在 overlayLayer(z-20) 之下——**任何对话区重绘都不可能盖住 overlay 内元素**（若看到"按钮被对话区覆盖"，先查按钮是否真的在 overlayLayer 内/是否渲染）。frame 有 `overflow:hidden`（overlay 内元素超出 frame 会被裁剪）。
- **slot outlet 锚点容器**：每个槽位渲染包 `<div data-slot="<key>">`，`display: contents`（web-react scoped-slots.tsx `ANCHOR_STYLE`）——布局中性、不产生盒子，absolute 子元素的包含块上溯到 positioned 祖先（shell.overlay 即 overlayLayer），frame 坐标系成立；`display: contents` 不拦截指针事件。
- **官方对话区 header 结构（ConversationRoot.module.css）**：`header { padding: 12px 28px 0 20px }`；titleRow min-height 32（垂直范围 [12,44]，中心 y=28）；titleCluster flex:1 从内容左缘 **+20px** 开始——**左 padding 20px 是空留白，可安全叠加覆盖元素**（半圆按钮折叠态即嵌此区）；header::after 分隔线 z-index 0 pointer-events none。
- **官方 primitives 图标全清单**：`IconCheckOutline16 / IconChevronDownOutline14 / IconCloseOutline16 / IconCopyOutline16 / IconWarningOutline16`（`packages/client/ui-primitives/src/`）——**没有 hamburger/panel/箭头图标**，左栏按钮类图标必须自绘（半圆按钮用 CSS border-radius 自绘即因此）。

## 4. 验证配方

```bash
pnpm verify                        # typecheck + vitest + build（build 含 esbuild 打 client bundle）
# 起 trail-test profile 断言 hello world。注意：能力必选化后（feature/required-capabilities），
# trail-test 必须同装 sessionProjectionCache 及其 storage 栈（storage/storage-json/storage-domain，
# 配置与 web-app bundle 一致）——scripts/smoke.sh 已内置；缺它会 boot 失败 loud
# `dsh-trail-plugin: pending (waiting for service: sessionProjectionCache)`。
DSH_BIN='node /app/apps/cli/lib/bin.js' ./scripts/smoke.sh
# 直接查运行中 host 的会话列表（含每会话投影与 fork 父）：
curl -s -X POST http://127.0.0.1:3080/api/session.list -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"p","method":"session.list","payload":{}}'
# 统计缺 history 投影的会话数（host 缓存补齐的验收指标）：
curl -s -X POST http://127.0.0.1:3080/api/session.list -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"p","method":"session.list","payload":{}}' > /tmp/sessions.json \
  && node -e 'const r=JSON.parse(require("fs").readFileSync("/tmp/sessions.json","utf8"));const it=r.result?.value?.items??[];console.log(`total=${it.length} withHistory=${it.filter(i=>i.projections?.values?.history).length} missing=${it.filter(i=>!(i.projections?.values?.history)).length}`)'
# 实测基准：host 补齐前 27/58 缺失 → 重启 GUI 后应归零（空 log 会话补齐 init 空态行也计入有值）
# 模拟浏览器执行 bundle（fake __ModuleLoader__ + fake React/useState/useSessions）
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

判读：`overlaySlot` 缺 → 条目未注册；折叠态时 panel 0 宽（`panelStyle.width` 为 "0px"），应看到 **-> 右半圆展开按钮**（Fragment 兄弟，直径边贴对话区左缘，`expandButtonRef` 位置由 applyLayout 折叠分支设置；展开态则在 panel header 右端见 `<-` 左半圆）；`panelStyle.left/height` 异常（0/0）或 convPadding 空但面板在 → 几何未定位（渲染协调问题，见 §2）。

## 5. 踩坑记录

- **BRE grep**：`\(` 是分组符不是字面括号；固定串用 `grep -F`。
- **tsc 产物保留 JSDoc**：旧 build-client 靠 `export default ` 标记切片（现已被 esbuild 取代）。
- **pnpm 11** 首次装 esbuild 自动生成 `pnpm-workspace.yaml` 的 `allowBuilds` 占位，需显式 `esbuild: true`。
- **测试不参与 typecheck**（tsconfig 只 include src），vitest 只转译不查类型——`pnpm verify` 的 typecheck 步骤不可省。
- **审批已禁用**：动态插件（cordis_define/cordis_run）的 client 授权会被自动拒绝，验证别走动态插件路径。
- 当前会话若无后代（例如是 fork 叶子），角标为 0 是**正确行为**；验证角标要切到有 fork 子会话的会话（可先用上面 curl 找 `parentSessionId` 反指某会话的行）。
- **"刷新后左栏消失"多半是折叠态误判**：折叠态持久化在 localStorage `dsh-trail.left-column`（`{width, collapsed}`），刷新后保持折叠。折叠态现在是**面板 0 宽 + 悬浮 -> 右半圆展开按钮**（直径边贴对话区内容左缘，恰落在官方 header 左 padding 区内；与展开态的 `<-` 左半圆折叠按钮同半径同 gap、拼合一个整圆）；按钮不大且嵌在对话区 header 左上角，找不到会被当成"没了"——先查 `[data-slot="shell.overlay"]` 子元素与 `->` 半圆按钮（title「展开历史索引」），不是 bug。
- **box-sizing 坑（header 高度偏高 13px）**：React inline style 默认 `content-box`，`minHeight` 作用于**内容区**（不含 padding）。左栏 header 若 `padding-top 12 + minHeight 44` → 实际总高 12+44=56px，比官方 44px 高 12px。**容器同时设 padding 与 minHeight 时必须 `boxSizing: 'border-box'`**（minHeight 才含 padding）。
- **curl manifest 缓存时序**：`pnpm build` 后 curl 首页首次可能命中 index.html 缓存返回旧 rev，加 cache-buster（`?cb=$(date +%s%N)`）再查即为新 rev——以 sha1(lib/client.js) 前 12 位为准。
- **会话切换后左栏消失/竖条漂移 = 引用过期**：conversation 槽位会话切换重挂载（DOM 节点替换），layout effect 闭包若缓存节点引用 → RO 观察 detached 节点永不触发、几何读取全 0。修复组合：effect deps 含 current + 每次实时查询节点 + 几何未就绪 rAF 重试（≤20 帧）+ 250ms 漂移轮询 + panelStyle 初始 height:100%。**改几何逻辑时务必保持这套防御**。
- **RO 对 grid 列过渡（侧栏开合）时序不可靠**：开侧栏触发、关侧栏可能漏触发 → 位置漂移。250ms 漂移轮询兜底（对比 panel.left 与会话列左缘，漂移>1px 重新定位；拖拽中跳过）。
- **折叠态按钮锚点教训（半圆按钮重构）**：折叠态展开按钮若锚定"虚拟分割线 = 对话区左缘 + 记忆宽度"→ 按钮悬在对话区中间（远离左缘，易被误判为漂移 bug）。正确锚定 = **对话区内容左缘**（`left = convRect.left − frameRect.left`，不再加 widthRef），gap 0 恰好落在官方 header 左 padding 20px 区内、不压标题。
- **拖拽手柄抢占紧贴右缘的按钮**：拖宽手柄（`right:0; width:8; zIndex:2`）覆盖面板右缘 8px——折叠按钮若 gap 0 贴右缘（r=10 宽 20），右 8px（40%）点击会被手柄抢走（触发拖拽而非折叠）。**按钮必须 `zIndex: 3`（> 手柄 2）**或留出间距。
- **git merge 偶发 `fatal: stash failed`**：曾出现一次（工作区干净、无自定义 hooks），重试即成功——环境偶发，遇此直接重试 merge。

## 6. 代码结构约定

- host：`src/index.ts`（注册投影单元，`stateVersion=2`；具名导出 `inject = ['sessionProjections','sessionProjectionCache']` 声明必选服务，`apply` 内直读 `ctx.sessionProjections` / `ctx.sessionProjectionCache`，`sessionPersistence` 走 `ctx.get` 可选）+ `src/backfill.ts`（启动后台补齐缺 history 缓存：`backfillMissingHistory` 纯编排，最小本地接口 `SessionPersistenceLike`/`SessionProjectionCacheLike`/`SessionHeaderLike`，不 import dsh 包）；client：`src/client.ts`（default-export factory(require)，返回对象带 `inject = ['slots','sessions']`，只注册 `shell.overlay` 左栏）。
- 纯逻辑层 `src/history/`：`types.ts`（节点类型）、`text.ts`（摘要/文本工具）、`summarize.ts`（整句规则摘要）、`fold.ts`（事件折叠 reducer）、`schema.ts`（zod，host-only）、`lineage.ts`（isDescendantOf / sharedPrefixLength）、`index.ts`（节点中心索引：rootOf / buildHistoryIndex / lineageForNode）。
- **左栏模块**：`src/client.ts` 内 `createLeftColumn`（shell.overlay 面板：几何/让位/拖宽/折叠/行内跳转/瞬态提示/跳转缓冲指示/分叉展开/续写）+ `src/left-column.ts`（纯逻辑：`clampColumnWidth` 钳制 240–480/聊天保 480、`readLeftColumnPrefs`/`writeLeftColumnPrefs` localStorage 记忆）+ `src/jump.ts`（纯逻辑：`resolveJumpTarget` 历史节点→聊天节点 key（同 turn 最小 anchorSeq，seq 范围回退）、`minAnchorSeq` 翻页进度判断、`JumpChatNodeLike`/`JumpChatNodeRawLike`）。
- **左栏组件返回 Fragment**：`[panel div（折叠 0 宽）, collapsed ? -> 右半圆展开按钮 : null]`——展开按钮必须为 Fragment 兄弟（panel overflow:hidden）；折叠态位置由 `applyLayout` 折叠分支计算（`left = convRect.left − frameRect.left + EXPAND_BUTTON_DIVIDER_GAP(0)`——贴对话区内容左缘，不再加记忆宽度；`top = convTop + CENTER_Y` + 垂直定心走 `transform: translateY(-50%)`）；展开态折叠按钮 `<-` 左半圆在 header titleRow 右端（header 右 padding 0 = gap 0 贴面板右缘，`zIndex: 3` 盖过拖拽手柄）。两按钮互斥、共用 `railHovered`，**无新增 state**。
- **左栏 useState 调用序（fakeReact 注入序，勿打乱）**：`prefs(0) → lineageOpen(1) → hoveredRow(2) → hoveredBranch(3) → jumpingNodeKey(4) → handleHovered(5) → railHovered(6) → dragging(7) → hint(8)`。测试用 `fakeReact([...states])` 按调用序注入初始值——**新增 state 必须追加在末尾**，否则现有测试注入错位。
- 测试 `tests/*.test.ts`，import `../src/*.js`；bundle 安全（client 不 import zod、不 import node 内置）；**client.ts 用 DOM API（document/window/ResizeObserver/requestAnimationFrame）**，tsconfig lib 已含 DOM。渲染树断言 helper：`findByKey/findByText`（props）、`findElementByKey/findElementByTitle`（完整元素含 children，结构断言用）。**fake ctx.effect 桩必须立即执行 setup 并记录/返回 cleanup**（cordis 语义，host-projection.test.ts 的接线用例依赖它触发异步补齐）；断言服务方法带 signal 参数时用 `expect.any(AbortSignal)`（backfill 接线用例先例）。
- **半圆按钮相关约定**：几何常量 `EXPAND_BUTTON_RADIUS=10 / CENTER_Y=28 / DIVIDER_GAP=0` 定义在 `createLeftColumn` 内 `expandButtonStyle` 之前（样式定义区，勿移到组件外）；测试断言：折叠态测试断言「展开历史索引」+ `->` + Fragment 2 子元素（面板 0 宽/无 borderRight），展开态测试断言「折叠左栏」+ `<-` + 无 `->`（`tests/client.test.ts`）。

## 7. 下一步（按数据就绪度）

0. **host 侧补齐缺 history 的投影缓存** — ✅ **已实现并 GUI 实测通过**（2026-08-18，`feature/host-backfill`，已 no-ff 合并回 main `fdaae76`）：
   - 实现：`src/backfill.ts` `backfillMissingHistory`（`persistence.list()` → `cachedSnapshot(meta).values.history` 缺失判定 → 逐个顺序 `coldSnapshot(id, signal)`；错误隔离/abort 中断/幂等），`src/index.ts` 投影注册后 `ctx.effect` 接线（AbortController cleanup，服务缺席跳过）；`tests/backfill.test.ts`（9 用例）+ `tests/host-projection.test.ts` 接线用例（2 个）；102 测试全绿。
   - **验证结论（用户确认）**：重启 GUI 后 `history backfill: 检查 N 个会话，补齐 M 个，跳过 K 个` 日志出现，缺失数 27/58 → 0（§4 有统计脚本）；**打开旧对话稍等片刻即显示逻辑节点**，功能无问题。
1. **左栏交互补全**（骨架/拖宽/跳转已完成；fork 续写 ✅、谱系角标/下拉 ✅）：
   a. ~~点击节点行内跳转~~（完成：`src/jump.ts` 纯映射 + 左栏行 onClick；落点=轮首用户行；**超出已加载窗口自动 `session.loadOlder()` 逐页翻页**（每页 50 条，上限 20 页；hasMore/openState/窗口起点三重守卫防空转）；翻页后轮询等行渲染进 DOM（4s 超时）；失败提示：聊天视图未激活 / 目标节点未加载或不存在）。
   b. ~~fork 续写入口迁移到左栏行~~（完成：行尾「续写」按钮 hover 显现（opacity/pointerEvents 随行 hover 态），点击 `sessions.fork({sessionId: current, atSeq: boundarySeq, increaseTitle: true})` → `open(childId)`，失败走 showHint 瞬态提示；进行中节点不渲染按钮）。
   c. ~~谱系角标/下拉迁移~~（完成：左栏新增全量 `useSessions` selector → `toLineageSessions` → `buildHistoryIndex` → **行首分叉数字**（hover/展开变官方 chevron）点击展开共享会话下拉（叶子摘要 + 切换）；展开体是**行下方 column 兄弟**（复刻官方 DisclosureRow 骨架，marginLeft 20 缩进，不再作为行内 flex item——修复撑高/挤占 bug）；`lineageForNode` 复用，`src/history/*` 零改动）。
   d. **窄屏自动折叠**：convRoot 宽度低于阈值（约 MIN_CHAT + MIN 列宽）自动折叠（拖拽钳制已就位，仅差阈值触发）。**半圆按钮已就位**（折叠态 -> 右半圆贴对话区左缘、展开态 <- 左半圆贴面板右缘），阈值触发逻辑补上即可完整。
   e. 已知边界：非聊天视图（trajectory）无法编程切换（chatStore 私有）→ 提示用户手动切回；超深历史（>20 页）放弃并提示；跳转高亮留待 polish。
2. **旧 tab 去留** — ✅ **已移除并 GUI 实测通过**（2026-08-18，`feature/remove-history-tab`）：删除 `src/client.ts` 的 `conversation.view` 注册块 + `createHistoryView` 整块（含其局部样式、`VIEW_ID`/`HistoryViewProps`/`KIND_ICONS`）；保留左栏共享的 `toLineageSessions`、`SessionSummaryLike`/`SessionListStateLike`、`ClientSessions`/`ClientSlots`、`history/*`/`jump`/`left-column` 纯逻辑与 `shell.overlay` 注册；`tests/client.test.ts` 删 4 个 tab 用例、改写 apply 注册断言（只剩 shell.overlay）；98 测试全绿。**GUI 实测通过（用户确认无问题）**：会话 header tab 环只剩「对话/Trajectory」两项，左栏全部功能（跳转/续写/角标/拖宽/折叠）正常。**client 改动刷新即生效，无需重启 GUI**（官方 view 环剩 chat/trajectory 两项，tabs 行照常，左栏 75px header 对齐不受影响）。
3. **M5 二级完整路径**：数据已全在 client（每会话完整节点路径），基本是 UI。
