import { describe, expect, it } from 'vitest'
import factory from '../src/client.js'

/** 最小 react 桩：createElement 返回可断言的普通对象。 */
function fakeReact() {
  return {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
      type, props, children,
    }),
  }
}

interface FakeEntry {
  options: { id: string; order?: number; label?: string }
  component: (props: {
    sessionId: string
    useSession: (selector: (snapshot: unknown) => unknown) => unknown
  }) => unknown
}

function fakeCtx() {
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
    ctx: { get: (name: string) => (name === 'slots' ? slots : undefined) },
  }
}

/** 构造一个带节点的假快照（结构与官方 ConversationSnapshot 字段子集一致）。 */
function fakeSnapshot(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    nodes: [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: '帮我写个插件' }] },
      { kind: 'assistant', seq: 2, turn: 1, blocks: [{ type: 'text', text: '好的' }] },
    ],
    turnEnds: new Map([[1, 3]]),
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

  it('视图用快照数据渲染逻辑节点（含摘要与 sessionId）', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    const snapshot = fakeSnapshot('sess-1')
    const rendered = registrations[0].effect.component({
      sessionId: 'sess-1',
      useSession: (selector) => selector(snapshot),
    })
    const text = JSON.stringify(rendered)
    expect(text).toContain('History Index')
    expect(text).toContain('M1 数据链路已接通（1 个逻辑节点）')
    expect(text).toContain('帮我写个插件')
    expect(text).toContain('可 fork')
  })

  it('空快照渲染空态提示', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    const snapshot = fakeSnapshot('sess-1', { nodes: [], turnEnds: new Map() })
    const rendered = registrations[0].effect.component({
      sessionId: 'sess-1',
      useSession: (selector) => selector(snapshot),
    })
    const text = JSON.stringify(rendered)
    expect(text).toContain('暂无节点')
    expect(text).toContain('0 个逻辑节点')
  })
})
