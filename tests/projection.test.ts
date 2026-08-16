import { describe, expect, it } from 'vitest'
import { deriveNodes, SUMMARY_MAX_CHARS, type ProjectionInput, type SurfaceNodeLike } from '../src/projection.js'

function node(partial: Partial<SurfaceNodeLike> & { kind: string; seq: number }): SurfaceNodeLike {
  return { ...partial }
}

function input(nodes: readonly SurfaceNodeLike[], turnEnds: ReadonlyMap<number, number> = new Map()): ProjectionInput {
  return { sessionId: 'sess-1', nodes, turnEnds }
}

describe('deriveNodes', () => {
  it('空节点列表返回空数组', () => {
    expect(deriveNodes(input([]))).toEqual([])
  })

  it('单个 turn：user + assistant 合并为一个 mixed 节点', () => {
    const nodes = deriveNodes(input([
      node({ kind: 'user', seq: 1, text: '帮我写个插件' }),
      node({ kind: 'assistant', seq: 2, turn: 1, text: '好的，我来写' }),
    ], new Map([[1, 3]])))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      index: 0,
      turn: 1,
      boundarySeq: 3,
      startSeq: 1,
      endSeq: 2,
      kind: 'mixed',
      summary: '帮我写个插件',
      summarySource: 'rule',
      messageSeqs: [1, 2],
    })
    expect(nodes[0].nodeKey).toBe('sess-1:3')
  })

  it('多 step turn：assistant + tool + assistant 归属同一节点', () => {
    const nodes = deriveNodes(input([
      node({ kind: 'user', seq: 1, text: '跑一下测试' }),
      node({ kind: 'assistant', seq: 2, turn: 1 }),
      node({ kind: 'tool', seq: 3, turn: 1 }),
      node({ kind: 'assistant', seq: 4, turn: 1, text: '测试通过了' }),
    ], new Map([[1, 5]])))
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('mixed')
    expect(nodes[0].startSeq).toBe(1)
    expect(nodes[0].endSeq).toBe(4)
    // 摘要优先取用户消息
    expect(nodes[0].summary).toBe('跑一下测试')
    // tool 不算消息 seq
    expect(nodes[0].messageSeqs).toEqual([1, 2, 4])
  })

  it('多个 turn 形成线性路径', () => {
    const nodes = deriveNodes(input([
      node({ kind: 'user', seq: 1, text: '问题一' }),
      node({ kind: 'assistant', seq: 2, turn: 1, text: '回答一' }),
      node({ kind: 'user', seq: 4, text: '问题二' }),
      node({ kind: 'assistant', seq: 5, turn: 2, text: '回答二' }),
    ], new Map([[1, 3], [2, 6]])))
    expect(nodes.map(n => ({ turn: n.turn, index: n.index, summary: n.summary, boundarySeq: n.boundarySeq }))).toEqual([
      { turn: 1, index: 0, summary: '问题一', boundarySeq: 3 },
      { turn: 2, index: 1, summary: '问题二', boundarySeq: 6 },
    ])
  })

  it('进行中的 turn（无 turn/end）boundarySeq 为 null', () => {
    const nodes = deriveNodes(input([
      node({ kind: 'user', seq: 1, text: '进行中的问题' }),
      node({ kind: 'assistant', seq: 2, turn: 1, text: '还在生成…' }),
    ]))
    expect(nodes).toHaveLength(1)
    expect(nodes[0].boundarySeq).toBeNull()
    expect(nodes[0].nodeKey).toBe('sess-1:2')
  })

  it('纯工具节点归类为 tool', () => {
    const nodes = deriveNodes(input([
      node({ kind: 'tool', seq: 1, turn: 1 }),
    ]))
    expect(nodes[0].kind).toBe('tool')
    expect(nodes[0].summary).toBe('工具执行')
  })

  it('长文本摘要被截断', () => {
    const long = 'x'.repeat(SUMMARY_MAX_CHARS + 20)
    const nodes = deriveNodes(input([
      node({ kind: 'user', seq: 1, text: long }),
      node({ kind: 'assistant', seq: 2, turn: 1 }),
    ]))
    expect(nodes[0].summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS + 1)
    expect(nodes[0].summary.endsWith('…')).toBe(true)
  })

  it('全部无 turn 的节点归入单个 turn 0 组', () => {
    const nodes = deriveNodes(input([
      node({ kind: 'compaction', seq: 1 }),
      node({ kind: 'compaction', seq: 2 }),
    ]))
    expect(nodes).toHaveLength(1)
    expect(nodes[0].turn).toBe(0)
    expect(nodes[0].kind).toBe('other')
  })
})
