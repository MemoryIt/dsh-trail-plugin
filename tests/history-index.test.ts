import { describe, expect, it } from 'vitest'
import { buildHistoryIndex, indexNodeKey, lineageForNode, rootOf } from '../src/history/index.js'
import type { LineageSessionLike } from '../src/history/lineage.js'
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
  it('共享节点计数：同一逻辑节点的全部其他会话（与位置对齐等价）', () => {
    const rootNodes = [node(1, 10), node(2, 20), node(3, 30)]
    const childNodes = [node(1, 10), node(2, 20), node(4, 40)]
    const sessions = [
      session('s-root', undefined, 0, { nodes: rootNodes }),
      session('s-a', 's-root', 0, { nodes: childNodes }),
    ]
    const index = buildHistoryIndex(sessions)
    // 每个节点：索引口径 == 同 root + 同位 boundarySeq 相等
    for (const n of rootNodes) {
      const viaIndex = lineageForNode({ currentSessionId: 's-root', node: n, sessions, index }).badge
      const position = rootNodes.indexOf(n)
      const viaPosition = childNodes[position]?.boundarySeq === n.boundarySeq ? 1 : 0
      expect(viaIndex).toBe(viaPosition)
    }
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[0], sessions, index }).badge).toBe(1)
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[2], sessions, index }).badge).toBe(0)
  })

  it('多级 fork 与兄弟分叉', () => {
    const rootNodes = [node(1, 10), node(2, 20), node(3, 30)]
    const childANodes = [node(1, 10), node(2, 20), node(4, 40)]
    const childBNodes = [node(1, 10), node(2, 20), node(3, 30), node(5, 50)]
    const grandNodes = [node(1, 10), node(2, 20), node(4, 40), node(6, 60)] // C 是 A 的子
    const sessions = [
      session('s-root', undefined, 0, { nodes: rootNodes }),
      session('s-a', 's-root', 0, { nodes: childANodes }),
      session('s-b', 's-root', 0, { nodes: childBNodes }),
      session('s-c', 's-a', 0, { nodes: grandNodes }),
    ]
    const index = buildHistoryIndex(sessions)
    // 从根看：节点 1/2 被 A、B、C 共享 → 角标 3；节点 3 仅 B → 1
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[0], sessions, index }).badge).toBe(3)
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[1], sessions, index }).badge).toBe(3)
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[2], sessions, index }).badge).toBe(1)
    // 从 A 看：节点 1/2 被 根/B/C 共享（祖先与兄弟都计入）→ 3；节点 4 仅 C → 1
    expect(lineageForNode({ currentSessionId: 's-a', node: childANodes[0], sessions, index }).badge).toBe(3)
    expect(lineageForNode({ currentSessionId: 's-a', node: childANodes[1], sessions, index }).badge).toBe(3)
    expect(lineageForNode({ currentSessionId: 's-a', node: childANodes[2], sessions, index }).badge).toBe(1)
    // 进行中节点恒 0
    expect(lineageForNode({ currentSessionId: 's-root', node: node(9, null), sessions, index }).badge).toBe(0)
  })

  it('用户场景：同一逻辑节点看到全部深拷贝分叉（含祖先与兄弟）', () => {
    // 对话历史0: A→B→C→D  对话历史1: A→B→F（从 B 后分叉）
    // 对话历史2: A→B→C→G（从 C 后分叉）——下标表示深拷贝，同位置同 boundarySeq
    const h0 = [node(1, 10), node(2, 20), node(3, 30), node(4, 40)]
    const h1 = [node(1, 10), node(2, 20), node(5, 50)]
    const h2 = [node(1, 10), node(2, 20), node(3, 30), node(6, 60)]
    const sessions = [
      session('s0', undefined, 0, { nodes: h0 }),
      session('s1', 's0', 0, { nodes: h1 }),
      session('s2', 's0', 0, { nodes: h2 }),
    ]
    const index = buildHistoryIndex(sessions)
    // 在对话历史1 中看节点 B（位置 1）：应看到全部其他分叉 → 会话0 与 会话2
    const lineage = lineageForNode({ currentSessionId: 's1', node: h1[1], sessions, index })
    expect(lineage.badge).toBe(2)
    expect(lineage.sharedSessions.map(s => s.sessionId).sort()).toEqual(['s0', 's2'])
    // 节点 A（位置 0）：同样三个会话共享 → 2
    expect(lineageForNode({ currentSessionId: 's1', node: h1[0], sessions, index }).badge).toBe(2)
    // 节点 F（仅会话1 独有）→ 0
    expect(lineageForNode({ currentSessionId: 's1', node: h1[2], sessions, index }).badge).toBe(0)
    // 在对话历史2 中看节点 C：会话0 与 会话2 共享 → 1（会话1 没有 C）
    expect(lineageForNode({ currentSessionId: 's2', node: h2[2], sessions, index }).badge).toBe(1)
  })

  it('祖先与后代都计入（共享同一逻辑节点）', () => {
    const rootNodes = [node(1, 10), node(2, 20)]
    const childNodes = [node(1, 10), node(2, 20), node(3, 30)]
    const sessions = [
      session('s-root', undefined, 0, { nodes: rootNodes }),
      session('s-child', 's-root', 0, { nodes: childNodes }),
    ]
    const index = buildHistoryIndex(sessions)
    // 从子会话看：父是祖先，但共享同一逻辑节点 → 计入 → 角标 1
    expect(lineageForNode({ currentSessionId: 's-child', node: childNodes[0], sessions, index }).badge).toBe(1)
    // 从父会话看：子是后代 → 同样 1
    expect(lineageForNode({ currentSessionId: 's-root', node: rootNodes[0], sessions, index }).badge).toBe(1)
  })
})
