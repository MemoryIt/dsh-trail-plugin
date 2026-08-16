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
  component: (props: { sessionId: string }) => unknown
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

  it('视图组件用默认内容渲染并展示当前 sessionId', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    const rendered = registrations[0].effect.component({ sessionId: 'sess-1' })
    expect(rendered.type).toBe('div')
    // 首行默认内容包含当前 Session id（纯字符串校验：序列化后代文本）
    const text = JSON.stringify(rendered)
    expect(text).toContain('History Index')
    expect(text).toContain('sess-1')
    expect(text).toContain('hello world')
  })
})
