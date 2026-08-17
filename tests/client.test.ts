import { describe, expect, it } from 'vitest'
import factory from '../src/client.js'

/** 最小 react 桩：createElement + useState（可注入按调用顺序返回的初始值）+ useRef/useLayoutEffect。 */
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
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: () => {},
    useLayoutEffect: () => {},
  }
}

interface FakeEntry {
  options: { id: string; order?: number; label?: string }
  component: (props: {
    sessionId?: string
    useProjection?: (key: string) => unknown
    useSessions?: (selector: (state: unknown) => unknown) => unknown
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

/** 递归查找渲染树中带指定 key prop 的元素 props（行节点 key = nodeKey）。
 * 渲染树里 createElement 的 children 可能嵌套数组（如 nodes.map(...) 作为
 * 单个 child 传入），需显式展开数组层。 */
function findByKey(node: unknown, key: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByKey(child, key)
      if (found !== null) return found
    }
    return null
  }
  if (node === null || typeof node !== 'object') return null
  const element = node as { props?: Record<string, unknown>; children?: unknown }
  if (element.props?.key === key) return element.props
  const children = Array.isArray(element.children) ? element.children : [element.children]
  for (const child of children) {
    const found = findByKey(child, key)
    if (found !== null) return found
  }
  return null
}

describe('client bundle factory', () => {
  it('返回带 name 与 apply 的插件入口', () => {
    const plugin = factory(() => fakeReact())
    expect(plugin.name).toBe('dsh-trail-plugin')
    expect(typeof plugin.apply).toBe('function')
  })

  it('apply 把 history 视图注册进 conversation.view 环，并注册左栏到 shell.overlay', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    expect(registrations).toHaveLength(2)
    expect(registrations.map(r => r.key)).toEqual(['conversation.view', 'shell.overlay'])
    const entry = registrations[0].effect
    expect(entry.options.id).toBe('history')
    expect(entry.options.order).toBe(20)
    expect(entry.options.label).toBe('历史索引')
  })

  it('左栏条目注册进 shell.overlay（list 槽：id/order/label）', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact())
    plugin.apply(ctx as never)
    const overlay = registrations.find(r => r.key === 'shell.overlay')
    expect(overlay).toBeDefined()
    const entry = overlay?.effect
    expect(entry?.options.id).toBe('dsh-trail-left-column')
    expect(entry?.options.order).toBe(10)
    expect(entry?.options.label).toBe('历史索引左栏')
  })

  it('左栏渲染当前会话的节点列表（root scope useSessions）', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact([{ width: 280, collapsed: false }])) // collapsed = false
    plugin.apply(ctx as never)
    const overlay = registrations.find(r => r.key === 'shell.overlay')
    const rendered = overlay?.effect.component({
      useSessions: (selector) => selector({
        ids: ['s-root'],
        byId: {
          's-root': {
            id: 's-root',
            displayTitle: '根会话',
            blank: false,
            projectionValues: { history: fakeProjection() },
          },
        },
        current: 's-root',
      }),
    })
    const text = JSON.stringify(rendered)
    expect(text).toContain('History Index')
    expect(text).toContain('2 个逻辑节点')
    expect(text).toContain('帮我写个插件')
    expect(text).toContain('可续写')
    // 节点行带点击跳转回调（行 key = nodeKey）
    const rowProps = findByKey(rendered, '1')
    expect(rowProps).not.toBeNull()
    expect(typeof rowProps?.onClick).toBe('function')
  })

  it('折叠态渲染可识别的展开竖条（图标 + 竖排文字）', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact([{ width: 280, collapsed: true }]))
    plugin.apply(ctx as never)
    const overlay = registrations.find(r => r.key === 'shell.overlay')
    const rendered = overlay?.effect.component({
      useSessions: (selector) => selector({
        ids: ['s-root'],
        byId: { 's-root': { id: 's-root', displayTitle: '根会话', blank: false } },
        current: 's-root',
      }),
    })
    const text = JSON.stringify(rendered)
    expect(text).toContain('展开历史索引')
    expect(text).toContain('历史')
    expect(text).toContain('☰')
  })

  it('左栏在无当前会话或空会话时隐藏', () => {
    const { registrations, ctx } = fakeCtx()
    const plugin = factory(() => fakeReact([{ width: 280, collapsed: false }]))
    plugin.apply(ctx as never)
    const overlay = registrations.find(r => r.key === 'shell.overlay')
    // 无 current → visible=false → 渲染 null
    expect(overlay?.effect.component({
      useSessions: (selector) => selector({ ids: [], byId: {} }),
    })).toBeNull()
    // 空会话（blank）→ 隐藏
    expect(overlay?.effect.component({
      useSessions: (selector) => selector({
        ids: ['s-blank'],
        byId: { 's-blank': { id: 's-blank', displayTitle: '空会话', blank: true } },
        current: 's-blank',
      }),
    })).toBeNull()
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
