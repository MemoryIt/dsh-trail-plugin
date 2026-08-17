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
import type { Context } from '@deepseek-ai/cordis'
import { buildHistoryIndex, lineageForNode } from './history/index.js'
import { type LineageSessionLike } from './history/lineage.js'
import { kindLabel } from './history/text.js'
import type { HistoryIndexState, HistoryNodeEntry } from './history/types.js'

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
}

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
      background: 'var(--dsw-alias-bg-layer-1)',
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
/** 左栏展开宽度（Spike 固定值；拖宽 + 记忆留给后续迭代）。 */
const LEFT_COLUMN_WIDTH = 280
/** 折叠后保留的竖向入口条宽度。 */
const LEFT_COLUMN_RAIL_WIDTH = 28

/** 左栏组件 props：root scope 标准 kit 的 useSessions（无需 session 作用域）。 */
interface LeftColumnProps {
  useSessions: (selector: (state: unknown) => unknown) => unknown
}

/**
 * 真左栏（Spike）：shell.overlay 浮动列 + 会话列内容让位。
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
 * 数据：root scope 标准 kit 的 useSessions —— 当前会话（s.current）+ 会话行
 * 的 projectionValues.history（与 tab 同一条数据通路，重启恢复）。
 */
function createLeftColumn(React: typeof import('react')) {
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
    const visible = current !== undefined && summary !== undefined && summary.blank !== true

    const [collapsed, setCollapsed] = React.useState(false)
    const panelRef = React.useRef<HTMLDivElement | null>(null)

    // 几何 + 让位（layout effect：首帧前定位，避免面板闪现到 (0,0)）。
    // 副作用全部可逆：卸载/隐藏时移除会话列 padding，恢复官方布局。
    React.useLayoutEffect(() => {
      if (!visible) return
      const panel = panelRef.current
      if (panel === null) return
      const overlayLayer = panel.closest('[data-shell-overlay]')
      const frame = overlayLayer?.parentElement ?? null
      const convRoot = document.querySelector<HTMLElement>('[data-slot="conversation"] > div[data-phase]')
      if (frame === null || convRoot === null) return
      const applyLayout = (): void => {
        const frameRect = frame.getBoundingClientRect()
        const convRect = convRoot.getBoundingClientRect()
        panel.style.left = `${convRect.left - frameRect.left}px`
        panel.style.top = `${convRect.top - frameRect.top}px`
        panel.style.height = `${convRect.height}px`
        panel.style.width = `${collapsed ? LEFT_COLUMN_RAIL_WIDTH : LEFT_COLUMN_WIDTH}px`
        convRoot.style.paddingLeft = collapsed ? '' : `${LEFT_COLUMN_WIDTH}px`
      }
      applyLayout()
      const observer = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(applyLayout)
      observer?.observe(convRoot)
      observer?.observe(frame)
      window.addEventListener('resize', applyLayout)
      return () => {
        observer?.disconnect()
        window.removeEventListener('resize', applyLayout)
        convRoot.style.removeProperty('padding-left')
      }
    }, [visible, collapsed])

    if (!visible) return null

    const panelStyle: React.CSSProperties = {
      position: 'absolute',
      top: 0,
      left: 0,
      zIndex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--dsw-alias-bg-layer-1)',
      borderRight: '1px solid var(--dsw-alias-border-l1)',
      boxSizing: 'border-box',
    }
    const railButtonStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: 'none',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '16px',
      cursor: 'pointer',
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
      alignItems: 'flex-start',
      gap: '8px',
      padding: '7px 8px',
      borderRadius: '6px',
      marginBottom: '2px',
    }
    const rowSummaryStyle: React.CSSProperties = {
      fontSize: '12px',
      color: 'var(--dsw-alias-label-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
    const rowMetaStyle: React.CSSProperties = {
      marginTop: '2px',
      fontSize: '10px',
      color: 'var(--dsw-alias-label-secondary)',
    }

    return React.createElement(
      'div',
      {
        ref: panelRef,
        style: { ...panelStyle, width: collapsed ? LEFT_COLUMN_RAIL_WIDTH : LEFT_COLUMN_WIDTH },
      },
      collapsed
        ? React.createElement(
          'button',
          {
            type: 'button',
            style: railButtonStyle,
            title: '展开历史索引',
            onClick: () => setCollapsed(false),
          },
          '»',
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
                onClick: () => setCollapsed(true),
              },
              '«',
            ),
          ),
          React.createElement(
            'div',
            { style: listStyle },
            nodes.length === 0
              ? React.createElement(
                'p',
                { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                '暂无节点，等待第一条消息',
              )
              : nodes.map((node) => React.createElement(
                'div',
                { key: node.nodeKey, style: rowStyle },
                React.createElement(
                  'span',
                  { style: { color: 'var(--dsw-alias-brand-primary)', fontSize: '12px' } },
                  KIND_ICONS[node.kind] ?? KIND_ICONS.other,
                ),
                React.createElement(
                  'div',
                  { style: { minWidth: 0, flex: 1 } },
                  React.createElement(
                    'div',
                    { style: rowSummaryStyle },
                    node.summary !== '' ? node.summary : kindLabel(node.kind),
                  ),
                  React.createElement(
                    'div',
                    { style: rowMetaStyle },
                    `#${node.turn} · seq ${node.startSeq}–${node.endSeq}`
                    + (node.boundarySeq === null ? ' · 进行中' : ' · 可续写'),
                  ),
                ),
              )),
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

  return {
    name: PLUGIN_NAME,
    apply(ctx: Context) {
      const slots = ctx.get('slots') as ClientSlots | undefined
      if (slots === undefined) return
      const sessions = ctx.get('sessions', false) as ClientSessions | undefined
      slots.inject('conversation.view', () => slots.register(
        { name: 'conversation.view', id: VIEW_ID, order: 20, label: '历史索引' },
        createHistoryView(React, sessions),
      ))

      // 真左栏（Spike）：shell.overlay 浮动列 + 会话列内容让位。保留 tab 供对比。
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: LEFT_COLUMN_ID, order: 10, label: '历史索引左栏' },
        createLeftColumn(React),
      ))
    },
  }
}
