/**
 * dsh-trail-plugin client 半区（History Index）。
 *
 * 打包约定：本文件被 tsc 编译为 `export default function factory(require) {...}`，
 * `scripts/build-client.mjs`（esbuild）再把它打成 DSH 浏览器模块加载器 handoff
 * （`window.__ModuleLoader__.load({ id, factory })`），覆盖写回 lib/client.js。
 *
 * 数据链路：
 * - M1~M3：host 投影单元折叠节点树 → 投影缓存 → useProjection('history')
 * - M4：谱系（角标/多叶子）纯 client 派生 —— 会话列表自带 fork 父链
 *   （parentId）与每会话的 history 投影值（projectionValues），
 *   节点中心索引（src/history/index.ts：rootId+boundarySeq → 会话集合）
 *   做 O(1) 候选查询 + parentId 血缘门控，无需 host 改动。
 *
 * 交互：点击节点内联展开；角标（分叉数）点击展开一级下拉（共享会话 +
 * 叶子摘要 + 切换）；boundarySeq 非空的节点可「从这里续写」（sessions.fork）。
 */
import type { ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { buildHistoryIndex, lineageForNode } from './history/index.js'
import { type LineageSessionLike } from './history/lineage.js'
import { kindLabel } from './history/text.js'
import type { HistoryIndexState, HistoryNodeEntry } from './history/types.js'
import { minAnchorSeq, resolveJumpTarget, type JumpChatNodeLike, type JumpChatNodeRawLike } from './jump.js'
import {
  LEFT_COLUMN_DEFAULT_WIDTH, LEFT_COLUMN_MAX_WIDTH, LEFT_COLUMN_MIN_WIDTH, LEFT_COLUMN_RAIL_WIDTH,
  clampColumnWidth, readLeftColumnPrefs, writeLeftColumnPrefs,
  type LeftColumnPrefs,
} from './left-column.js'

/** 模块表 require 签名（同步）。 */
type BundleRequire = (spec: string) => unknown

/** 浏览器端 slots 服务的最小结构（与 Slots.listSubTree 契约一致）。 */
interface ClientSlots {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): unknown
}

/** client 端 sessions 服务的最小结构（官方类型来自 @deepseek-ai/dsh-client-runtime/client）。 */
interface ClientSessions {
  fork(opts: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>
  open(id: string): void
  /** 会话绑定（session 面 = 会话快照可观察源，跳转映射用）。 */
  binding(id: string): { session: SessionFaceLike } | undefined
}

/** 会话快照的最小结构（跳转映射用：chat.nodes.values() + 分页守卫字段）。 */
interface ConversationSnapshotLike {
  chat?: { nodes?: { values(): readonly JumpChatNodeRawLike[] } }
  /** 会话打开状态（分页翻页前置条件；'open' 才可 loadOlder）。 */
  openState?: string
  /** 是否存在更早的窗口外历史。 */
  hasMore?: boolean
}

/** SessionBinding.session 的最小结构（ObservableSnapshot<ConversationSnapshot> + ISession 动词）。 */
interface SessionFaceLike {
  getSnapshot(): ConversationSnapshotLike
  /** 向后翻一页（每页 50 条消息），扩展已加载窗口。 */
  loadOlder(): Promise<void>
}

/** client timer 服务最小结构（瞬态提示自动消失 + 轮询等待）。 */
interface ClientTimer {
  timeout(callback: () => void, delay: number): () => void
  timeout(delay: number): Promise<void>
}

/**
 * 官方 primitives（`@deepseek-ai/dsh-client-ui-primitives`，浏览器模块表
 * external）的最小结构：复用官方 chevron（分叉展开）与 loading 圆环
 * （跳转指示），颜色随 currentColor。模块表不含时（理论降级）由调用方兜底。
 */
interface ClientPrimitives {
  IconChevronDownOutline14?: ComponentType<{ size?: number; className?: string }>
  IconLoadingOutline16?: ComponentType<{ size?: number; className?: string }>
}

/** 行级 loading 圆环的旋转动画（无 CSS 基建，一次性注入 style 标签）。 */
const SPIN_CSS = '@keyframes dsh-trail-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'

/** cordis 插件入口（client 侧）。 */
interface PluginEntry {
  name: string
  apply(ctx: Context): void
}

/** 与 src/index.ts 的 host 插件同名，运行时按入口（./client）区分。 */
const PLUGIN_NAME = 'dsh-trail-plugin'

/** 视图条目 id（出现在会话头部 tab 环里）。 */
const VIEW_ID = 'history'

/** conversation.view 标准 props 的最小结构（官方类型来自 @deepseek-ai/dsh-client-runtime/client）。 */
interface HistoryViewProps {
  sessionId: string
  useProjection: (key: string) => unknown
  useSessions: (selector: (state: unknown) => unknown) => unknown
}

/** SessionSummary 的最小结构（官方类型字段子集）。 */
interface SessionSummaryLike {
  id: string
  displayTitle?: string
  parentId?: string
  origin?: string
  /** 空会话（hero 态）标记：无聊天内容的会话不显示左栏。 */
  blank?: boolean
  projectionValues?: Record<string, unknown>
}

/** 会话列表 state 的最小结构。 */
interface SessionListStateLike {
  ids: string[]
  byId: Record<string, SessionSummaryLike>
  /** 当前激活会话 id（root scope 标准 kit 提供）。 */
  current?: string
}

const KIND_ICONS: Record<string, string> = {
  user: '👤',
  assistant: '🤖',
  mixed: '🔀',
  tool: '🔧',
  other: '·',
}

/** 把会话列表映射为谱系输入（携带 displayTitle 供下拉展示）。 */
function toLineageSessions(state: SessionListStateLike | undefined): LineageSessionLike[] {
  if (state === undefined) return []
  return state.ids.map((id) => {
    const summary = state.byId[id]
    const history = summary?.projectionValues?.history as HistoryIndexState | undefined
    return {
      sessionId: id,
      parentId: summary?.parentId,
      origin: summary?.origin,
      displayTitle: summary?.displayTitle ?? id,
      nodes: history?.nodes,
    }
  })
}

/** 视图组件工厂：History Index（投影数据 + 谱系角标 + 内联展开 + fork 续写）。 */
function createHistoryView(
  React: typeof import('react'),
  sessions: ClientSessions | undefined,
) {
  return function HistoryView(props: HistoryViewProps): ReturnType<typeof React.createElement> {
    const projection = props.useProjection('history') as HistoryIndexState | undefined
    const nodes = projection?.nodes ?? []
    const sessionListState = props.useSessions((s: unknown) => s) as SessionListStateLike | undefined
    const sessionsList = toLineageSessions(sessionListState)
    const historyIndex = buildHistoryIndex(sessionsList)
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
    const [lineageOpen, setLineageOpen] = React.useState<Record<string, boolean>>({})

    const toggle = (nodeKey: string) => {
      setExpanded((prev) => ({ ...prev, [nodeKey]: !prev[nodeKey] }))
    }
    const toggleLineage = (nodeKey: string) => {
      setLineageOpen((prev) => ({ ...prev, [nodeKey]: !prev[nodeKey] }))
    }
    const forkAt = (node: HistoryNodeEntry) => {
      if (sessions === undefined || node.boundarySeq === null) return
      sessions.fork({ sessionId: props.sessionId, atSeq: node.boundarySeq, increaseTitle: true })
        .then((childId) => { sessions.open(childId) })
        .catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[dsh-trail] fork failed:', error)
        })
    }

