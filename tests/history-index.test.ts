import { describe, expect, it } from 'vitest'
import { buildHistoryIndex, indexNodeKey, lineageForNode, rootOf } from '../src/history/index.js'
import { sharedPrefixLength, type LineageSessionLike } from '../src/history/lineage.js'
import type { HistoryNodeEntry } from '../src/history/types.js'

function node(turn: number, boundarySeq: number | null): HistoryNodeEntry {
  return {
    nodeKey: String(turn),
    turn,
    parentKey: turn === 1 ? null : String(turn - 1),
    startSeq: turn * 10,
    endSeq: boundarySeq ?? turn * 10 + 5,
    boundarySeq,
    kind: 'mixed',
    summary: `节点 ${turn}`,
    summarySource: 'rule',
    updatedAt: 0,
    text: '',
    messageSeqs: [],
  }
}

function session(
  sessionId: string,
  parentId: string | undefined,
  turns: number,
  opts: { origin?: string; nodes?: readonly HistoryNodeEntry[] } = {},
): LineageSessionLike {
  return {
    sessionId,
    parentId,
    displayTitle: `会话 ${sessionId}`,
    origin: opts.origin,
    nodes: opts.nodes ?? (turns > 0 ? Array.from({ length: turns }, (_, i) => node(i + 1, (i + 1) * 10)) : []),
  }
}

describe('indexNodeKey', () => {
  it('(rootId, boundarySeq) 拼接为结构身份键', () => {
    expect(indexNodeKey('r1', 10)).toBe('r1:10')
    expect(indexNodeKey('r1', 20)).toBe('r1:20')
  })
})

describe('rootOf', () => {
  const sessions = [
    session('s-root', undefined, 1),
    session('s-a', 's-root', 1),
    session('s-b', 's-a', 1),
  ]

  it('根会话以自身为根，子会话上溯到根', () => {
    expect(rootOf(sessions, 's-root')).toBe('s-root')
    expect(rootOf(sessions, 's-a')).toBe('s-root')
    expect(rootOf(sessions, 's-b')).toBe('s-root')
  })

  it('父缺失时返回可达的最顶层会话', () => {
    expect(rootOf([session('s-orphan', 's-absent', 1)], 's-orphan')).toBe('s-orphan')
  })

  it('环防护：终止且返回环内成员', () => {
    const cyclic = [session('x', 'y', 1), session('y', 'x', 1)]
    expect(['x', 'y']).toContain(rootOf(cyclic, 'x'))
  })
})

describe('buildHistoryIndex', () => {
  it('把共享节点分组到同一 key', () => {
    const parentNodes = [node(1, 10), node(2, 20), node(3, 30)]
    const childNodes = [node(1, 10), node(2, 20), node(4, 40)] // 分叉于节点 2 后
    const sessions = [
      session('s-root', undefined, 0, { nodes: parentNodes }),
      session('s-a', 's-root', 0, { nodes: childNodes }),
    ]
    const index = buildHistoryIndex(sessions)
    expect(index.get('s-root:10')?.map(e => e.sessionId).sort()).toEqual(['s-a', 's-root'])
    expect(index.get('s-root:20')?.map(e => e.sessionId).sort()).toEqual(['s-a', 's-root'])
    expect(index.get('s-root:30')?.map(e => e.sessionId)).toEqual(['s-root'])
    // 位置信息
    const entry = index.get('s-root:20')!.find(e => e.sessionId === 's-a')!
    expect(entry.index).toBe(1)
  })

  it('无关 fork 树不互相污染（rootId 消歧）', () => {
    const sessions = [
      session('r1', undefined, 2),
      session('r2', undefined, 2), // 另一个根，同样的 boundarySeq 10/20
    ]
    const index = buildHistoryIndex(sessions)
    expect(index.get('r1:10')).toHaveLength(1)
    expect(index.get('r2:10')).toHaveLength(1)
  })

  it('子代理会话与进行中节点不入索引', () => {
    const sessions = [
      session('s-root', undefined, 0, { nodes: [node(1, 10), node(2, null)] }), // 第二个进行中
      session('s-sub', 's-root', 0, { nodes: [node(1, 10)], origin: 'subagent' }),
    ]
    const index = buildHistoryIndex(sessions)
    expect(index.get('s-root:10')).toHaveLength(1) // 只有 s-root 自己
    expect(index.has('s-root:null')).toBe(false)
  })
})

