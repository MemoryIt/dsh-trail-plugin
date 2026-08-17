# Session Tree / History Index 插件设计文档

**状态**：Draft  
**工作名**：Session Tree（或 History Index）  
**作者**：[你的名字]  
**日期**：2026-08-16  
**适用版本**：DeepSeek Harness (dsh) ≥ 0.1.0-rc.x（Developer Preview）  
**相关讨论**：[可后续补充 GitHub Discussion / Issue 链接]

---

## 1. 摘要

在 dsh 官方严格 **append-only 线性 Session** 之上，提供可导航的历史索引侧栏，并支持从任意历史节点**查看**或 **fork 续写**。插件不修改核心 log，不引入同 Session 内的 parentId 消息树，所有写操作仅通过官方 `sessions.fork` 完成。主对话区继续复用官方 Conversation UI。

一句话目标：**给线性 Session 加上可索引、可跳转、可分叉的导航层**。

---

## 2. 背景与动机

### 2.1 现状

- dsh Session 是严格的 append-only `SessionEvent` 日志，消息历史由 log **派生**。
- 官方已提供 `sessions.fork(source, boundary)`：将边界前前缀深拷贝为新 Session 的 seed，并记录 `parentSession` 与 `seedLength`。
- 当前 Web UI 以线性对话流为主，缺乏对历史节点的快速索引与从任意节点重试/续写的便捷入口。
- 与 Pi 等系统的差异：Pi 使用同文件内 parentId 树并可移动 leaf；dsh 的分支语义是「新 Session + 前缀复制」。

### 2.2 问题

1. 长对话中难以快速回顾或定位到某个关键 turn。
2. 对某轮结果不满意时，只能从头新建对话或手动复制上下文，成本高。
3. 多次 fork 后形成的多分支谱系缺乏可视化索引，用户难以在分支间切换或继续分叉。

### 2.3 定位

本插件是 **纯投影层 + 官方 fork 触发器**，不替换 Session 模型，不改写 log。换话题仍应新建根 Session；同一话题内的重问/续写通过 fork 完成。

---

## 3. 目标与非目标

### 3.1 目标（Goals）

1. **历史索引**：以节点列表展示当前激活 Session 从根到叶的路径。
2. **节点摘要**：每个节点只总结自身内容；完整上下文仍通过主对话区阅读。
3. **跳转查看**：选中节点后主区定位到对应消息（不修改 Session、不 fork）。
4. **从节点续写**：从指定历史节点执行官方 `fork`，切换到新 Session，支持修改问题后继续。
5. **多分支浏览**：当某逻辑节点后存在多个叶子 Session 时，提供角标与级联选择，支持在已有分支上继续跳转或再 fork。
6. 严格遵守「pure projection」：UI 不持有权威状态，写路径仅走官方 API。

### 3.2 非目标（Non-Goals，首期不做）

- 改造官方 log 或引入同 Session 内的 parentId 树。
- 用思维导图 / React Flow 作为主交互方式（可作为后续总览视图）。
- 把不同话题硬塞进同一棵逻辑树。
- 自动合并分支、冲突解决、跨 Session 消息编辑等高级能力。
- 替换官方 Trajectory 或 Session 浏览器。

---

## 4. 高层设计

### 4.1 架构原则

```
官方 SessionEvent 日志（唯一事实来源）
        ↓ 只读订阅（session/event 等）
插件投影层：逻辑节点 / 路径 / 谱系 / 摘要
        ↓
左栏 UI（索引导航）          右栏 = 官方 Conversation 渲染
        ↓ 写操作仅通过
sessions.fork / 发消息 / 切换 Session
```

- 插件只维护投影与私有摘要/谱系存储。
- 不修改 append-only log。
- 分支行为完全委托给官方 `sessions.fork`。

### 4.2 界面结构（主方案）

官方 Web UI 本身是 **Sidebar（可折）+ Conversation + Details（可折可拖）** 的三栏体系，社区插件（如 Workbench）已证明可在 Conversation 区域再做可拖拽多列。

本插件在 **Conversation 区域内** 增加一列可调整的历史索引左栏，形成：

```
┌─────────────────────────────┬──────────────────────────────────┐
│ 左栏：History Index          │ 右栏：官方 Conversation           │
│ （可拖拽调整宽度，默认约      │ （主对话流 / think·tool 折叠）     │
│  35–40%，可折叠）             │                                  │
│                              │                                  │
│ · 当前路径节点列表            │                                  │
│ · 节点摘要 + 类型图标         │                                  │
│ · 角标 / 级联分支选择         │                                  │
└─────────────────────────────┴──────────────────────────────────┘
         ↑ 中间为可拖拽 resize handle（双击复位默认比例）
```

**布局与交互原则**：

