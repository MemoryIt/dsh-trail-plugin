import { describe, expect, it, vi } from 'vitest'
import {
  backfillMissingHistory,
  type ProjectionSnapshotLike,
  type SessionHeaderLike,
} from '../src/backfill.js'

function header(id: string): SessionHeaderLike {
  return { id, createdAt: 0 }
}

function snapshotWith(history: unknown): ProjectionSnapshotLike {
  return { asOfSeq: 0, values: { history } }
}

function loggerSpy() {
  const info = vi.fn()
  const warn = vi.fn()
  return { info, warn, logger: { info, warn } }
}

describe('backfillMissingHistory 编排', () => {
  it('全部会话缺 history 时逐个顺序补齐', async () => {
    const ids = ['a', 'b', 'c']
    const cold = vi.fn(async (id: string) => snapshotWith({ nodes: [id] }))
    const { info, logger } = loggerSpy()
    const result = await backfillMissingHistory({
      persistence: { list: async () => ids.map(header) },
      cache: { cachedSnapshot: () => undefined, coldSnapshot: cold },
      logger,
    })
    expect(result).toEqual({ checked: 3, backfilled: 3, skipped: 0 })
    expect(cold.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
    expect(info).toHaveBeenCalledWith(expect.stringContaining('补齐 3 个'))
  })

  it('部分缺失时只补齐缺失的会话', async () => {
    const cold = vi.fn(async () => snapshotWith({ nodes: [] }))
    const result = await backfillMissingHistory({
      persistence: { list: async () => ['a', 'b', 'c'].map(header) },
      cache: {
        cachedSnapshot: (meta) => (meta.id === 'b' ? snapshotWith({ nodes: [] }) : undefined),
        coldSnapshot: cold,
      },
      logger: loggerSpy().logger,
    })
    expect(result).toEqual({ checked: 3, backfilled: 2, skipped: 0 })
    expect(cold.mock.calls.map((c) => c[0])).toEqual(['a', 'c'])
  })

  it('全部已有 history 时零补齐、不调用 coldSnapshot', async () => {
    const cold = vi.fn(async () => snapshotWith({ nodes: [] }))
    const result = await backfillMissingHistory({
      persistence: { list: async () => ['a', 'b'].map(header) },
      cache: { cachedSnapshot: () => snapshotWith({ nodes: [] }), coldSnapshot: cold },
      logger: loggerSpy().logger,
    })
    expect(result).toEqual({ checked: 2, backfilled: 0, skipped: 0 })
    expect(cold).not.toHaveBeenCalled()
  })

  it('cachedSnapshot 抛错（如某行 schema 解析失败）按缺失处理并补齐', async () => {
    const cold = vi.fn(async () => snapshotWith({ nodes: [] }))
    const result = await backfillMissingHistory({
      persistence: { list: async () => ['a'].map(header) },
      cache: {
        cachedSnapshot: () => {
          throw new Error('poisoned row')
        },
        coldSnapshot: cold,
      },
      logger: loggerSpy().logger,
    })
    expect(result).toEqual({ checked: 1, backfilled: 1, skipped: 0 })
  })

  it('单个会话 coldSnapshot 失败（如已被删除）计入 skipped 且不中断其余', async () => {
    const cold = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('not found')
      return snapshotWith({ nodes: [] })
    })
    const { warn, logger } = loggerSpy()
    const result = await backfillMissingHistory({
      persistence: { list: async () => ['a', 'b', 'c'].map(header) },
      cache: { cachedSnapshot: () => undefined, coldSnapshot: cold },
      logger,
    })
    expect(result).toEqual({ checked: 3, backfilled: 2, skipped: 1 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('会话 b'))
  })

  it('枚举会话失败时 warn 并返回空结果（不 throw）', async () => {
    const { warn, logger } = loggerSpy()
    const result = await backfillMissingHistory({
      persistence: {
        list: async () => {
          throw new Error('listing boom')
        },
      },
      cache: { cachedSnapshot: () => undefined, coldSnapshot: async () => snapshotWith({ nodes: [] }) },
      logger,
    })
    expect(result).toEqual({ checked: 0, backfilled: 0, skipped: 0 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('枚举会话失败'))
  })

  it('预先 abort 的 signal 直接跳过全部会话', async () => {
    const cold = vi.fn(async () => snapshotWith({ nodes: [] }))
    const result = await backfillMissingHistory({
      persistence: { list: async () => ['a', 'b'].map(header) },
      cache: { cachedSnapshot: () => undefined, coldSnapshot: cold },
      logger: loggerSpy().logger,
      signal: AbortSignal.abort(),
    })
    expect(result).toEqual({ checked: 0, backfilled: 0, skipped: 0 })
    expect(cold).not.toHaveBeenCalled()
  })

  it('循环中途 abort 后不再检查后续会话', async () => {
    const controller = new AbortController()
    const cold = vi.fn(async (id: string) => {
      if (id === 'b') controller.abort()
      return snapshotWith({ nodes: [] })
    })
    const result = await backfillMissingHistory({
      persistence: { list: async () => ['a', 'b', 'c', 'd'].map(header) },
      cache: { cachedSnapshot: () => undefined, coldSnapshot: cold },
      logger: loggerSpy().logger,
      signal: controller.signal,
    })
    // a 补齐、b 处理中触发 abort 并正常返回，c/d 未检查
    expect(result).toEqual({ checked: 2, backfilled: 2, skipped: 0 })
    expect(cold.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  it('进行中的 coldSnapshot 因 abort 失败不计入 skipped', async () => {
    const controller = new AbortController()
    const cold = vi.fn(async (id: string) => {
      if (id === 'b') {
        controller.abort()
        throw new Error('read aborted')
      }
      return snapshotWith({ nodes: [] })
    })
    const result = await backfillMissingHistory({
      persistence: { list: async () => ['a', 'b', 'c'].map(header) },
      cache: { cachedSnapshot: () => undefined, coldSnapshot: cold },
      logger: loggerSpy().logger,
      signal: controller.signal,
    })
    expect(result).toEqual({ checked: 2, backfilled: 1, skipped: 0 })
  })
})
