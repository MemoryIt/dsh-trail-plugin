/**
 * History Index 投影单元的折叠逻辑：纯函数，从 SessionEvent 序列增量构造
 * 每个会话的节点树（根→叶路径 + parent 树边）。
 *
 * 契约（与 sessionProjections 框架一致）：
 * - `apply` 纯同步；对无关事件必须返回同一个 state 引用（零下游工作）；
 * - state 是 plain JSON（持久化前置条件），不可变更新；
 * - 同一事件序列重放结果确定（幂等）。
 */
import { appendBounded, extractText, mergeKind } from './text.js'
import { ruleSummary } from './summarize.js'
import type { HistoryIndexState, HistoryNodeEntry, HistoryNodeKind } from './types.js'

/** 事件的最小结构（运行时来自 @deepseek-ai/dsh-session 的 SessionEvent 字段子集）。 */
export interface LogEventLike {
  type: string
  seq: number
  /** Unix epoch 毫秒。 */
  time: number
  data: Record<string, unknown>
}

/** 空 log 的初始状态。 */
export function initHistoryIndex(): HistoryIndexState {
  return { nodes: [] }
}

function nodeKeyOf(turn: number): string {
  return String(turn)
}

/** 当前进行中的节点（最后一个 boundarySeq 为 null 的节点）。 */
function openNode(state: HistoryIndexState): HistoryNodeEntry | undefined {
  for (let i = state.nodes.length - 1; i >= 0; i -= 1) {
    if (state.nodes[i].boundarySeq === null) return state.nodes[i]
  }
  return undefined
}

/** 按 turn 找节点。 */
function nodeForTurn(state: HistoryIndexState, turn: number): HistoryNodeEntry | undefined {
  return state.nodes.find((node) => node.turn === turn)
}

/** 不可变替换/追加：替换节点（按 nodeKey），未命中则追加到尾部。 */
function upsertNode(state: HistoryIndexState, next: HistoryNodeEntry): HistoryIndexState {
  const index = state.nodes.findIndex((node) => node.nodeKey === next.nodeKey)
  if (index === -1) return { ...state, nodes: [...state.nodes, next] }
  if (state.nodes[index] === next) return state
  const nodes = [...state.nodes]
  nodes[index] = next
  return { ...state, nodes }
}

/** 新建一个节点（parent = 当前最后一个节点）。 */
function createNode(state: HistoryIndexState, turn: number, startSeq: number): HistoryNodeEntry {
  const previous = state.nodes[state.nodes.length - 1]
  return {
    nodeKey: nodeKeyOf(turn),
    turn,
    parentKey: previous?.nodeKey ?? null,
    startSeq,
    endSeq: startSeq,
    boundarySeq: null,
    kind: 'other',
    summary: '',
    summarySource: 'rule',
    updatedAt: 0,
    text: '',
    messageSeqs: [],
  }
}

/** 事件的写入目标：优先按 turn 找，其次进行中节点，都没有则现场新建。 */
function targetNode(state: HistoryIndexState, turn: number | undefined, seq: number): HistoryNodeEntry {
  if (turn !== undefined) {
    const byTurn = nodeForTurn(state, turn)
    if (byTurn !== undefined) return byTurn
  }
  const open = openNode(state)
  if (open !== undefined) return open
  const nextTurn = (state.nodes[state.nodes.length - 1]?.turn ?? -1) + 1
  return createNode(state, nextTurn, seq)
}

/**
 * 增量折叠一个已提交事件。无关事件返回同一引用。
 * @param state - 覆盖此前所有事件的 state。
 * @param event - 下一个已提交事件。
 */
export function foldHistoryIndex(state: HistoryIndexState, event: LogEventLike): HistoryIndexState {
  switch (event.type) {
    case 'turn/start': {
      const turn = Number(event.data.turn)
      if (!Number.isInteger(turn) || turn < 0) return state
      if (nodeForTurn(state, turn) !== undefined) return state // 幂等：重放
      return upsertNode(state, createNode(state, turn, event.seq))
    }

    case 'user/message': {
      const node = targetNode(state, undefined, event.seq)
      const text = extractText(event.data.content)
      const summary = node.summary !== '' ? node.summary : ruleSummary(text, '')
      const next: HistoryNodeEntry = {
        ...node,
        endSeq: event.seq,
        kind: mergeKind(node.kind, 'user'),
        summary,
        updatedAt: summary !== node.summary ? event.time : node.updatedAt,
        text: appendBounded(node.text, text),
        messageSeqs: [...node.messageSeqs, event.seq],
      }
      return upsertNode(state, next)
    }

    case 'assistant/message': {
      const node = targetNode(state, Number(event.data.turn), event.seq)
      const text = extractText((event.data.message as Record<string, unknown> | undefined)?.content)
      const summary = node.summary !== '' ? node.summary : ruleSummary('', text)
      const next: HistoryNodeEntry = {
        ...node,
        endSeq: event.seq,
        kind: mergeKind(node.kind, 'assistant'),
        summary,
        updatedAt: summary !== node.summary ? event.time : node.updatedAt,
        text: appendBounded(node.text, text),
        messageSeqs: [...node.messageSeqs, event.seq],
      }
      return upsertNode(state, next)
    }

    case 'tool/call':
    case 'tool/result': {
      const node = targetNode(state, Number(event.data.turn), event.seq)
      const next: HistoryNodeEntry = {
        ...node,
        endSeq: event.seq,
        kind: mergeKind(node.kind, 'tool'),
      }
      return upsertNode(state, next)
    }

    case 'turn/end': {
      const turn = Number(event.data.turn)
      const node = nodeForTurn(state, turn) ?? openNode(state)
      if (node === undefined) return state
      // 幂等：同一 turn 已闭合且边界一致则不再更新。
      if (node.boundarySeq === event.seq) return state
      const next: HistoryNodeEntry = {
        ...node,
        endSeq: event.seq,
        boundarySeq: event.seq,
      }
      return upsertNode(state, next)
    }

    default:
      return state
  }
}

/** 供测试与调试：把一段事件序列折叠到初始状态。 */
export function foldEvents(events: readonly LogEventLike[]): HistoryIndexState {
  return events.reduce(foldHistoryIndex, initHistoryIndex())
}

/** 序列化工具（单测断言用）：折叠后的节点投影视图。 */
export function viewNodes(state: HistoryIndexState): readonly HistoryNodeEntry[] {
  return state.nodes
}

export type { HistoryNodeEntry, HistoryNodeKind }
