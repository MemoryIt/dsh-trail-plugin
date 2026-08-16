/**
 * History Index 投影层：把会话的表面节点（官方 ConversationSnapshot 已组装的
 * 消息/工具节点）投影为「逻辑节点」线性路径（设计文档 §5.1 / §5.3）。
 *
 * 本模块是纯函数、无 DSH 依赖，可独立单测；适配层（src/client.ts）负责把官方
 * 快照映射为 {@link SurfaceNodeLike}。后续若需要 Host 侧投影（M2 摘要持久化、
 * M4 谱系），本模块可直接复用同一套派生逻辑。
 */

/** 逻辑节点类型（决定左栏行图标）。 */
export type HistoryNodeKind = 'user' | 'assistant' | 'mixed' | 'tool' | 'other'

/** 适配层输入：一个表面节点的最小结构。 */
export interface SurfaceNodeLike {
  /** 官方节点 kind（'user' | 'assistant' | 'tool' | 'steering' | ...）。 */
  kind: string
  /** 节点对应的事件 seq。 */
  seq: number
  /** 所属 turn（部分节点没有，如 user/message）。 */
  turn?: number
  /** 适配层已提取的纯文本（摘要用；可省略）。 */
  text?: string
}

/** 投影输入：表面节点 + 已结束 turn 的 turn/end seq。 */
export interface ProjectionInput {
  sessionId: string
  /** 按表面顺序排列的节点。 */
  nodes: readonly SurfaceNodeLike[]
  /** turn -> turn/end 事件 seq（安全 fork 边界，设计文档 §5.5）。 */
  turnEnds: ReadonlyMap<number, number>
}

/** 一个逻辑节点（设计文档 §5.1 / §5.3 的正式结构）。 */
export interface HistoryNode {
  /** 稳定键：(sessionId, boundarySeq)；M4 起用于跨父子 Session 对齐。 */
  nodeKey: string
  /** 根→叶路径中的序号（0-based）。 */
  index: number
  /** 对应 turn。 */
  turn: number
  /** 安全 fork 边界（turn/end seq）；turn 未结束时为 null（不可 fork）。 */
  boundarySeq: number | null
  /** 本节点覆盖的 seq 范围。 */
  startSeq: number
  endSeq: number
  /** 节点类型（决定图标）。 */
  kind: HistoryNodeKind
  /** 规则摘要（首期：文本截断；M2 可升级 LLM 增强）。 */
  summary: string
  /** 摘要来源。 */
  summarySource: 'rule'
  /** 本节点内的消息 seq（跳转定位用）。 */
  messageSeqs: number[]
}

/** 规则摘要的最大字符数。 */
export const SUMMARY_MAX_CHARS = 60

function truncate(text: string, max: number = SUMMARY_MAX_CHARS): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

function nodeKindLabel(kind: string): string {
  switch (kind) {
    case 'user': return '用户消息'
    case 'assistant': return '助手回复'
    case 'tool': return '工具执行'
    case 'steering': return '插入消息'
    case 'context': return '上下文注入'
    case 'compaction': return '上下文压缩'
    case 'command': return '命令'
    default: return `节点（${kind}）`
  }
}

/**
 * 派生当前 Session 根→叶的逻辑节点路径。
 *
 * 分组规则：表面节点按 turn 连续分组——带 `turn` 的节点开新组并吸收之前
 * 未分组的节点（user/message 等不带 turn 的节点挂在紧随其后的 turn 上）；
 * 全部未分组时归入单个 turn 0 组。
 */
export function deriveNodes(input: ProjectionInput): HistoryNode[] {
  const groups = new Map<number, SurfaceNodeLike[]>()
  const order: number[] = []
  let pending: SurfaceNodeLike[] = []
  let lastTurn = -1

  for (const node of input.nodes) {
    if (typeof node.turn === 'number') {
      if (!groups.has(node.turn)) order.push(node.turn)
      groups.set(node.turn, [...(groups.get(node.turn) ?? []), ...pending, node])
      pending = []
      lastTurn = Math.max(lastTurn, node.turn)
    } else {
      pending.push(node)
    }
  }
  if (pending.length > 0) {
    const turn = lastTurn >= 0 ? lastTurn : 0
    if (!groups.has(turn)) order.push(turn)
    groups.set(turn, [...(groups.get(turn) ?? []), ...pending])
  }

  return order.map((turn, index) => {
    const members = groups.get(turn) ?? []
    const first = members[0]
    const last = members[members.length - 1]
    const boundarySeq = input.turnEnds.get(turn) ?? null
    return {
      nodeKey: `${input.sessionId}:${boundarySeq ?? (last?.seq ?? 0)}`,
      index,
      turn,
      boundarySeq,
      startSeq: first?.seq ?? 0,
      endSeq: last?.seq ?? 0,
      kind: deriveKind(members),
      summary: deriveSummary(members),
      summarySource: 'rule',
      messageSeqs: members
        .filter((m) => m.kind === 'user' || m.kind === 'assistant' || m.kind === 'steering')
        .map((m) => m.seq),
    }
  })
}

function deriveKind(members: readonly SurfaceNodeLike[]): HistoryNodeKind {
  let user = false
  let assistant = false
  let tool = false
  let other = false
  for (const member of members) {
    if (member.kind === 'user' || member.kind === 'steering') user = true
    else if (member.kind === 'assistant') assistant = true
    else if (member.kind === 'tool') tool = true
    else other = true
  }
  if (user && assistant) return 'mixed'
  if (user) return 'user'
  if (assistant) return 'assistant'
  if (tool && !other) return 'tool'
  return 'other'
}

function deriveSummary(members: readonly SurfaceNodeLike[]): string {
  // 优先用户消息文本，其次助手文本，最后按节点类型给兜底标签。
  for (const member of members) {
    if ((member.kind === 'user' || member.kind === 'steering')
      && member.text !== undefined && member.text.trim() !== '') {
      return truncate(member.text)
    }
  }
  for (const member of members) {
    if (member.kind === 'assistant'
      && member.text !== undefined && member.text.trim() !== '') {
      return truncate(member.text)
    }
  }
  return nodeKindLabel(members[members.length - 1]?.kind ?? 'other')
}
