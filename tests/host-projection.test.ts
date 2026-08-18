import { describe, expect, it, vi } from 'vitest'
import { apply, HISTORY_PROJECTION_KEY, HISTORY_PROJECTION_STATE_VERSION } from '../src/index.js'
import type { LogEventLike } from '../src/history/fold.js'

interface RegisteredProjection {
  key: string
  schema: unknown
  init: () => unknown
  apply: (state: unknown, event: unknown) => unknown
  view: (state: unknown) => unknown
  stateVersion: number
}

function fakeProjectionRegistry() {
  const registrations: RegisteredProjection[] = []
  return {
    registrations,
    registry: {
      register: (definition: RegisteredProjection) => {
        registrations.push(definition)
        return () => {}
      },
    },
  }
}

function fakeCtx(extra: Record<string, unknown> = {}) {
  const { registrations, registry } = fakeProjectionRegistry()
  const effects: Array<() => unknown> = []
  const ctx = {
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    get: (name: string) => (name === 'sessionProjections' ? registry : extra[name]),
    // 模拟 cordis ctx.effect：立即执行 setup 并记录，返回其 cleanup。
    effect: (fn: () => unknown) => {
      const cleanup = fn()
      effects.push(fn)
      return cleanup
    },
  }
  return { registrations, effects, ctx }
}

function ev(type: string, seq: number, data: Record<string, unknown> = {}): LogEventLike {
  return { type, seq, data }
}

describe('host plugin 投影注册', () => {
  it('apply 注册 key=history 的投影单元', () => {
    const { registrations, ctx } = fakeCtx()
    apply(ctx as never)
    expect(registrations).toHaveLength(1)
    const def = registrations[0]
    expect(def.key).toBe(HISTORY_PROJECTION_KEY)
    expect(def.stateVersion).toBe(HISTORY_PROJECTION_STATE_VERSION)
    expect(def.schema).toBeDefined()
  })

  it('注册的折叠逻辑把事件序列变成节点', () => {
    const { registrations, ctx } = fakeCtx()
    apply(ctx as never)
    const def = registrations[0]
    let state = def.init() as { nodes: Array<Record<string, unknown>> }
    for (const event of [
      ev('turn/start', 1, { turn: 1 }),
      ev('user/message', 2, { content: [{ type: 'text', text: '你好' }] }),
      ev('turn/end', 3, { turn: 1 }),
    ]) {
      state = def.apply(state, event) as typeof state
    }
    const view = def.view(state) as { nodes: Array<Record<string, unknown>> }
    expect(view.nodes).toHaveLength(1)
    expect(view.nodes[0]).toMatchObject({ turn: 1, kind: 'user', summary: '你好', boundarySeq: 3 })
  })

  it('view 输出可通过 schema 校验', () => {
    const { registrations, ctx } = fakeCtx()
    apply(ctx as never)
    const def = registrations[0]
    const state = def.init() as { nodes: Array<Record<string, unknown>> }
    const view = def.view(state)
    const schema = def.schema as { safeParse: (v: unknown) => { success: boolean } }
    expect(schema.safeParse(view).success).toBe(true)
  })

  it('sessionProjections 缺席时静默跳过（headless 组装不受影响）', () => {
    const ctx = {
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
      get: () => undefined,
      effect: () => () => {},
    }
    expect(() => apply(ctx as never)).not.toThrow()
  })

  it('sessionPersistence / sessionProjectionCache 齐备时启动后台补齐', async () => {
    const cold = vi.fn(async () => ({ asOfSeq: -1, values: { history: { nodes: [] } } }))
    const persistence = { list: async () => [{ id: 's1', createdAt: 0 }] }
    const cache = { cachedSnapshot: () => undefined, coldSnapshot: cold }
    const { effects, ctx } = fakeCtx({ sessionPersistence: persistence, sessionProjectionCache: cache })
    apply(ctx as never)
    // 第二个 effect 即后台补齐（hello world 是第一个）
    expect(effects.length).toBe(2)
    await vi.waitFor(() => expect(cold).toHaveBeenCalledWith('s1', expect.any(AbortSignal)))
  })

  it('sessionPersistence / sessionProjectionCache 缺席时不注册补齐 effect', () => {
    const { effects, ctx } = fakeCtx()
    apply(ctx as never)
    expect(effects.length).toBe(1)
  })
})