- **默认比例**：约 35–40% : 60–65%（接近原先 4:6 的观感），并设最小/最大约束（建议左栏 240–480px）。
- **可动态调整**：中间提供拖拽 handle，实时改变左右宽度；松手后持久化（插件私有存储或 localStorage，可按全局或按 Session 记忆）。
- **可折叠**：支持一键折叠到极窄状态（或仅保留竖向入口条），再次点击/拖拽展开；折叠状态也记忆。
- **双击 handle**：复位到默认比例。
- **空间让步**：窗口过窄时优先自动折叠左栏，保证主对话区可读宽度；与官方 Sidebar / Details / 其他右侧插件（Workbench、产物面板等）共存时，遵循类似的 concession 思路。
- **与官方解耦**：本索引栏的折叠与宽度独立于官方左侧 Sidebar 的 56px 轨折叠。

**左栏每一行**：

- 对应当前激活 Session 路径上的一个逻辑节点。
- 一行摘要 + 类型图标（风格对齐官方 tool / think 行）。
- 悬停或菜单操作：**跳转** | **从此处 fork**。

**多叶子处理**：

- 节点后存在多个叶子 Session 时显示数字角标。
- 一级下拉：共享该逻辑节点的 Session / 叶子，标题使用该分支最终叶子的摘要。
- 二级展开：悬停某 Session 后旁侧列出其全部节点路径，再选跳转或 fork。
- 确认操作后再切换主对话与左栏路径，浏览阶段优先使用级联浮层，减少主区闪烁。

### 4.3 两种操作的明确区分

| 操作 | 行为 |
|------|------|
| **跳转 / 查看** | 仅定位（必要时切换到目标 Session），不 fork |
| **从此处续写 / 重问** | 调用 `sessions.fork` 到该边界 → 激活子 Session → 输入框可预填/修改后发送 |

---

## 5. 详细设计

### 5.1 逻辑节点定义

- **切分粒度**：优先按 **Turn**（`turn/start` … `turn/end`），或「用户消息 + 随后助手回合」。
- **稳定键（nodeKey）建议**：
  - `(rootSessionId, boundarySeq)`，或
  - 从根到该节点的路径哈希（便于跨父子 Session 对齐）。
- 父子 Session 在分叉点前必须能对齐到同一逻辑节点，才能正确挂载多叶子。

### 5.2 路径与谱系

- **路径**：左栏主列表 = 当前激活 Session 从根到叶的线性节点序列。
- **谱系**：利用 `SessionHeader.parentSession`、`seedLength` 以及 fork 时的 `boundary` 重建「谁从谁、在哪分出」。
- **角标**：从该逻辑节点可达的叶子 Session 数量（或直接子 fork 数，产品上固定一种统计方式）。

### 5.3 摘要策略

- **节点独立摘要**：只概括本节点（本轮）内容，不把父节点摘要链进 prompt。
- 完整历史始终在主对话区从根阅读原文。
- 生成方式：规则摘要兜底；可选 LLM 增强；失败时降级到规则或原始截断文本。
- 展示：左栏一行；分支下拉标题使用**叶子**摘要。

### 5.4 私有存储

```text
(sessionId, nodeKey) → {
  text: string,
  source: 'rule' | 'llm',
  updatedAt: number
}
```

- 使用插件私有存储（SQLite 或 JSON 文件均可）。
- 与 Session 生命周期联动清理。
- 不重复存储大段原文；能从 log 重算的索引尽量重算，摘要可持久化。

### 5.5 与官方 fork 的关系

- 「从节点续写」= 对该节点对应的 stable boundary 调用 `sessions.fork(source, boundary)`。
- fork 后切换当前 Session，左栏刷新为新路径。
- 一级/二级选择其它已有叶子 = 切换到目标 Session，再在其路径上执行跳转或再次 fork。
- boundary 必须落在稳定点（官方要求不能卡在 open turn 中间），UI 只暴露安全节点。

### 5.6 UI 实现要点

| 项目 | 方案 |
|------|------|
| 主对话区 | 复用官方 Conversation（含 bash/think 折叠） |
| 左栏挂载位置 | 优先在 Conversation 区域内再分一列（参考 Workbench 在右侧加列的模式）；备选使用官方 `details` 列 |
| 分栏与调整 | 中间放置可拖拽 resize handle；支持实时拖拽、松手持久化宽度、双击复位默认比例；左栏可一键折叠 |
| 默认与约束 | 默认宽度比例约 35–40%（或左栏 240–480px 约束）；窗口过窄时自动折叠左栏 |
| 宽度记忆 | 插件私有存储或 localStorage，可按全局或按 Session 记忆；与官方 Sidebar / Details 状态解耦 |
| 样式 | 使用官方 design token；一行 + 图标对齐 tool/think；handle 视觉轻量 |
| 级联交互 | 一级分支列表 + 二级路径浮层；点击确认后再执行跳转/fork，避免悬停误触 |
| 与其他面板共存 | 与官方 Details、Workbench、产物面板等同时存在时，优先保证主对话可读宽度，必要时自动折叠本索引栏 |
| 画布视图 | 非必须；React Flow 等仅作为后续可选总览 |

