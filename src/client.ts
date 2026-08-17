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
  projectionValues?: Record<string, unknown>
}

/** 会话列表 state 的最小结构。 */
interface SessionListStateLike {
  ids: string[]
  byId: Record<string, SessionSummaryLike>
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
    },
  }
}