describe('lineageForNode', () => {
  it('直系后代：共享节点计数（与 sharedPrefixLength 等价）', () => {
    const rootNodes = [node(1, 10), node(2, 20), node(3, 30)]
    const childNodes = [node(1, 10), node(2, 20), node(4, 40)]
    const sessions = [
      session('s-root', undefined, 0, { nodes: rootNodes }),
      session('s-a', 's-root', 0, { nodes: childNodes }),
    ]
    const index = buildHistoryIndex(sessions)
    // 每个节点：索引口径 == 前缀对齐口径
    for (const n of rootNodes) {
      const viaIndex = lineageForNode({ currentSessionId: 's-root', node: n, sessions, index }).badge
      const viaPrefix = sharedPrefixLength(rootNodes, childNodes) > rootNodes.indexOf(n) ? 1 : 0
      expect(viaIndex).toBe(viaPrefix)
    }
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[0], sessions, index }).badge).toBe(1)
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[2], sessions, index }).badge).toBe(0)
  })

  it('多级 fork 与兄弟分叉', () => {
    const rootNodes = [node(1, 10), node(2, 20), node(3, 30)]
    const childANodes = [node(1, 10), node(2, 20), node(4, 40)]
    const childBNodes = [node(1, 10), node(2, 20), node(3, 30), node(5, 50)]
    const grandNodes = [node(1, 10), node(2, 20), node(4, 40), node(6, 60)] // B 的子
    const sessions = [
      session('s-root', undefined, 0, { nodes: rootNodes }),
      session('s-a', 's-root', 0, { nodes: childANodes }),
      session('s-b', 's-root', 0, { nodes: childBNodes }),
      session('s-c', 's-a', 0, { nodes: grandNodes }),
    ]
    const index = buildHistoryIndex(sessions)
    // 根节点 1：A、B、C 共享 → 角标 3
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[0], sessions, index }).badge).toBe(3)
    // 节点 2：A、B、C 共享 → 3
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[1], sessions, index }).badge).toBe(3)
    // 节点 3：仅 B 共享 → 1
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[2], sessions, index }).badge).toBe(1)
    // 从 A 看：C 是后代，B 不是
    expect(lineageForNode({ currentSessionId: 's-a', node: childANodes[0], sessions, index }).badge).toBe(1)
    expect(lineageForNode({ currentSessionId: 's-a', node: childANodes[1], sessions, index }).badge).toBe(1)
    expect(lineageForNode({ currentSessionId: 's-a', node: childANodes[2], sessions, index }).badge).toBe(1)
    // 进行中节点恒 0
    expect(lineageForNode({ currentSessionId: 's-root', node: node(9, null), sessions, index }).badge).toBe(0)
  })

  it('祖先不算共享（门控为后代）', () => {
    const rootNodes = [node(1, 10), node(2, 20)]
    const childNodes = [node(1, 10), node(2, 20), node(3, 30)]
    const sessions = [
      session('s-root', undefined, 0, { nodes: rootNodes }),
      session('s-child', 's-root', 0, { nodes: childNodes }),
    ]
    const index = buildHistoryIndex(sessions)
    // 从子会话看：父是祖先，不算 → 角标 0
    expect(lineageForNode({ currentSessionId: 's-child', node: childNodes[0], sessions, index }).badge).toBe(0)
    // 从父会话看：子是后代 → 角标 1
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[0], sessions, index }).badge).toBe(1)
  })
})
