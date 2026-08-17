import { describe, expect, it } from 'vitest'
import { foldEvents, foldHistoryIndex, initHistoryIndex, viewNodes, type LogEventLike } from '../src/history/fold.js'
import { NODE_TEXT_MAX_CHARS, SUMMARY_MAX_CHARS } from '../src/history/text.js'

function ev(type: string, seq: number, data: Record<string, unknown> = {}): LogEventLike {
  return { type, seq, time: 1700000000000 + seq, data }
}

function textBlock(text: string) {
  return { type: 'text', text }
}

describe('foldHistoryIndex', () => {
  it('空事件序列返回空 state', () => {
    expect(viewNodes(foldEvents([]))).toEqual([])
  })

  it('单个 turn：user + assistant + turn/end 折叠为一个节点', () => {
    const state = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, { content: [textBlock('帮我写个插件')] }),
      ev('assistant/message', 3, { turn: 1, message: { content: [textBlock('好的，我来写')] } }),
      ev('turn/end', 4, { turn: 1, reason: { kind: 'stop' } }),
    ])
    const [node] = viewNodes(state)
    expect(node).toMatchObject({
      nodeKey: '1',
      turn: 1,
      parentKey: null,
      startSeq: 1,
      endSeq: 4,
      boundarySeq: 4,
      kind: 'mixed',
      summary: '帮我写个插件',
      summarySource: 'rule',
      messageSeqs: [2, 3],
    })
    expect(node.text).toContain('帮我写个插件')
    expect(node.text).toContain('好的，我来写')
  })

  it('整句摘要：多句用户消息取第一句有意义的完整句', () => {
    const state = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, {
        content: [textBlock('这个插件目前只支持线性会话。我想给线性 Session 加上可索引、可跳转、可分叉的导航层，你能帮我评估一下吗？')],
      }),
      ev('assistant/message', 3, { turn: 1, message: { content: [textBlock('好的，我来分析。')] } }),
      ev('turn/end', 4, { turn: 1 }),
    ])
    const [node] = viewNodes(state)
    // 整句摘要（非硬截断）：取第一条长度 ≥ 8 的完整句
    expect(node.summary).toBe('这个插件目前只支持线性会话。')
    expect(node.summarySource).toBe('rule')
  })

  it('摘要缺失时 updatedAt 为 0，摘要生成后记录事件时间', () => {
    const state = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, { content: [textBlock('你好')] }),
      ev('turn/end', 3, { turn: 1 }),
    ])
    const [node] = viewNodes(state)
    expect(node.updatedAt).toBe(1700000000002)
  })

  it('多 step turn（assistant → tool → assistant）归属同一节点', () => {
    const state = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, { content: [textBlock('跑一下测试')] }),
      ev('assistant/message', 3, { turn: 1, message: { content: [textBlock('先调工具')] } }),
      ev('tool/call', 4, { turn: 1, callId: 'c1', name: 'bash', arguments: '{}' }),
      ev('tool/result', 5, { turn: 1, message: { content: [{ type: 'tool-result', text: 'ok' }] } }),
      ev('assistant/message', 6, { turn: 1, message: { content: [textBlock('测试通过')] } }),
      ev('turn/end', 7, { turn: 1 }),
    ])
    expect(viewNodes(state)).toHaveLength(1)
    const [node] = viewNodes(state)
    expect(node.kind).toBe('mixed')
    expect(node.startSeq).toBe(1)
    expect(node.endSeq).toBe(7)
    expect(node.boundarySeq).toBe(7)
    // 摘要优先用户消息；tool 不进 messageSeqs
    expect(node.summary).toBe('跑一下测试')
    expect(node.messageSeqs).toEqual([2, 3, 6])
  })

  it('多个 turn 形成带 parent 边的线性路径', () => {
    const state = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, { content: [textBlock('问题一')] }),
      ev('assistant/message', 3, { turn: 1, message: { content: [textBlock('回答一')] } }),
      ev('turn/end', 4, { turn: 1 }),
      ev('turn/start', 5, { turn: 2 }),
      ev('user/message', 6, { content: [textBlock('问题二')] }),
      ev('assistant/message', 7, { turn: 2, message: { content: [textBlock('回答二')] } }),
      ev('turn/end', 8, { turn: 2 }),
    ])
    const nodes = viewNodes(state)
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({ nodeKey: '1', turn: 1, parentKey: null, boundarySeq: 4 })
    expect(nodes[1]).toMatchObject({ nodeKey: '2', turn: 2, parentKey: '1', boundarySeq: 8 })
  })

  it('进行中的 turn（无 turn/end）boundarySeq 为 null', () => {
    const state = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, { content: [textBlock('进行中')] }),
      ev('assistant/message', 3, { turn: 1, message: { content: [textBlock('还在生成…')] } }),
    ])
    const [node] = viewNodes(state)
    expect(node.boundarySeq).toBeNull()
    expect(node.endSeq).toBe(3)
  })

  it('无关事件返回同一引用（零下游工作）', () => {
    const state = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, { content: [textBlock('hi')] }),
    ])
    const before = viewNodes(state)[0]
    const after = foldHistoryIndex(state, ev('todo/write', 3, { todos: [] }))
    expect(after).toBe(state)
    expect(viewNodes(after)[0]).toBe(before)
  })

  it('未知事件类型同样返回同一引用', () => {
    const state = initHistoryIndex()
    expect(foldHistoryIndex(state, ev('future/type', 1, {}))).toBe(state)
  })

  it('纯工具 turn 归类为 tool', () => {
    const state = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('tool/call', 2, { turn: 1 }),
      ev('tool/result', 3, { turn: 1 }),
      ev('turn/end', 4, { turn: 1 }),
    ])
    const [node] = viewNodes(state)
    expect(node.kind).toBe('tool')
  })

  it('长文本摘要截断且内联文本有界', () => {
    const long = 'x'.repeat(SUMMARY_MAX_CHARS + 50)
    const state = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, { content: [textBlock(long)] }),
      ev('turn/end', 3, { turn: 1 }),
    ])
    const [node] = viewNodes(state)
    expect(node.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS + 1)
    expect(node.summary.endsWith('…')).toBe(true)
    expect(node.text.length).toBeLessThanOrEqual(NODE_TEXT_MAX_CHARS)
  })

  it('重放同一事件序列结果确定（幂等）', () => {
    const events = [
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, { content: [textBlock('hi')] }),
      ev('assistant/message', 3, { turn: 1, message: { content: [textBlock('hey')] } }),
      ev('turn/end', 4, { turn: 1 }),
    ]
    expect(foldEvents(events)).toEqual(foldEvents(events))
  })

  it('turn/end 重复出现时幂等（同一引用）', () => {
    const base = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, { content: [textBlock('hi')] }),
      ev('turn/end', 3, { turn: 1 }),
    ])
    expect(foldHistoryIndex(base, ev('turn/end', 3, { turn: 1 }))).toBe(base)
  })
})