    const panelStyle: React.CSSProperties = {
      maxWidth: '480px',
      padding: '16px',
      borderRadius: '10px',
      // 主表面 = 官方会话区/面板同款 bg-base（layer-1 是 trajectory/settings
      // 深嵌套专用，常驻面板不用）。
      background: 'var(--dsw-alias-bg-base)',
      border: '1px solid var(--dsw-alias-border-l1)',
    }
    const itemStyle: React.CSSProperties = {
      padding: '8px 12px',
      marginBottom: '6px',
      borderRadius: '6px',
      background: 'var(--dsw-alias-bg-base)',
      border: '1px solid var(--dsw-alias-border-l1)',
      cursor: 'pointer',
    }
    const summaryStyle: React.CSSProperties = {
      fontSize: '13px',
      color: 'var(--dsw-alias-label-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
    const metaStyle: React.CSSProperties = {
      marginTop: '2px',
      fontSize: '11px',
      color: 'var(--dsw-alias-label-secondary)',
    }
    const badgeStyle: React.CSSProperties = {
      padding: '1px 8px',
      fontSize: '11px',
      borderRadius: '10px',
      border: '1px solid var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-brand-primary)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }
    const expandedTextStyle: React.CSSProperties = {
      marginTop: '8px',
      padding: '8px 10px',
      fontSize: '12px',
      lineHeight: '1.6',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-layer-1)',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
    }
    const dropdownStyle: React.CSSProperties = {
      marginTop: '8px',
      padding: '6px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
    }
    const dropdownRowStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 8px',
      borderRadius: '4px',
      cursor: 'pointer',
    }
    const forkButtonStyle: React.CSSProperties = {
      marginTop: '8px',
      padding: '4px 10px',
      fontSize: '12px',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: '6px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      cursor: 'pointer',
    }