### 5.7 可复用的官方与社区能力

- 官方：`session/event`、projection、`sessions.fork`、Session 切换、插槽系统、折叠行交互、`ctx.layout` 面板几何与 concession 思路。
- 社区参考：`dsh-trajectory-governance`（多分支投影 + 私有存储 + 官方 fork + 独立 UI）、Workbench 及各类右侧可拖面板（宽度记忆与分栏实践）。

---

## 6. 实现计划

| 阶段 | 交付物 | 说明 |
|------|--------|------|
| **M1** | 当前 Session → 左栏线性节点列表 + 跳转 | 只读投影，验证定位能力 |
| **M2** | 规则摘要 + 简单持久化 | 可先不上 LLM |
| **M3** | 节点上 fork + 切换 Session + 左栏刷新 | 核心闭环（MVP） |
| **M4** | 多叶子角标 + 一级下拉 | 谱系索引 |
| **M5** | 二级完整路径 + 清理 / 重启恢复 | 完整方案 |

**MVP 范围（M1～M3）**：已能实现「索引 → 查看 → 不满意就从某点续写」。  
完整版在 MVP 验证用户真实使用频率后再推进 M4～M5。  
布局动态调整（拖拽 + 记忆 + 折叠）建议在 M1 或 M2 阶段就落地基础能力，避免后期返工。

**预估工期**（结合环境已就绪、有参考插件与 Agent 辅助）：
- MVP：2～3 天合理。
- 完整二级展开 + 稳谱系：再需若干天到约 1～2 周。

---

## 7. 备选方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 同 Session 内 parentId 树（类 Pi） | 不复制前缀，分支更轻 | 与 dsh 官方模型冲突，需改 log | **拒绝** |
| 完全替换官方 Conversation | 交互自由度高 | 维护成本高，容易与官方脱节 | **拒绝**（首期） |
| 仅做 Trajectory 增强 tab | 实现简单 | 导航与续写入口不够直接 | 可作为早期切入点，但非最终形态 |
| 固定 4:6 比例 | 实现简单 | 不适配不同屏幕与多面板共存 | **拒绝** |
| **当前方案（投影 + 官方 fork + 可拖拽左栏）** | 完全兼容官方模型，写路径安全，可渐进增强，布局体验与官方/Workbench 一致 | 前缀会复制（官方已接受），谱系对齐需仔细设计 | **采纳** |

---

## 8. 风险与开放问题

### 风险

1. **逻辑节点跨 Session 对齐**：父子 Session 在分叉点前必须精确对齐，否则角标与二级路径会错乱。
2. **Session 切换机制**：Web UI 激活另一个 Session 的公开 API / 钩子需要确认稳定性。
3. **Developer Preview 变动**：dsh 仍可能有破坏性变更，需严格依赖公开服务与事件。
4. **存储与生命周期**：Session 删除、进程重启后索引与摘要的恢复与清理。
5. **性能**：极深或极多分支时，谱系重建与左栏渲染的开销。
6. **多面板共存**：与 Workbench / Details / 其他右侧插件同时开启时的空间争夺与自动折叠策略。

### 开放问题

1. nodeKey 最终采用哪种稳定方案（boundarySeq vs 路径哈希）？
2. 角标统计「可达叶子数」还是「直接子 fork 数」？
3. 跳转时，同一 Session 内用滚动定位，跨 Session 是否总是切换当前 Session？
4. 左栏最终挂载在 Conversation 内分栏，还是官方 `details` 列？
5. LLM 摘要是否默认开启，还是仅作为可选增强？
6. 宽度记忆按全局还是按 Session？折叠状态是否与宽度分开存储？

---

## 9. 成功指标（建议）

- MVP 可用：用户能在 3 次点击内从任意历史节点完成 fork 续写。
- 投影准确性：跨父子 Session 的节点对齐错误率接近 0。
- 无副作用：插件卸载后官方行为完全不变；不污染 Session log。
- 布局体验：用户可自由拖拽调整索引栏宽度，并在刷新/重开后保持偏好；窄屏下自动折叠不遮挡主对话。
- 用户反馈：减少「因对某轮不满意而整段重开」的频率。

---

## 10. 参考

- 官方文档：`docs/subsystems/session.md`、`docs/architecture.md`、`packages/client/ui-layout/README.md`
- 官方 API：`ctx.sessions.fork(source, boundary?)`、`SessionHeader`（parentSession / seedLength）、`ctx.layout` 面板几何
- 社区先例：`dsh-trajectory-governance`（观察层多分支投影 + 私有存储 + 官方 fork）、Workbench 及各类可拖右侧面板（宽度记忆与分栏实践）
- UI 扩展：client slot 系统（`conversation.view`、sidebar / details 相关槽位等）
