import { describe, expect, it } from 'vitest'
import {
  jumpFailureMessage, matchTarget, minAnchorSeq, resolveFallback,
  type JumpChatNodeLike,
} from '../src/jump.js'

/** 历史节点：第 2 轮，seq 20–30。 */
const historyNode = { turn: 2, startSeq: 20, endSeq: 30 }

function node(key: string, anchorSeq: number, turn: number, visibility?: 'visible' | 'hidden'): JumpChatNodeLike {
  return visibility === undefined ? { key, anchorSeq, turn } : { key, anchorSeq, turn, visibility }
}

describe('matchTarget（扩窗循环内每页的精确匹配）', () => {
  it('同 turn 内取最小 anchorSeq 的 visible 节点（轮首用户行）', () => {
    const chatNodes = [
      node('a:2', 22, 2),
      node('u:2', 21, 2),
      node('a:1', 11, 1),
    ]
    expect(matchTarget(historyNode, chatNodes)).toBe('u:2')
  })

  it('跳过 hidden 节点（不参与匹配）', () => {
    const chatNodes = [
      node('hidden', 19, 2, 'hidden'),
      node('visible', 21, 2),
    ]
    expect(matchTarget(historyNode, chatNodes)).toBe('visible')
  })

  it('同 turn 只有 hidden 时返回 null（调用方继续扩窗）', () => {
    const chatNodes = [node('h', 21, 2, 'hidden')]
    expect(matchTarget(historyNode, chatNodes)).toBeNull()
  })

  it('turn 不匹配返回 null', () => {
    expect(matchTarget(historyNode, [node('a:1', 11, 1)])).toBeNull()
  })

  it('historyNode turn < 0（compaction 哨兵）跳过主匹配返回 null', () => {
    const compacted = { turn: -1, startSeq: 100, endSeq: 200 }
    expect(matchTarget(compacted, [node('session-level', 50, -1)])).toBeNull()
  })

  it('空列表返回 null', () => {
    expect(matchTarget(historyNode, [])).toBeNull()
  })
})

describe('resolveFallback（精确命中但行不渲染时的邻近可见回退）', () => {
  it('排除 excludeKey 后取同 turn 次小 anchorSeq 的 visible 节点', () => {
    const chatNodes = [
      node('primary', 21, 2),
      node('second', 23, 2),
    ]
    expect(resolveFallback(historyNode, chatNodes, 'primary')).toBe('second')
  })

  it('同 turn 无剩余候选时回退到 anchorSeq ≥ startSeq 的最近可见', () => {
    const chatNodes = [
      node('primary', 21, 2),
      node('after', 31, 3),
    ]
    expect(resolveFallback(historyNode, chatNodes, 'primary')).toBe('after')
  })

  it('无 ≥ startSeq 时回退到全局最近可见', () => {
    const chatNodes = [
      node('primary', 21, 2),
      node('early', 5, 9),
    ]
    expect(resolveFallback(historyNode, chatNodes, 'primary')).toBe('early')
  })

  it('跳过 hidden 与 excludeKey', () => {
    const chatNodes = [
      node('primary', 21, 2),
      node('hidden', 22, 2, 'hidden'),
      node('after', 31, 3),
    ]
    expect(resolveFallback(historyNode, chatNodes, 'primary')).toBe('after')
  })

  it('全部 hidden / 空列表返回 null', () => {
    expect(resolveFallback(historyNode, [node('h', 22, 2, 'hidden')])).toBeNull()
    expect(resolveFallback(historyNode, [])).toBeNull()
  })
})

describe('jumpFailureMessage（失败码 → 文案）', () => {
  it('VIEW_INACTIVE', () => {
    expect(jumpFailureMessage('VIEW_INACTIVE')).toBe('聊天视图未激活，请先切到聊天')
  })

  it('TARGET_HIDDEN：有 fallback 与无 fallback 文案不同', () => {
    expect(jumpFailureMessage('TARGET_HIDDEN', true)).toBe('目标无独立气泡，已定位到邻近内容')
    expect(jumpFailureMessage('TARGET_HIDDEN', false)).toBe('目标节点为隐藏呈现，无法定位到聊天气泡')
  })

  it('NOT_FOUND 与 TIMEOUT', () => {
    expect(jumpFailureMessage('NOT_FOUND')).toBe('目标节点未加载或不存在（可能已压缩）')
    expect(jumpFailureMessage('TIMEOUT')).toBe('加载历史超时，可重试')
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
