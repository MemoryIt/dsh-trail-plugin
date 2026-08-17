import { describe, expect, it } from 'vitest'
import factory from '../src/client.js'

/** 最小 react 桩：createElement + useState（可注入按调用顺序返回的初始值）。 */
function fakeReact(states: unknown[] = []) {
  let call = 0
  return {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
      type, props, children,
    }),
    useState: (initial: unknown) => {
      const value = call < states.length ? states[call] : initial
      call += 1
      return [value, () => {}]
    },
  }
}

interface FakeEntry {
  options: { id: string; order?: number; label?: string }
  component: (props: {
    sessionId: string
    useProjection: (key: string) => unknown
    useSessions: (selector: (state: unknown) => unknown) => unknown
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

/** 投影节点：与 host 投影单元 view 输出结构一致。 */
function node(turn: number, boundarySeq: number | null, summary: string) {
  return {
    nodeKey: String(turn),
    turn,
    parentKey: turn === 1 ? null : String(turn - 1),
    startSeq: turn * 10,
    endSeq: boundarySeq ?? turn * 10 + 5,
    boundarySeq,
    kind: 'mixed',
    summary,
    summarySource: 'rule',
    updatedAt: 0,
    text: `${summary} 的正文`,
    messageSeqs: [turn * 10],
  }
}

function fakeProjection(overrides: Record<string, unknown> = {}) {
  return {
    nodes: [
      node(1, 10, '帮我写个插件'),
      node(2, 20, '第二个问题'),
    ],
    ...overrides,
  }
}

/** 会话列表：s-root 的直系子 s-a 在节点 1 之后分叉（共享节点 1）。 */
function fakeSessionsState() {
  return {
    ids: ['s-root', 's-a'],
    byId: {
      's-root': { id: 's-root', displayTitle: '根会话', parentId: undefined },
      's-a': {
        id: 's-a',
        displayTitle: '分叉会话',
        parentId: 's-root',
        projectionValues: { history: { nodes: [node(1, 10, '帮我写个插件'), node(3, 30, '分叉后的新问题')] } },
      },
    },
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

  it('视图渲染节点 + 谱系角标（共享会话数）', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    const rendered = registrations[0].effect.component({
      sessionId: 's-root',
      useProjection: (key) => (key === 'history' ? fakeProjection() : undefined),
      useSessions: (selector) => selector(fakeSessionsState()),
    })
    const text = JSON.stringify(rendered)
    expect(text).toContain('History Index')
    expect(text).toContain('2 个逻辑节点')
    expect(text).toContain('帮我写个插件')
    // s-a 与 s-root 共享节点 1（boundarySeq 10 对齐）→ 节点 1 角标 1
    expect(text).toContain('分叉 1')
    expect(text).toContain('可续写')
  })

  it('展开角标下拉：列出共享会话 + 叶子摘要', () => {
    const { registrations, ctx } = fakeCtx()
    // 第二个 useState（lineageOpen）预置展开节点 1 的下拉
    const plugin = factory(() => fakeReact([{}, { '1': true }]))
    plugin.apply(ctx as never)
    const rendered = registrations[0].effect.component({
      sessionId: 's-root',
      useProjection: (key) => (key === 'history' ? fakeProjection() : undefined),
      useSessions: (selector) => selector(fakeSessionsState()),
    })
    const text = JSON.stringify(rendered)
    expect(text).toContain('分叉会话')       // 下拉行标题
    expect(text).toContain('叶子：分叉后的新问题') // 分支叶子摘要
    expect(text).toContain('切换')
  })

  it('无后代时无角标', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    const rendered = registrations[0].effect.component({
      sessionId: 's-root',
      useProjection: (key) => (key === 'history' ? fakeProjection() : undefined),
      useSessions: (selector) => selector({ ids: ['s-root'], byId: { 's-root': { id: 's-root', displayTitle: '根会话' } } }),
    })
    const text = JSON.stringify(rendered)
    expect(text).not.toContain('分叉')
  })

  it('无投影值时渲染空态提示', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    const rendered = registrations[0].effect.component({
      sessionId: 'sess-1',
      useProjection: () => undefined,
      useSessions: () => undefined,
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
