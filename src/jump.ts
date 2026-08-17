/**
 * 行内跳转的纯映射逻辑（client 半区，与 React/DOM 无关，可单测）。
 *
 * 目标：把历史节点（一轮）映射到聊天视图中该轮的首行（用户消息）。
 * 聊天行 DOM 自带 `data-chat-anchor-key`（= 会话快照节点 key），滚动容器
 * 是官方 `[data-conversation-scroll]`；本模块只负责「历史节点 → 聊天节点
 * key」，DOM 滚动在 client.ts 侧完成。
 *
 * 对齐依据：历史节点 turn 与聊天节点 location.turn.turn 同源于 turn/start
 * 事件；fork 前缀拷贝保留 turn/seq，跨会话也天然对齐。
 */
export interface JumpChatNodeLike {
  /** 聊天节点 key（= 行 DOM 的 data-chat-anchor-key）。 */
  key: string
  /** 该行的首个事件 seq。 */
  anchorSeq: number
  /** 所属 turn（无 turn 归属的节点用 -1，如 session 级节点）。 */
  turn: number
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
}

/**
 * 解析跳转目标：
 * - 优先取同 turn 内 anchorSeq 最小者（轮首用户消息，与节点摘要口径一致）；
 * - 无 turn 匹配时回退到 anchorSeq ∈ [startSeq, endSeq] 的最小者；
 * - 仍无匹配返回 null（目标未物化/未加载）。
 */
export function resolveJumpTarget(
  historyNode: JumpHistoryNodeLike,
  chatNodes: readonly JumpChatNodeLike[],
): string | null {
  let best: JumpChatNodeLike | null = null
  for (const node of chatNodes) {
    if (node.turn !== historyNode.turn) continue
    if (best === null || node.anchorSeq < best.anchorSeq) best = node
  }
  if (best !== null) return best.key

  let fallback: JumpChatNodeLike | null = null
  for (const node of chatNodes) {
    if (node.anchorSeq < historyNode.startSeq || node.anchorSeq > historyNode.endSeq) continue
    if (fallback === null || node.anchorSeq < fallback.anchorSeq) fallback = node
  }
  return fallback === null ? null : fallback.key
}
