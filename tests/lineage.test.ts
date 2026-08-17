import { describe, expect, it } from 'vitest'
import {
  deriveNodeLineage,
  isDescendantOf,
  sharedPrefixLength,
  type LineageSessionLike,
} from '../src/history/lineage.js'
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

describe('isDescendantOf', () => {
  const sessions = [
    session('s-root', undefined, 3),
    session('s-a', 's-root', 2),   // 直系子
    session('s-b', 's-a', 1),      // 孙
    session('s-other', undefined, 2), // 无关
  ]

  it('直系与多级后代都可达', () => {
    expect(isDescendantOf(sessions, 's-a', 's-root')).toBe(true)
    expect(isDescendantOf(sessions, 's-b', 's-root')).toBe(true)
  })

  it('无关会话不可达，自身不算后代', () => {
    expect(isDescendantOf(sessions, 's-other', 's-root')).toBe(false)
    expect(isDescendantOf(sessions, 's-root', 's-root')).toBe(false)
  })

  it('环防护不死循环', () => {
    const cyclic = [
      session('x', 'y', 1),
      session('y', 'x', 1),
    ]
    expect(isDescendantOf(cyclic, 'x', 'z')).toBe(false)
  })
})

describe('sharedPrefixLength', () => {
  it('按 boundarySeq 逐位对齐', () => {
    const left = [node(1, 10), node(2, 20), node(3, 30)]
    const right = [node(1, 10), node(2, 20), node(9, 90)] // 前两个共享
    expect(sharedPrefixLength(left, right)).toBe(2)
  })

  it('边界不同或出现 null 即停', () => {
    const left = [node(1, 10), node(2, 20)]
    const right = [node(1, 10), node(2, null)] // 第二个是进行中节点
    expect(sharedPrefixLength(left, right)).toBe(1)
    expect(sharedPrefixLength([], [node(1, 10)])).toBe(0)
  })
})

describe('deriveNodeLineage', () => {
  it('直系子会话：共享节点获得角标', () => {
    // s-root 有 3 个节点；s-a 从 s-root 的第 2 个节点之后分叉（共享前 2 个）
    const root = [node(1, 10), node(2, 20), node(3, 30)]
    const childA = [node(1, 10), node(2, 20), node(4, 40)] // 第 3 个不同 → 共享前缀 2
    const lineage = deriveNodeLineage({
      currentSessionId: 's-root',
      currentNodes: root,
      sessions: [
        session('s-root', undefined, 0, { nodes: root }),
        session('s-a', 's-root', 0, { nodes: childA }),
      ],
    })
    expect(lineage.map(l => l.badge)).toEqual([1, 1, 0])
    expect(lineage[0].sharedSessions[0].sessionId).toBe('s-a')
  })

  it('多级 fork：孙会话对更高层节点贡献角标', () => {
    const root = [node(1, 10), node(2, 20), node(3, 30)]
    const childA = [node(1, 10), node(2, 20), node(4, 40)]
    const grandB = [node(1, 10), node(2, 20), node(4, 40), node(5, 50)] // B 从 A 的节点 4 后分叉
    const lineage = deriveNodeLineage({
      currentSessionId: 's-root',
      currentNodes: root,
      sessions: [
        session('s-root', undefined, 0, { nodes: root }),
        session('s-a', 's-root', 0, { nodes: childA }),
        session('s-b', 's-a', 0, { nodes: grandB }),
      ],
    })
    // 根节点 1、2 被 A 和 B 共享；节点 3 无人共享
    expect(lineage.map(l => l.badge)).toEqual([2, 2, 0])
  })

  it('子代理会话被排除', () => {
    const root = [node(1, 10), node(2, 20)]
    const child = [node(1, 10), node(2, 20), node(3, 30)]
    const lineage = deriveNodeLineage({
      currentSessionId: 's-root',
      currentNodes: root,
      sessions: [
        session('s-root', undefined, 0, { nodes: root }),
        session('s-a', 's-root', 0, { nodes: child }),
        session('s-sub', 's-root', 0, { nodes: child, origin: 'subagent' }),
      ],
    })
    expect(lineage[0].badge).toBe(1)
    expect(lineage[0].sharedSessions.map(s => s.sessionId)).toEqual(['s-a'])
  })

  it('无投影值的后代不计入（无法对齐）', () => {
    const root = [node(1, 10), node(2, 20)]
    const lineage = deriveNodeLineage({
      currentSessionId: 's-root',
      currentNodes: root,
      sessions: [
        session('s-root', undefined, 0, { nodes: root }),
        session('s-a', 's-root', 0, { nodes: undefined }), // 投影缺失
      ],
    })
    expect(lineage.map(l => l.badge)).toEqual([0, 0])
  })

  it('空节点路径返回空谱系', () => {
    const lineage = deriveNodeLineage({
      currentSessionId: 's-root',
      currentNodes: [],
      sessions: [],
    })
    expect(lineage).toEqual([])
  })
})