    return React.createElement(
      'div',
      { style: { padding: '16px' } },
      React.createElement(
        'div',
        { style: panelStyle },
        React.createElement(
          'h2',
          { style: { margin: '0 0 4px', fontSize: '15px', color: 'var(--dsw-alias-label-primary)' } },
          'History Index',
        ),
        React.createElement(
          'p',
          { style: { margin: '0 0 14px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
          `完整历史索引（${nodes.length} 个逻辑节点 · 来自投影缓存）`,
        ),
        nodes.length === 0
          ? React.createElement(
            'p',
            { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
            '暂无节点，等待第一条消息',
          )
          : nodes.map((node) => {
            const isExpanded = expanded[node.nodeKey] === true
            const nodeLineage = lineageForNode({
              currentSessionId: props.sessionId,
              node,
              sessions: sessionsList,
              index: historyIndex,
            })
            const showBadge = nodeLineage.badge > 0
            const isLineageOpen = lineageOpen[node.nodeKey] === true
            return React.createElement(
              'div',
              { key: node.nodeKey, style: itemStyle, onClick: () => toggle(node.nodeKey) },
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                React.createElement(
                  'span',
                  { style: { color: 'var(--dsw-alias-brand-primary)', fontSize: '13px' } },
                  KIND_ICONS[node.kind] ?? KIND_ICONS.other,
                ),
                React.createElement(
                  'div',
                  { style: { minWidth: 0, flex: 1 } },
                  React.createElement(
                    'div',
                    { style: summaryStyle },
                    node.summary !== '' ? node.summary : kindLabel(node.kind),
                  ),
                  React.createElement(
                    'div',
                    { style: metaStyle },
                    `#${node.turn} · seq ${node.startSeq}–${node.endSeq}`
                    + (node.boundarySeq === null ? ' · 进行中' : ' · 可续写'),
                  ),
                ),
                showBadge
                  ? React.createElement(
                    'span',
                    {
                      style: badgeStyle,
                      onClick: (event: { stopPropagation: () => void }) => {
                        event.stopPropagation()
                        toggleLineage(node.nodeKey)
                      },
                    },
                    `分叉 ${nodeLineage.badge}`,
                  )
                  : null,
                React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                  isExpanded ? '▾' : '▸'),
              ),
              isLineageOpen
                ? React.createElement(
                  'div',
                  { style: dropdownStyle, onClick: (event: { stopPropagation: () => void }) => event.stopPropagation() },
                  nodeLineage.sharedSessions.map((shared) => React.createElement(
                    'div',
                    {
                      key: shared.sessionId,
                      style: dropdownRowStyle,
                      onClick: () => { sessions?.open(shared.sessionId) },
                    },
                    React.createElement(
                      'div',
                      { style: { minWidth: 0, flex: 1 } },
                      React.createElement(
                        'div',
                        { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                        shared.displayTitle ?? shared.sessionId,
                      ),
                      React.createElement(
                        'div',
                        { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                        shared.nodes !== undefined && shared.nodes.length > 0
                          ? `叶子：${shared.nodes[shared.nodes.length - 1].summary || kindLabel(shared.nodes[shared.nodes.length - 1].kind)}`
                          : shared.sessionId,
                      ),
                    ),
                    React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-brand-primary)' } }, '切换'),
                  )),
                )
                : null,
              isExpanded && node.text !== ''
                ? React.createElement('div', { style: expandedTextStyle }, node.text)
                : null,
              isExpanded && node.boundarySeq !== null
                ? React.createElement(
                  'button',
                  {
                    type: 'button',
                    style: forkButtonStyle,
                    onClick: (event: { stopPropagation: () => void }) => {
                      event.stopPropagation()
                      forkAt(node)
                    },
                  },
                  '从这里续写（fork）',
                )
                : null,
            )
          }),
      ),
    )
  }
}

/** 左栏面板条目 id（shell.overlay list 槽）。 */
const LEFT_COLUMN_ID = 'dsh-trail-left-column'

/** 翻页跳转：最多连续翻页数（每页 50 条消息，20 页 ≈ 1000 条，超深历史放弃）。 */
const JUMP_MAX_PAGES = 20
/** 翻页后等待聊天行渲染进 DOM 的超时与轮询间隔。 */
const JUMP_ROW_WAIT_MS = 4000
const JUMP_ROW_POLL_MS = 60

/** 左栏组件 props：root scope 标准 kit 的 useSessions（无需 session 作用域）。 */
interface LeftColumnProps {
  useSessions: (selector: (state: unknown) => unknown) => unknown
}

/**
 * 真左栏：shell.overlay 浮动列 + 会话列内容让位 + 拖拽调宽/记忆。
 *
 * 挂载点：`shell.overlay`（list 槽，replaceRisk none，AppFrame 的
 * `[data-shell-overlay]` 浮层内，`position:absolute; inset:0` 覆盖整个三栏
 * frame）——官方唯一能覆盖会话列的可加性座位，不替换任何官方组件。
 *
 * 布局：
 * - 面板绝对定位到会话列左缘（`[data-slot="conversation"] > div[data-phase]`
 *   的盒），高度随会话列；ResizeObserver 跟随侧栏拖宽/折叠、窗口变化；
 * - 内容让位：把会话列根元素的 padding-left 设为列宽，聊天流/header/composer
 *   整体右移，面板占据左侧条带；卸载/隐藏/折叠时移除 padding 恢复全宽。
 *
 * 拖宽（参考 AppFrame DragHandle：pointer capture；宽度直写 DOM 不走 state）：
 * - 面板右缘 8px 手柄；拖拽中实时写 panel.style.width 与 convRoot paddingLeft
 *   （列表不重渲染），松手一次性 commit 到 localStorage（全局记忆：宽 + 折叠态）；
 * - ResizeObserver 观测 border-box（改 padding 不触发）+ draggingRef 守卫
 *   （拖拽中只跟随 left/top/height），避免回调覆盖拖拽直写；
 * - 钳制 [240, min(480, 可用宽 - 480)]（聊天区至少保 480）；双击手柄复位 280。
 *
 * 数据：root scope 标准 kit 的 useSessions —— 当前会话（s.current）+ 会话行
 * 的 projectionValues.history（与 tab 同一条数据通路，重启恢复）。
 */
function createLeftColumn(
  React: typeof import('react'),
  sessions: ClientSessions | undefined,
  timer: ClientTimer | undefined,
  primitives: ClientPrimitives,
) {
  return function LeftColumn(props: LeftColumnProps): ReturnType<typeof React.createElement> | null {
    const current = props.useSessions((s: unknown) => {
      const state = s as SessionListStateLike | undefined
      return state === undefined ? undefined : state.current
    }) as string | undefined
    const summary = props.useSessions((s: unknown) => {
      const state = s as SessionListStateLike | undefined
      return state === undefined || state.current === undefined ? undefined : state.byId[state.current]
    }) as SessionSummaryLike | undefined
    const nodes = (summary?.projectionValues?.history as HistoryIndexState | undefined)?.nodes ?? []
    // 全量会话列表 → 节点中心索引（谱系角标：共享该逻辑节点的其他会话，
    // 纯 client 派生，与 tab 同一条数据通路；root scope useSessions 自带全量列表）。
    const sessionListState = props.useSessions((s: unknown) => s) as SessionListStateLike | undefined
    const sessionsList = toLineageSessions(sessionListState)
    const historyIndex = buildHistoryIndex(sessionsList)
    const visible = current !== undefined && summary !== undefined && summary.blank !== true

    // 偏好（宽度 + 折叠态）全局记忆。宽度在拖拽中走 ref（直写 DOM），松手后提交。
    const [prefs, setPrefs] = React.useState<LeftColumnPrefs>(() => readLeftColumnPrefs())
    const { collapsed } = prefs
    // 角标下拉展开态（按 nodeKey；点击行首分叉数字/chevron 切换）。
    const [lineageOpen, setLineageOpen] = React.useState<Record<string, boolean>>({})
    // 行 hover 态（行尾「续写」按钮 hover 显现；行首分叉数字 hover 变 chevron 预览）。
    const [hoveredRow, setHoveredRow] = React.useState<string | null>(null)
    // 分支行 hover 态（展开体里分支列表的 hover 高亮，按 sessionId）。
    const [hoveredBranch, setHoveredBranch] = React.useState<string | null>(null)
    // 跳转中指示（行级）：正在翻页/等待渲染的节点 key，结束自动清除。
    const [jumpingNodeKey, setJumpingNodeKey] = React.useState<string | null>(null)
    const widthRef = React.useRef(prefs.width)
    const draggingRef = React.useRef(false)
    const dragStartRef = React.useRef({ x: 0, width: 0, available: 0 })
    const panelRef = React.useRef<HTMLDivElement | null>(null)
    const convRootRef = React.useRef<HTMLElement | null>(null)
    const [handleHovered, setHandleHovered] = React.useState(false)
    // 折叠竖条悬停态（可发现性：竖条本身太窄，hover 高亮提示可展开）。
    const [railHovered, setRailHovered] = React.useState(false)
    // 拖拽中状态（仅起止各一次 setState；拖动中宽度直写 DOM 不触发重渲染）。
    const [dragging, setDragging] = React.useState(false)
    // 瞬态提示（跳转失败原因），1.6s 后自动消失。
    const [hint, setHint] = React.useState<string | null>(null)
    const hintTimerRef = React.useRef<(() => void) | null>(null)

    const showHint = (message: string): void => {
      setHint(message)
      hintTimerRef.current?.()
      hintTimerRef.current = timer === undefined ? null : timer.timeout(() => setHint(null), 1600)
    }

    const commitPrefs = (next: LeftColumnPrefs): void => {
      setPrefs(next)
      writeLeftColumnPrefs(next)
    }
    const toggleCollapsed = (): void => {
      commitPrefs({ width: widthRef.current, collapsed: !collapsed })
    }

    const toggleLineage = (nodeKey: string): void => {
      setLineageOpen((prev) => ({ ...prev, [nodeKey]: !prev[nodeKey] }))
    }
    // 行尾「续写」：官方 fork 到该节点边界 → 打开子会话。左栏随 current
    // 变化自动刷新为新会话路径（渲染协调已就位，无需额外处理）。
    const forkAt = (node: HistoryNodeEntry): void => {
      if (sessions === undefined || current === undefined || node.boundarySeq === null) return
      sessions.fork({ sessionId: current, atSeq: node.boundarySeq, increaseTitle: true })
        .then((childId) => { sessions?.open(childId) })
        .catch((error: unknown) => { showHint(`续写失败：${String(error)}`) })
    }

    // 行内跳转（异步，含分页兜底）：
    // 历史节点 → 会话快照 → 聊天节点 key（resolveJumpTarget）；目标不在已
    // 加载窗口时逐页 session.loadOlder() 翻页直到找到或无法再翻（hasMore /
    // openState / 窗口起点进度三重守卫）；然后等聊天行渲染进 DOM
    // （data-chat-anchor-key）→ scrollIntoView（滚动口是官方
    // [data-conversation-scroll]）。失败给瞬态提示，不做任何写操作。
    const jumpGenRef = React.useRef(0)

    const findChatRow = (key: string): HTMLElement | null => {
      for (const candidate of Array.from(document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]'))) {
        if (candidate.dataset.chatAnchorKey === key) return candidate
      }
      return null
    }
    const sleep = (ms: number): Promise<void> => timer === undefined
      ? new Promise((resolve) => { window.setTimeout(resolve, ms) })
      : timer.timeout(ms)

    const jumpToNode = (node: HistoryNodeEntry): void => {
      if (sessions === undefined || current === undefined) return
      // 聊天视图未挂载（切到 trajectory 等）→ 直接提示，避免白翻页。
      if (document.querySelector('[data-chat-flow]') === null) {
        showHint('聊天视图未激活，请先切到聊天')
        return
      }
      const gen = jumpGenRef.current + 1
      jumpGenRef.current = gen
      // 行级跳转指示：翻页/等待渲染期间给用户缓冲反馈（最新一次跳转接管）。
      setJumpingNodeKey(node.nodeKey)
      // 结束路径统一清除：仅最新跳转（gen 未失效）负责清除，被覆盖时
      // 由新跳转接管（避免旧跳转闪掉新指示）。
      const finishJump = (): void => {
        if (gen === jumpGenRef.current) setJumpingNodeKey(null)
      }
      void (async () => {
        // 快照 → 候选列表（turn/seq 对齐映射）
        const readCandidates = (): JumpChatNodeLike[] | null => {
          const snapshot = sessions?.binding(current)?.session?.getSnapshot()
          const chatNodes = snapshot?.chat?.nodes
          if (chatNodes === undefined) return null
          return chatNodes.values().map((n) => ({
            key: n.key,
            anchorSeq: n.anchorSeq,
            turn: n.location?.kind === 'turn' || n.location?.kind === 'step'
              ? n.location.turn?.turn ?? -1
              : -1,
          }))
        }
        // 目标不在已加载窗口 → 逐页 loadOlder 翻页直到找到或无法再翻。
        const resolveWithPaging = async (): Promise<string | null> => {
          for (let attempt = 0; attempt <= JUMP_MAX_PAGES; attempt += 1) {
            const face = sessions?.binding(current)?.session
            const candidates = readCandidates()
            if (candidates === null || face === undefined) return null
            const key = resolveJumpTarget(node, candidates)
            if (key !== null) return key
            if (attempt === JUMP_MAX_PAGES) return null
            const snapshot = face.getSnapshot()
            if (snapshot.openState !== 'open' || snapshot.hasMore !== true) return null
            const before = minAnchorSeq(candidates)
            await face.loadOlder()
            if (gen !== jumpGenRef.current) return null
            const after = minAnchorSeq(readCandidates() ?? [])
            if (after === null || (before !== null && after >= before)) return null
          }
          return null
        }
        const key = await resolveWithPaging()
        if (gen !== jumpGenRef.current) return
        if (key === null) {
          finishJump()
          showHint('目标节点未加载或不存在')
          return
        }
        // 等行渲染进 DOM（翻页后 React 异步提交新行），超时给提示。
        let row: HTMLElement | null = null
        for (let waited = 0; waited <= JUMP_ROW_WAIT_MS; waited += JUMP_ROW_POLL_MS) {
          row = findChatRow(key)
          if (row !== null) break
          if (waited >= JUMP_ROW_WAIT_MS) break
          await sleep(JUMP_ROW_POLL_MS)
          if (gen !== jumpGenRef.current) return
        }
        if (gen !== jumpGenRef.current) return
        if (row === null) {
          finishJump()
          showHint('聊天视图未激活，请先切到聊天')
          return
        }
        finishJump()
        row.scrollIntoView({ block: 'start' })
      })()
    }

    // 几何 + 让位（layout effect：首帧前定位，避免面板闪现到 (0,0)）。
    // 副作用全部可逆：卸载/隐藏时移除会话列 padding，恢复官方布局。
    //
    // 渲染协调性（关键）：conversation 槽位是 session-maybe，会话切换时其内容
    // 按 epoch 重挂载（DOM 节点被替换）。若 effect 闭包缓存了 convRoot/panel
    // 引用，切换后这些引用指向 detached 节点——RO 永不触发、几何读取全 0，
    // 侧栏开合等布局变化全部失联（"关闭侧栏竖条不回来"即此）。
    // 因此：deps 含 current（切换即重跑重建 RO），且每次读取都实时查询节点。
    React.useLayoutEffect(() => {
      if (!visible) return
      const resolveNodes = (): { panel: HTMLDivElement; frame: HTMLElement; convRoot: HTMLElement } | null => {
        const panel = panelRef.current
        if (panel === null) return null
        const frame = panel.closest('[data-shell-overlay]')?.parentElement ?? null
        const convRoot = document.querySelector<HTMLElement>('[data-slot="conversation"] > div[data-phase]')
        if (frame === null || convRoot === null) return null
        return { panel, frame, convRoot }
      }
      const nodes = resolveNodes()
      if (nodes === null) return
      convRootRef.current = nodes.convRoot
      let geometryRaf: number | null = null
      let retries = 0
      const applyLayout = (): void => {
        const live = resolveNodes()
        if (live === null) return
        const { panel, frame, convRoot } = live
        const frameRect = frame.getBoundingClientRect()
        const convRect = convRoot.getBoundingClientRect()
        // 布局未就绪（0 高度 = 不可信几何）：下帧重试，最多 20 帧（约 1/3s）。
        if (convRect.height <= 0) {
          if (retries < 20) {
            retries += 1
            geometryRaf = requestAnimationFrame(applyLayout)
          }
          return
        }
        retries = 0
        panel.style.left = `${convRect.left - frameRect.left}px`
        panel.style.top = `${convRect.top - frameRect.top}px`
        panel.style.height = `${convRect.height}px`
        // 拖拽中宽度由拖拽循环直写；这里只跟随几何。
        if (!draggingRef.current) {
          const expanded = collapsed
            ? LEFT_COLUMN_RAIL_WIDTH
            : clampColumnWidth(widthRef.current, convRect.width)
          if (!collapsed) widthRef.current = expanded
          panel.style.width = `${expanded}px`
          convRoot.style.paddingLeft = collapsed ? '' : `${expanded}px`
        }
      }
      applyLayout()
      // 首帧布局完成后再跑一次，修正 commit 时刻的 0/错位几何。
      geometryRaf = requestAnimationFrame(applyLayout)
      const observer = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(applyLayout)
      // border-box：改 padding 不触发回调，避免与拖拽直写打架。
      observer?.observe(nodes.convRoot, { box: 'border-box' })
      observer?.observe(nodes.frame)
      window.addEventListener('resize', applyLayout)
      // 位置漂移自愈：RO 对 grid 列过渡（侧栏开合）等时序不可靠，低频轮询
      // 校验面板 left 是否漂移出会话列左缘，漂移则重新定位（实时查询节点，
      // 覆盖节点替换后的引用过期）。
      const driftTimer = window.setInterval(() => {
        if (draggingRef.current) return
        const live = resolveNodes()
        if (live === null) return
        const { panel, frame, convRoot } = live
        const frameRect = frame.getBoundingClientRect()
        const convRect = convRoot.getBoundingClientRect()
        if (convRect.height <= 0) return
        const expectedLeft = convRect.left - frameRect.left
        const currentLeft = Number.parseFloat(panel.style.left ?? '')
        if (Number.isNaN(currentLeft) || Math.abs(currentLeft - expectedLeft) > 1) {
          applyLayout()
        }
      }, 250)
      return () => {
        window.clearInterval(driftTimer)
        if (geometryRaf !== null) cancelAnimationFrame(geometryRaf)
        observer?.disconnect()
        window.removeEventListener('resize', applyLayout)
        convRootRef.current = null
        // 清理当前会话列的 padding（实时查询，卸载时也能清到最新节点）。
        document.querySelector<HTMLElement>('[data-slot="conversation"] > div[data-phase]')
          ?.style.removeProperty('padding-left')
        hintTimerRef.current?.()
      }
    }, [visible, collapsed, current])

    // 拖宽：指针捕获后，pointermove 直写面板宽 + 会话列 paddingLeft。
    const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      draggingRef.current = true
      setDragging(true)
      const convRoot = convRootRef.current
      dragStartRef.current = {
        x: e.clientX,
        width: widthRef.current,
        available: convRoot === null ? widthRef.current : convRoot.getBoundingClientRect().width,
      }
    }
    const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!draggingRef.current) return
      const panel = panelRef.current
      const convRoot = convRootRef.current
      if (panel === null || convRoot === null) return
      const { x, width, available } = dragStartRef.current
      const next = clampColumnWidth(width + e.clientX - x, available)
      widthRef.current = next
      panel.style.width = `${next}px`
      convRoot.style.paddingLeft = `${next}px`
    }
    const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setDragging(false)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      commitPrefs({ width: widthRef.current, collapsed })
    }
    // 兜底：指针在窗口外释放/捕获被取消时同样提交。
    const onHandleLostCapture = (): void => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setDragging(false)
      commitPrefs({ width: widthRef.current, collapsed })
    }
    const onHandleDoubleClick = (): void => {
      const panel = panelRef.current
      const convRoot = convRootRef.current
      widthRef.current = LEFT_COLUMN_DEFAULT_WIDTH
      if (panel !== null) panel.style.width = `${LEFT_COLUMN_DEFAULT_WIDTH}px`
      if (convRoot !== null) convRoot.style.paddingLeft = `${LEFT_COLUMN_DEFAULT_WIDTH}px`
      commitPrefs({ width: LEFT_COLUMN_DEFAULT_WIDTH, collapsed })
    }

    if (!visible) return null

    const panelStyle: React.CSSProperties = {
      position: 'absolute',
      top: 0,
      left: 0,
      // 初始高度 = 浮层全高：即使几何 effect 因竞态未就绪，面板也不至于 0 高度
      // 不可见（effect 就绪后会覆盖为会话列精确高度）。
      height: '100%',
      zIndex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      // 主表面 = 官方会话区/面板同款 bg-base；展开体同为 bg-base + 边框，
      // 两者同底，靠 border/缩进区分层级（官方 ioCard 模式）。
      background: 'var(--dsw-alias-bg-base)',
      borderRight: '1px solid var(--dsw-alias-border-l1)',
      boxSizing: 'border-box',
    }
    // 折叠竖条：窄条 + 图标 + 竖排"历史"文字 + 悬停高亮，避免被误认为 UI 残留。
    const railButtonStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      border: 'none',
      background: railHovered ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
      transition: 'background 120ms ease',
    }
    const railIconStyle: React.CSSProperties = {
      fontSize: '16px',
      lineHeight: 1,
      color: 'var(--dsw-alias-brand-primary)',
    }
    const railTextStyle: React.CSSProperties = {
      fontSize: '10px',
      writingMode: 'vertical-rl',
      letterSpacing: '2px',
      userSelect: 'none',
    }
    // 拖宽手柄：面板右缘 8px 命中条（仿 AppFrame 手柄；展开态渲染）。
    const handleStyle: React.CSSProperties = {
      position: 'absolute',
      top: 0,
      bottom: 0,
      right: 0,
      width: 8,
      cursor: 'col-resize',
      touchAction: 'none',
      zIndex: 2,
    }
    const handlePillStyle: React.CSSProperties = {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 3,
      height: 32,
      borderRadius: 2,
      background: 'var(--dsw-alias-border-l3)',
      opacity: handleHovered || dragging ? 1 : 0,
      transition: 'opacity 120ms ease',
    }
    const headerStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 12px 8px',
      borderBottom: '1px solid var(--dsw-alias-border-l1)',
    }
    const titleStyle: React.CSSProperties = {
      margin: 0,
      flex: 1,
      minWidth: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--dsw-alias-label-primary)',
      whiteSpace: 'nowrap',
    }
    const countStyle: React.CSSProperties = {
      flex: 'none',
      fontSize: '11px',
      color: 'var(--dsw-alias-label-secondary)',
    }
    const toggleButtonStyle: React.CSSProperties = {
      flex: 'none',
      padding: '2px 6px',
      border: 'none',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '14px',
      cursor: 'pointer',
    }
    const listStyle: React.CSSProperties = {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: '8px',
    }
    const rowStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '2px 8px',
      borderRadius: '6px',
      marginBottom: '2px',
      cursor: 'pointer',
    }
    const hintStyle: React.CSSProperties = {
      padding: '6px 12px',
      fontSize: '11px',
      color: 'var(--dsw-alias-label-secondary)',
      background: 'var(--dsw-alias-bg-base)',
      borderBottom: '1px solid var(--dsw-alias-border-l1)',
    }
    // 单行标题（对齐官方 DisclosureRow 的 title 行）：14px 感 + 截断。
    const rowTitleStyle: React.CSSProperties = {
      flex: 1,
      minWidth: 0,
      fontSize: '13px',
      lineHeight: '20px',
      color: 'var(--dsw-alias-label-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
    // 行根（column）：标题行 + 展开体纵向堆叠 —— 展开体是行的下方兄弟，
    // 不参与行内横向 flex，行高恒定（对齐官方 DisclosureRow 的 root 骨架）。
    const rowRootStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      marginBottom: '2px',
      borderRadius: '6px',
    }
    // 行首 leading slot（16px，对齐官方 DisclosureRow）：分叉数字按钮。
    // 折叠态显示分叉数字，hover / 展开态显示官方 chevron（v 型下拉提示）。
    const leadingButtonStyle: React.CSSProperties = {
      flex: 'none',
      width: 16,
      height: 16,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      padding: 0,
      border: 'none',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
    }
    const forkCountStyle: React.CSSProperties = {
      fontSize: '11px',
      lineHeight: 1,
      fontWeight: 600,
      color: 'var(--dsw-alias-brand-primary)',
    }
    // 行尾操作簇（仅剩「续写」按钮）。
    const rowActionsStyle: React.CSSProperties = {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    }
    // 「续写」按钮：hover 显现（opacity/pointerEvents 随行 hover 态切换）；
    // 外观对齐官方 tool 行的 Inspect pill（radius 999px + l2 边框 + base 底）。
    const forkButtonStyle: React.CSSProperties = {
      padding: '2px 8px',
      fontSize: '11px',
      lineHeight: '16px',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: '999px',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'opacity 120ms ease',
    }
    // 行级跳转指示（跳转中）：官方 loading 圆环 + 旋转动画，替换续写按钮位置。
    const spinnerStyle: React.CSSProperties = {
      flex: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--dsw-alias-label-secondary)',
      animation: 'dsh-trail-spin 0.9s linear infinite',
    }
    // 展开体（行下方兄弟）：只靠缩进区分层级，无卡片线框/背景
    // （叶子行与左栏同底，hover 高亮即交互提示）。
    const bodyWrapStyle: React.CSSProperties = {
      marginLeft: 20,
      padding: '2px 0',
    }
    // 分支行（展开体里的共享会话）：与节点行同款单行风格 ——
    // 只展示叶子摘要（fork 标题多为「旧标题+数字后缀」无辨识度），
    // 整行点击即跳转到该分支会话。
    const branchRowStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '2px 8px',
      borderRadius: '6px',
      marginBottom: '2px',
      cursor: 'pointer',
    }

    return React.createElement(
      'div',
      {
        ref: panelRef,
        // 渲染宽度读 ref：拖拽中的直写值在任意重渲染（会话更新等）下保持，
        // 不会被未提交的 prefs 拉回。
        style: { ...panelStyle, width: collapsed ? LEFT_COLUMN_RAIL_WIDTH : widthRef.current },
      },
      // 行级 loading 圆环的旋转动画（无 CSS 基建，静态注入一次）。
      React.createElement('style', null, SPIN_CSS),
      collapsed
        ? React.createElement(
          'button',
          {
            type: 'button',
            style: railButtonStyle,
            title: '展开历史索引',
            onClick: toggleCollapsed,
            onPointerEnter: () => setRailHovered(true),
            onPointerLeave: () => setRailHovered(false),
          },
          React.createElement('span', { style: railIconStyle }, '☰'),
          React.createElement('span', { style: railTextStyle }, '历史'),
        )
        : React.createElement(
          React.Fragment,
          null,
          React.createElement(
            'div',
            { style: headerStyle },
            React.createElement('h2', { style: titleStyle }, 'History Index'),
            React.createElement('span', { style: countStyle }, `${nodes.length} 个逻辑节点`),
            React.createElement(
              'button',
              {
                type: 'button',
                style: toggleButtonStyle,
                title: '折叠左栏',
                onClick: toggleCollapsed,
              },
              '«',
            ),
          ),
          hint !== null
            ? React.createElement('div', { style: hintStyle }, hint)
            : null,
          React.createElement(
            'div',
            { style: listStyle },
            nodes.length === 0
              ? React.createElement(
                'p',
                { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                '暂无节点，等待第一条消息',
              )
              : nodes.map((node) => {
                const nodeLineage = lineageForNode({
                  currentSessionId: current as string,
                  node,
                  sessions: sessionsList,
                  index: historyIndex,
                })
                const showBadge = nodeLineage.badge > 0
                const isLineageOpen = lineageOpen[node.nodeKey] === true
                const rowHovered = hoveredRow === node.nodeKey
                const forkable = node.boundarySeq !== null
                // 行首 leading：分叉数字（hover/展开时变官方 chevron，v 型下拉提示）。
                const chevronEl = primitives.IconChevronDownOutline14 !== undefined
                  ? React.createElement(primitives.IconChevronDownOutline14, { size: 14 })
                  : React.createElement(
                    'span',
                    { style: { ...forkCountStyle, color: 'var(--dsw-alias-label-secondary)' } },
                    '▾',
                  )
                return React.createElement(
                  'div',
                  {
                    key: node.nodeKey,
                    // 行根 column（对齐官方 DisclosureRow）：标题行 + 展开体
                    // 纵向堆叠；展开体是行的下方兄弟，行高恒定不被撑开。
                    style: rowRootStyle,
                  },
                  React.createElement(
                    'div',
                    {
                      // 单行标题行（对齐官方 DisclosureRow 的 .row：24px 感），
                      // hover 高亮背景（官方列表行同款 interactive-bg-hover）。
                      style: {
                        ...rowStyle,
                        background: rowHovered
                          ? 'var(--dsw-alias-interactive-bg-hover)'
                          : 'transparent',
                      },
                      title: node.text !== '' ? node.text : undefined,
                      onClick: () => jumpToNode(node),
                      onPointerEnter: () => setHoveredRow(node.nodeKey),
                      onPointerLeave: () => setHoveredRow((prev) => (prev === node.nodeKey ? null : prev)),
                    },
                    showBadge
                      ? React.createElement(
                        'button',
                        {
                          type: 'button',
                          style: leadingButtonStyle,
                          title: '查看共享该节点的分叉会话',
                          'aria-expanded': isLineageOpen,
                          onClick: (event: { stopPropagation: () => void }) => {
                            event.stopPropagation()
                            toggleLineage(node.nodeKey)
                          },
                        },
                        rowHovered || isLineageOpen
                          ? chevronEl
                          : React.createElement(
                            'span',
                            { style: forkCountStyle },
                            String(nodeLineage.badge),
                          ),
                      )
                      : null,
                    React.createElement(
                      'span',
                      { style: rowTitleStyle },
                      node.summary !== '' ? node.summary : kindLabel(node.kind),
                    ),
                    React.createElement(
                      'div',
                      { style: rowActionsStyle },
                      jumpingNodeKey === node.nodeKey
                        // 跳转中：行尾显示官方 loading 圆环（缓冲反馈），
                        // 结束后恢复续写按钮。
                        ? React.createElement(
                          'span',
                          { style: spinnerStyle, title: '正在跳转到该节点…' },
                          primitives.IconLoadingOutline16 !== undefined
                            ? React.createElement(primitives.IconLoadingOutline16, { size: 14 })
                            : React.createElement('span', { style: { fontSize: '12px' } }, '…'),
                        )
                        : forkable
                          ? React.createElement(
                            'button',
                            {
                              type: 'button',
                              style: {
                                ...forkButtonStyle,
                                opacity: rowHovered ? 1 : 0,
                                pointerEvents: rowHovered ? 'auto' : 'none',
                              },
                              title: '从该节点 fork 出新会话继续',
                              onClick: (event: { stopPropagation: () => void }) => {
                                event.stopPropagation()
                                forkAt(node)
                              },
                            },
                            '续写',
                          )
                          : null,
                    ),
                  ),
                  isLineageOpen && nodeLineage.sharedSessions.length > 0
                    ? React.createElement(
                      'div',
                      {
                        style: bodyWrapStyle,
                        onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
                      },
                      nodeLineage.sharedSessions.map((shared) => {
                        // 分支行内容 = 叶子摘要（该分支最后一个节点的摘要）；
                        // fork 标题多为「旧标题+数字后缀」，不展示。
                        const leaf = shared.nodes !== undefined && shared.nodes.length > 0
                          ? shared.nodes[shared.nodes.length - 1].summary || kindLabel(shared.nodes[shared.nodes.length - 1].kind)
                          : shared.sessionId
                        const branchHovered = hoveredBranch === shared.sessionId
                        return React.createElement(
                          'div',
                          {
                            key: shared.sessionId,
                            style: {
                              ...branchRowStyle,
                              background: branchHovered
                                ? 'var(--dsw-alias-interactive-bg-hover)'
                                : 'transparent',
                            },
                            title: `跳转到该分支：${leaf}`,
                            onClick: () => { sessions?.open(shared.sessionId) },
                            onPointerEnter: () => setHoveredBranch(shared.sessionId),
                            onPointerLeave: () => setHoveredBranch((prev) => (prev === shared.sessionId ? null : prev)),
                          },
                          React.createElement('span', { style: rowTitleStyle }, leaf),
                        )
                      }),
                    )
                    : null,
                )
              }),
          ),
          // 拖宽手柄：指针捕获 + 直写宽度；双击复位默认宽。
          React.createElement(
            'div',
            {
              style: handleStyle,
              title: '拖拽调整宽度（双击复位 280px）',
              onPointerDown: onHandlePointerDown,
              onPointerMove: onHandlePointerMove,
              onPointerUp: onHandlePointerUp,
              onLostPointerCapture: onHandleLostCapture,
              onDoubleClick: onHandleDoubleClick,
              onPointerEnter: () => setHandleHovered(true),
              onPointerLeave: () => setHandleHovered(false),
            },
            React.createElement('div', { style: handlePillStyle }),
          ),
        ),
    )
  }
}

