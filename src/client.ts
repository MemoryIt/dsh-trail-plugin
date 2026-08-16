/**
 * dsh-trail-plugin client 半区（History Index）。
 *
 * 打包约定：本文件被 tsc 编译为 `export default function factory(require) {...}`，
 * `scripts/build-client.mjs` 再把它包装成 DSH 浏览器模块加载器 handoff
 * （`window.__ModuleLoader__.load({ id, factory })`），覆盖写回 lib/client.js。
 *
 * M1 数据链路（官方 client 投影路径，无 host RPC）：
 *   官方 ConversationSnapshot（runtime 已从 SessionEvent 组装，天然实时）
 *     → 适配层 mapSnapshot（src/projection.ts 的 ProjectionInput）
 *     → deriveNodes 派生逻辑节点
 *     → 视图渲染
 * 与 ui-conversation 的 StatsLine / ui-deliverables 同构。
 */
import type { Context } from '@deepseek-ai/cordis'
import { deriveNodes, type HistoryNode, type ProjectionInput, type SurfaceNodeLike } from './projection.js'

/** 模块表 require 签名（同步）。 */
type BundleRequire = (spec: string) => unknown

/** 浏览器端 slots 服务的最小结构（与 Slots.listSubTree 契约一致）。 */
interface ClientSlots {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): unknown
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
  useSession: (selector: (snapshot: unknown) => unknown) => unknown
}

/** 快照节点的最小结构（官方类型 ConversationNode 的字段子集）。 */
interface SnapshotNodeLike {
  kind?: string
  seq?: number
  turn?: number
  content?: unknown
  blocks?: unknown
}

/** 提取节点纯文本：user/steering 走 content，assistant 走 blocks。 */
function nodeText(node: SnapshotNodeLike): string {
  const blocks = Array.isArray(node.content)
    ? (node.content as unknown[])
    : Array.isArray(node.blocks)
      ? (node.blocks as unknown[])
      : []
  const parts: string[] = []
  for (const block of blocks) {
    const text = (block as Record<string, unknown> | null)?.text
    if (typeof text === 'string' && text !== '') parts.push(text)
  }
  return parts.join('\n')
}

/** 适配层：官方 ConversationSnapshot → 投影输入。 */
function mapSnapshot(snapshot: unknown): ProjectionInput {
  const value = (snapshot ?? {}) as Record<string, unknown>
  const nodes = Array.isArray(value.nodes) ? (value.nodes as SnapshotNodeLike[]) : []
  const turnEnds = value.turnEnds instanceof Map ? value.turnEnds : new Map<number, number>()
  return {
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
    nodes: nodes.map((node): SurfaceNodeLike => ({
      kind: typeof node.kind === 'string' ? node.kind : 'other',
      seq: typeof node.seq === 'number' ? node.seq : 0,
      turn: typeof node.turn === 'number' ? node.turn : undefined,
      text: nodeText(node),
    })),
    turnEnds,
  }
}

const KIND_ICONS: Record<string, string> = {
  user: '👤',
  assistant: '🤖',
  mixed: '🔀',
  tool: '🔧',
  other: '·',
}

/** 视图组件工厂：History Index 占位页（M1 真实节点数据）。 */
function createHistoryView(React: typeof import('react')) {
  return function HistoryView(props: HistoryViewProps): ReturnType<typeof React.createElement> {
    const snapshot = props.useSession((s: unknown) => s)
    const nodes: HistoryNode[] = deriveNodes(mapSnapshot(snapshot))

    const panelStyle: React.CSSProperties = {
      maxWidth: '480px',
      padding: '16px',
      borderRadius: '10px',
      background: 'var(--dsw-alias-bg-layer-1)',
      border: '1px solid var(--dsw-alias-border-l1)',
    }
    const itemStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '8px',
      padding: '8px 12px',
      marginBottom: '6px',
      borderRadius: '6px',
      background: 'var(--dsw-alias-bg-base)',
      border: '1px solid var(--dsw-alias-border-l1)',
    }
    const metaStyle: React.CSSProperties = {
      marginTop: '2px',
      fontSize: '11px',
      color: 'var(--dsw-alias-label-secondary)',
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
          `M1 数据链路已接通（${nodes.length} 个逻辑节点）`,
        ),
        nodes.length === 0
          ? React.createElement(
            'p',
            { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
            '暂无节点，等待第一条消息',
          )
          : nodes.map((node) => React.createElement(
            'div',
            { key: node.nodeKey, style: itemStyle },
            React.createElement(
              'span',
              { style: { color: 'var(--dsw-alias-brand-primary)', fontSize: '13px' } },
              KIND_ICONS[node.kind] ?? KIND_ICONS.other,
            ),
            React.createElement(
              'div',
              { style: { minWidth: 0 } },
              React.createElement(
                'div',
                {
                  style: {
                    fontSize: '13px',
                    color: 'var(--dsw-alias-label-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                node.summary,
              ),
              React.createElement(
                'div',
                { style: metaStyle },
                `#${node.index} · turn ${node.turn} · seq ${node.startSeq}–${node.endSeq}`
                + (node.boundarySeq === null ? ' · 进行中' : ' · 可 fork'),
              ),
            ),
          )),
      ),
    )
  }
}

/**
 * 浏览器 bundle factory：返回 cordis 插件入口。
 * 在 apply 里把 `history` 视图注册进官方 `conversation.view` 视图环。
 */
export default function factory(require: BundleRequire): PluginEntry {
  const React = require('react') as typeof import('react')

  return {
    name: PLUGIN_NAME,
    apply(ctx: Context) {
      const slots = ctx.get('slots') as ClientSlots | undefined
      if (slots === undefined) return
      slots.inject('conversation.view', () => slots.register(
        { name: 'conversation.view', id: VIEW_ID, order: 20, label: '历史索引' },
        createHistoryView(React),
      ))
    },
  }
}
