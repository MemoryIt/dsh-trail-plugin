/**
 * M4 谱系计算（纯函数，client 侧）：从会话列表（fork 父链 + 每会话的
 * history 投影值）派生当前会话节点路径上的角标与共享会话列表。
 *
 * 数据来源（官方已提供，无需 host 改动）：
 * - SessionSummary.parentId —— SessionHeader.parentSession（fork 父）
 * - SessionSummary.projectionValues.history —— 该会话的节点树（wire 开放 map）
 *
 * 对齐原理：fork 的 seed 是父会话事件的前缀拷贝（seq 原样保留），子会话节点
 * 与父会话节点的共享前缀可按 boundarySeq（turn/end seq）逐位比对；第一个
 * 不同处即分叉点。多级 fork（B→A→S）由直接比对天然正确。
 */
import type { HistoryNodeEntry } from './types.js'

/** 会话列表行的最小结构（来自 client SessionSummary 字段子集）。 */
export interface LineageSessionLike {
  sessionId: string
  /** fork 父会话（SessionHeader.parentSession）。 */
  parentId?: string
  /** 子代理会话标记（排除在 fork 谱系外）。 */
  origin?: string
  /** 展示标题（下拉用；纯谱系计算忽略）。 */
  displayTitle?: string
  /** 该会话的 history 投影节点（可能缺失/陈旧）。 */
  nodes?: readonly HistoryNodeEntry[]
}

/** 一个节点的谱系：共享该节点的会话 + 角标数。 */
export interface NodeLineage {
  /** 共享该节点的其他会话（含多级后代），保持列表顺序。 */
  sharedSessions: LineageSessionLike[]
  /** 角标数字 = sharedSessions.length（口径：共享该节点的会话数）。 */
  badge: number
}

/** 会话索引。 */
function indexById(sessions: readonly LineageSessionLike[]): Map<string, LineageSessionLike> {
  return new Map(sessions.map((session) => [session.sessionId, session]))
}

/**
 * candidate 是否沿 parentId 链可达 root（严格后代，不含自身）。
 * 环防护：seen 集合中断循环。
 */
export function isDescendantOf(
  sessions: readonly LineageSessionLike[],
  candidateId: string,
  rootId: string,
): boolean {
  const byId = indexById(sessions)
  const seen = new Set<string>()
  let cursor = byId.get(candidateId)?.parentId
  while (cursor !== undefined && !seen.has(cursor)) {
    if (cursor === rootId) return true
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentId
  }
  return false
}

/**
 * 两段节点路径的共享前缀长度：逐位比对 boundarySeq（非 null 相等才算共享，
 * 遇 null 或不等即停）。与节点中心索引（src/history/index.ts）等价的不变量
 * 检验工具：索引按 (rootId, boundarySeq) 分组的结果应与此逐位比对一致。
 */
export function sharedPrefixLength(
  left: readonly HistoryNodeEntry[],
  right: readonly HistoryNodeEntry[],
): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit
    && left[index].boundarySeq !== null
    && left[index].boundarySeq === right[index].boundarySeq) {
    index += 1
  }
  return index
}