/**
 * 浏览器 bundle factory：返回 cordis 插件入口。
 * 在 apply 里把 `history` 视图注册进官方 `conversation.view` 视图环，
 * 并捕获 client sessions 服务（fork / open 用）。
 */
export default function factory(require: BundleRequire): PluginEntry {
  const React = require('react') as typeof import('react')
  // 官方 primitives（浏览器模块表 external）：只复用官方 chevron 元素，
  // 与官方 tool 行设计语言一致。缺失时（异常环境）降级为纯文本 ▾。
  const primitives = (require('@deepseek-ai/dsh-client-ui-primitives')
    ?? {}) as ClientPrimitives

  return {
    name: PLUGIN_NAME,
    apply(ctx: Context) {
      const slots = ctx.get('slots') as ClientSlots | undefined
      if (slots === undefined) return
      const sessions = ctx.get('sessions', false) as ClientSessions | undefined
      const timer = ctx.get('timer', false) as ClientTimer | undefined
      slots.inject('conversation.view', () => slots.register(
        { name: 'conversation.view', id: VIEW_ID, order: 20, label: '历史索引' },
        createHistoryView(React, sessions),
      ))

      // 真左栏：shell.overlay 浮动列 + 内容让位 + 拖宽/记忆 + 行内跳转。保留 tab 供对比。
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: LEFT_COLUMN_ID, order: 10, label: '历史索引左栏' },
        createLeftColumn(React, sessions, timer, primitives),
      ))
    },
  }
}
