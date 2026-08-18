/**
 * 行内跳转的纯映射逻辑（client 半区，与 React/DOM 无关，可单测）。
 *
 * 目标：把历史节点（一轮）映射到聊天视图中该轮的首行（用户消息）。
 * 聊天行 DOM 自带 `data-chat-anchor-key`（= 会话快照节点 key），滚动容器
 * 是官方 `[data-conversation-scroll]`；本模块只负责「历史节点 → 聊天节点
 * key」，DOM 滚动与扩窗（loadOlder 连点）在 client.ts 侧完成。
 *
 * 对齐依据：历史节点 turn 与聊天节点 location.turn.turn 同源于 turn/start
 * 事件；fork 前缀拷贝保留 turn/seq，跨会话也天然对齐。
 *
 * 可渲染性（与官方 chat 快照契约一致）：ChatView 只渲染 `chat.order`，而
 * order = `orderedVisible(...)`（visibility === 'visible' 过滤）——`chat.nodes`
 * 里存在 hidden 节点（仅 tool-call 无文本的 assistant、被 retry 取代的
 * turn-error），它们没有对应 DOM 行。因此匹配只考虑 visible 节点；hidden
 * 只能在「命中后行不渲染」时暴露，此时才走邻近可见回退。
 */
export interface JumpChatNodeLike {
  /** 聊天节点 key（= 行 DOM 的 data-chat-anchor-key）。 */
  key: string
  /** 该行的首个事件 seq。 */
  anchorSeq: number
  /** 所属 turn（无 turn 归属的节点用 -1，如 session 级节点）。 */
  turn: number
  /** 官方可见性；缺省视为 visible（向后兼容旧测试/旧快照）。 */
  visibility?: 'visible' | 'hidden'
}

export interface JumpHistoryNodeLike {
  turn: number
  startSeq: number
  endSeq: number
}

/** 会话快照聊天节点的最小结构（client 侧映射输入；location 含 turn 归属）。 */
export interface JumpChatNodeRawLike {
  key: string
  anchorSeq: number
  location?: {
    kind?: string
    turn?: { turn: number }
  }
  visibility?: string
}

/** 仅 visible 节点（ChatView 实际渲染的行）。缺省（undefined/未知）视为可见。 */
function isRenderable(node: JumpChatNodeLike): boolean {
  return node.visibility !== 'hidden'
}

/**
 * 精确匹配：同 turn 内 anchorSeq 最小的 visible 节点（轮首用户行）。
 * - 历史节点 turn < 0（compaction 哨兵）跳过本级——无对应 chat 节点；
 * - 只考虑 visible（命中即必然有 DOM 行）；
 * - 无匹配返回 null（调用方应继续 loadOlder 扩窗重试，直到 !hasMore）。
 */
export function matchTarget(
  historyNode: JumpHistoryNodeLike,
  chatNodes: readonly JumpChatNodeLike[],
): string | null {
  if (historyNode.turn < 0) return null
  let best: JumpChatNodeLike | null = null
  for (const node of chatNodes) {
    if (!isRenderable(node) || node.turn !== historyNode.turn) continue
    if (best === null || node.anchorSeq < best.anchorSeq) best = node
  }
  return best === null ? null : best.key
}

/**
 * 邻近可见回退：精确 key 命中但行不渲染（节点为 hidden / 官方未呈现）时，
 * 落到一个真实可渲染的行。优先级（排除 excludeKey）：
 * 1. 同 turn 内次小 anchorSeq 的 visible 节点；
 * 2. anchorSeq ≥ startSeq 的最近 visible 节点（compaction 区间等场景）；
 * 3. 全局最近 visible 节点。
 * 全部不可渲染/空列表返回 null。
 */
export function resolveFallback(
  historyNode: JumpHistoryNodeLike,
  chatNodes: readonly JumpChatNodeLike[],
  excludeKey?: string,
): string | null {
  const candidates = chatNodes.filter((node) => isRenderable(node) && node.key !== excludeKey)
  if (candidates.length === 0) return null

  let sameTurn: JumpChatNodeLike | null = null
  for (const node of candidates) {
    if (historyNode.turn < 0 || node.turn !== historyNode.turn) continue
    if (sameTurn === null || node.anchorSeq < sameTurn.anchorSeq) sameTurn = node
  }
  if (sameTurn !== null) return sameTurn.key

  let after: JumpChatNodeLike | null = null
  for (const node of candidates) {
    if (node.anchorSeq < historyNode.startSeq) continue
    if (after === null || node.anchorSeq < after.anchorSeq) after = node
  }
  if (after !== null) return after.key

  let nearest: JumpChatNodeLike | null = null
  for (const node of candidates) {
    if (nearest === null || node.anchorSeq < nearest.anchorSeq) nearest = node
  }
  return nearest === null ? null : nearest.key
}

/**
 * 已加载窗口内的最小 anchorSeq（= 窗口起点）。
 * 翻页跳转的进度判断：loadOlder 后该值变小才算真的加载到了更早内容
 * （防 loadOlder 守卫空转导致死循环）；空列表返回 null。
 */
export function minAnchorSeq(nodes: readonly JumpChatNodeLike[]): number | null {
  let min: number | null = null
  for (const node of nodes) {
    if (min === null || node.anchorSeq < min) min = node.anchorSeq
  }
  return min
}

/** 跳转失败分类（client 编排用，文案见 jumpFailureMessage）。 */
export type JumpFailureCode = 'VIEW_INACTIVE' | 'TARGET_HIDDEN' | 'NOT_FOUND' | 'TIMEOUT'

/**
 * 失败码 → 用户文案。
 * @param fallback TARGET_HIDDEN 时是否已成功落到邻近可见行。
 */
export function jumpFailureMessage(code: JumpFailureCode, fallback = false): string {
  switch (code) {
    case 'VIEW_INACTIVE':
      return '聊天视图未激活，请先切到聊天'
    case 'TARGET_HIDDEN':
      return fallback
        ? '目标无独立气泡，已定位到邻近内容'
        : '目标节点为隐藏呈现，无法定位到聊天气泡'
    case 'NOT_FOUND':
      return '目标节点未加载或不存在（可能已压缩）'
    case 'TIMEOUT':
      return '加载历史超时，可重试'
  }
}
