import { describe, expect, it } from 'vitest'
import {
  LEFT_COLUMN_DEFAULT_WIDTH, LEFT_COLUMN_MAX_WIDTH, LEFT_COLUMN_MIN_WIDTH, LEFT_COLUMN_RAIL_WIDTH,
  MIN_CHAT_WIDTH, clampColumnWidth, readLeftColumnPrefs, writeLeftColumnPrefs,
  type StorageLike,
} from '../src/left-column.js'

/** 内存版 localStorage 桩。 */
function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value },
  }
}

describe('clampColumnWidth', () => {
  it('正常窗口内：钳制到 [MIN, MAX]', () => {
    // 可用 1400 → 上限 480
    expect(clampColumnWidth(350, 1400)).toBe(350)
    expect(clampColumnWidth(100, 1400)).toBe(LEFT_COLUMN_MIN_WIDTH)
    expect(clampColumnWidth(600, 1400)).toBe(LEFT_COLUMN_MAX_WIDTH)
  })

  it('聊天区下限：可用宽 - 480 低于 MAX 时封顶', () => {
    // 可用 900 → 上限 420（900 - 480）
    expect(clampColumnWidth(460, 900)).toBe(420)
    expect(clampColumnWidth(240, 900)).toBe(240)
  })

  it('过窄窗口：保持 MIN，聊天让位到下限之下', () => {
    // 可用 600 → 上限 = MAX(240, 120) = 240
    expect(clampColumnWidth(500, 600)).toBe(LEFT_COLUMN_MIN_WIDTH)
    expect(clampColumnWidth(240, 600)).toBe(LEFT_COLUMN_MIN_WIDTH)
  })

  it('整数化（防抖动）', () => {
    expect(clampColumnWidth(350.6, 1400)).toBe(351)
  })

  it('常量自洽：rail 窄于 MIN，聊天下限 ≥ 最大列宽', () => {
    expect(LEFT_COLUMN_RAIL_WIDTH).toBeLessThan(LEFT_COLUMN_MIN_WIDTH)
    expect(MIN_CHAT_WIDTH).toBeGreaterThanOrEqual(LEFT_COLUMN_MAX_WIDTH)
  })
})

describe('左栏偏好持久化', () => {
  it('空存储回退默认（280 / 展开）', () => {
    expect(readLeftColumnPrefs(fakeStorage())).toEqual({
      width: LEFT_COLUMN_DEFAULT_WIDTH,
      collapsed: false,
    })
  })

  it('读写往返', () => {
    const storage = fakeStorage()
    writeLeftColumnPrefs({ width: 360, collapsed: true }, storage)
    expect(readLeftColumnPrefs(storage)).toEqual({ width: 360, collapsed: true })
  })

  it('损坏 JSON 回退默认', () => {
    expect(readLeftColumnPrefs(fakeStorage({ 'dsh-trail.left-column': '{oops' }))).toEqual({
      width: LEFT_COLUMN_DEFAULT_WIDTH,
      collapsed: false,
    })
  })

  it('类型不符的字段回退默认', () => {
    expect(readLeftColumnPrefs(fakeStorage({
      'dsh-trail.left-column': JSON.stringify({ width: 'abc', collapsed: 1 }),
    }))).toEqual({ width: LEFT_COLUMN_DEFAULT_WIDTH, collapsed: false })
  })

  it('越界宽度读入时钳制到 [MIN, MAX]', () => {
    const storage = fakeStorage({
      'dsh-trail.left-column': JSON.stringify({ width: 9999, collapsed: false }),
    })
    expect(readLeftColumnPrefs(storage).width).toBe(LEFT_COLUMN_MAX_WIDTH)
  })

  it('无 localStorage 环境安全回退（node 测试即此情形）', () => {
    expect(readLeftColumnPrefs(undefined)).toEqual({
      width: LEFT_COLUMN_DEFAULT_WIDTH,
      collapsed: false,
    })
    expect(() => writeLeftColumnPrefs({ width: 300, collapsed: false }, undefined)).not.toThrow()
  })
})
