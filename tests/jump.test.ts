import { describe, expect, it } from 'vitest'
import { minAnchorSeq, resolveJumpTarget, type JumpChatNodeLike } from '../src/jump.js'

/** 历史节点：第 2 轮，seq 20–30。 */
const historyNode = { turn: 2, startSeq: 20, endSeq: 30 }

function node(key: string, anchorSeq: number, turn: number): JumpChatNodeLike {
  return { key, anchorSeq, turn }
}

describe('resolveJumpTarget', () => {
  it('同 turn 内取最小 anchorSeq（轮首用户行）', () => {
    const chatNodes = [
      node('a:2', 22, 2),
      node('u:2', 21, 2),
      node('a:1', 11, 1),
    ]
    expect(resolveJumpTarget(historyNode, chatNodes)).toBe('u:2')
  })

  it('turn 无匹配时按 seq 范围回退', () => {
    const chatNodes = [
      node('u:2', 21, -1), // 无 turn 归属（session 级节点）
      node('x', 5, 9),
    ]
    expect(resolveJumpTarget(historyNode, chatNodes)).toBe('u:2')
  })

  it('回退范围内取最小 anchorSeq', () => {
    const chatNodes = [
      node('b', 25, -1),
      node('a', 22, -1),
    ]
    expect(resolveJumpTarget(historyNode, chatNodes)).toBe('a')
  })

  it('seq 范围外的节点不参与回退', () => {
    const chatNodes = [
      node('too-early', 19, -1),
      node('too-late', 31, -1),
    ]
    expect(resolveJumpTarget(historyNode, chatNodes)).toBeNull()
  })

  it('无匹配返回 null', () => {
    expect(resolveJumpTarget(historyNode, [
      node('x', 5, 9),
      node('y', 99, 3),
    ])).toBeNull()
  })

  it('空列表返回 null', () => {
    expect(resolveJumpTarget(historyNode, [])).toBeNull()
  })
})

describe('minAnchorSeq（翻页进度判断）', () => {
  it('返回最小 anchorSeq（窗口起点）', () => {
    expect(minAnchorSeq([node('a', 30, 1), node('b', 10, 1), node('c', 20, 2)])).toBe(10)
  })

  it('空列表返回 null', () => {
    expect(minAnchorSeq([])).toBeNull()
  })

  it('单元素返回自身', () => {
    expect(minAnchorSeq([node('a', 42, 3)])).toBe(42)
  })
})
