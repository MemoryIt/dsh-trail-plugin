/**
 * 节点中心索引（M4 数据层）：把"行（会话节点路径）× 列（位置）"二维结构
 * 转置为以逻辑节点为键的索引。
 *
 * key = `${rootSessionId}:${boundarySeq}`（设计文档 §5.1 的 nodeKey 形态）：
 * - rootSessionId —— 沿官方 parentId 链上溯到本 fork 树的根，消除无关树之间的
 *   seq 命名空间碰撞（两个无关根会话的 turn/end seq 都从 1 开始）；
 * - boundarySeq —— 结构身份：fork 深拷贝保留事件 seq，同一逻辑节点的 turn/end
 *   seq 在整个 fork 树内唯一且位置对齐。
 *
 * 血缘由 key 隐含（同 rootId + 同 boundarySeq 即同一逻辑节点，跨树由 rootId
 * 消歧）：桶内成员就是**共享该逻辑节点的全部会话**（祖先、兄弟、后代都在内）——
 * 例如 A₀→B₀→C₀、A₁→B₁→F、A₂→B₂→C₂→G 中，节点 B 的桶 = {会话0, 会话1, 会话2}。
 */
import { type LineageSessionLike, type NodeLineage } from './lineage.js'
import type { HistoryNodeEntry } from './types.js'

/** 节点中心索引：key → 包含该逻辑节点的会话集合（每会话 + 行内位置）。 */
export type HistoryNodeIndex = Map<string, HistoryNodeIndexEntry[]>

/** 索引条目：一个会话中与该 key 对应的节点。 */
export interface HistoryNodeIndexEntry {
  sessionId: string
  displayTitle?: string
  /** 该节点在会话行内的位置（0-based）。 */
  index: number
  node: HistoryNodeEntry
}

/** 结构身份键：(rootSessionId, boundarySeq)。 */
export function indexNodeKey(rootSessionId: string, boundarySeq: number): string {
  return `${rootSessionId}:${boundarySeq}`
}

function indexById(sessions: readonly LineageSessionLike[]): Map<string, LineageSessionLike> {
  return new Map(sessions.map((session) => [session.sessionId, session]))
}

/**
 * 沿 parentId 链上溯到 fork 树根（环防护）。
 * 父会话不在列表内（如跨 workspace 或已清理）时，当前会话即可见树顶（视为根）。
 */
export function rootOf(sessions: readonly LineageSessionLike[], sessionId: string): string {
  const byId = indexById(sessions)
  const seen = new Set<string>()
  let cursor: string | undefined = sessionId
  let last: string | undefined
  while (cursor !== undefined && !seen.has(cursor)) {
    const current = byId.get(cursor)
    if (current === undefined) break // 父链离开可见集合：当前即为树顶
    last = cursor
    seen.add(cursor)
    cursor = current.parentId
  }
  return last ?? sessionId
}

/**
 * 从会话列表构建节点中心索引。
 * - 排除子代理会话（origin === 'subagent'，非 fork 谱系）；
 * - 排除进行中节点（boundarySeq === null，不可作为分叉点，无结构身份）。
 */
export function buildHistoryIndex(sessions: readonly LineageSessionLike[]): HistoryNodeIndex {
  const index: HistoryNodeIndex = new Map()
  for (const session of sessions) {
    if (session.origin === 'subagent') continue
    const nodes = session.nodes ?? []
    if (nodes.length === 0) continue
    const root = rootOf(sessions, session.sessionId)
    nodes.forEach((node, position) => {
      if (node.boundarySeq === null) return
      const key = indexNodeKey(root, node.boundarySeq)
      const bucket = index.get(key)
      const entry: HistoryNodeIndexEntry = {
        sessionId: session.sessionId,
        displayTitle: session.displayTitle,
        index: position,
        node,
      }
      if (bucket === undefined) index.set(key, [entry])
      else bucket.push(entry)
    })
  }
  return index
}

/**
 * 查询当前会话某个节点的谱系：索引 O(1) 返回**共享该逻辑节点的全部其他会话**
 * （祖先/兄弟/后代都在内，如 A_0→B_0→C_0、A_1→B_1→F、A_2→B_2→C_2→G 中，
 * 在会话 1 看节点 B 会看到会话 0 与 2 两个分叉）。排除自身。
 * 进行中节点（无 boundarySeq）恒返回空谱系。
 * @returns sharedSessions 为解析回完整会话对象的共享会话（含 nodes，供叶子摘要）。
 */
export function lineageForNode(input: {
  currentSessionId: string
  node: HistoryNodeEntry
  sessions: readonly LineageSessionLike[]
  index: HistoryNodeIndex
}): NodeLineage {
  const { currentSessionId, node, sessions, index } = input
  if (node.boundarySeq === null) return { sharedSessions: [], badge: 0 }
  const root = rootOf(sessions, currentSessionId)
  const candidates = index.get(indexNodeKey(root, node.boundarySeq)) ?? []
  const byId = indexById(sessions)
  const sharedSessions = candidates
    .filter((candidate) => candidate.sessionId !== currentSessionId)
    .map((candidate) => byId.get(candidate.sessionId))
    .filter((session): session is LineageSessionLike => session !== undefined)
  return { sharedSessions, badge: sharedSessions.length }
}
