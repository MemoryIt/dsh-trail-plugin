import { describe, expect, it } from 'vitest'
import factory from '../src/client.js'

/** 最小 react 桩：createElement + useState 返回可断言的普通对象。 */
function fakeReact() {
  return {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
      type, props, children,
    }),
    useState: (initial: unknown) => [initial, () => {}],
  }
}

interface FakeEntry {
  options: { id: string; order?: number; label?: string }
  component: (props: {
    sessionId: string
    useProjection: (key: string) => unknown
  }) => unknown
}

function fakeCtx(sessions?: unknown) {
  const registrations: { key: string; effect: FakeEntry }[] = []
  const slots = {
    inject: (key: string, callback: () => unknown) => {
      registrations.push({ key, effect: callback() as FakeEntry })
      return () => {}
    },
    register: (options: FakeEntry['options'], component: FakeEntry['component']) =>
      ({ options, component }),
  }
  return {
    registrations,
    ctx: {
      get: (name: string) => {
        if (name === 'slots') return slots
        if (name === 'sessions' && sessions !== undefined) return sessions
        return undefined
      },
    },
  }
}

/** 投影值：与 host 投影单元 view 输出结构一致。 */
function fakeProjection(overrides: Record<string, unknown> = {}) {
  return {
    nodes: [
      {
        nodeKey: '1',
        turn: 1,
        parentKey: null,
        startSeq: 1,
        endSeq: 4,
        boundarySeq: 4,
        kind: 'mixed',
        summary: '帮我写个插件',
        text: '帮我写个插件\n好的，我来写',
        messageSeqs: [2, 3],
      },
      {
        nodeKey: '2',
        turn: 2,
        parentKey: '1',
        startSeq: 5,
        endSeq: 6,
        boundarySeq: null,
        kind: 'user',
        summary: '第二个问题',
        text: '第二个问题',
        messageSeqs: [5],
      },
    ],
    ...overrides,
  }
}

describe('client bundle factory', () => {
  it('返回带 name 与 apply 的插件入口', () => {
    const plugin = factory(() => fakeReact())
    expect(plugin.name).toBe('dsh-trail-plugin')
    expect(typeof plugin.apply).toBe('function')
  })

  it('apply 把 history 视图注册进 conversation.view 环', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    expect(registrations).toHaveLength(1)
    expect(registrations[0].key).toBe('conversation.view')
    const entry = registrations[0].effect
    expect(entry.options.id).toBe('history')
    expect(entry.options.order).toBe(20)
    expect(entry.options.label).toBe('历史索引')
  })

  it('视图用投影数据渲染节点（完整索引 + 摘要 + 可续写/进行中）', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    const rendered = registrations[0].effect.component({
      sessionId: 'sess-1',
      useProjection: (key) => (key === 'history' ? fakeProjection() : undefined),
    })
    const text = JSON.stringify(rendered)
    expect(text).toContain('History Index')
    expect(text).toContain('2 个逻辑节点')
    expect(text).toContain('帮我写个插件')
    expect(text).toContain('可续写')
    expect(text).toContain('进行中')
  })

  it('无投影值时渲染空态提示', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    const rendered = registrations[0].effect.component({
      sessionId: 'sess-1',
      useProjection: () => undefined,
    })
    const text = JSON.stringify(rendered)
    expect(text).toContain('暂无节点')
  })

  it('捕获 sessions 服务供 fork 使用', () => {
    const sessions = {
      fork: () => Promise.resolve('child-1'),
      open: () => {},
    }
    const { ctx } = fakeCtx(sessions)
    const plugin = factory(() => fakeReact())
    expect(() => plugin.apply(ctx as never)).not.toThrow()
  })
})
