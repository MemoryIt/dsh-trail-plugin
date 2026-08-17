import { describe, expect, it } from 'vitest'
import {
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

function session(sessionId: string, parentId: string | undefined, turns: number): LineageSessionLike {
  return {
    sessionId,
    parentId,
    displayTitle: `会话 ${sessionId}`,
    nodes: turns > 0 ? Array.from({ length: turns }, (_, i) => node(i + 1, (i + 1) * 10)) : [],
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
