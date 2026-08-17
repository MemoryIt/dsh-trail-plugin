import { describe, expect, it } from 'vitest'
import { normalizeOptions } from '../src/options.js'

describe('normalizeOptions', () => {
  it('无输入时返回默认值', () => {
    expect(normalizeOptions(undefined)).toEqual({ enabled: true, label: 'dsh-trail' })
  })

  it('合并部分配置', () => {
    expect(normalizeOptions({ label: 'my-plugin' })).toEqual({
      enabled: true,
      label: 'my-plugin',
    })
    expect(normalizeOptions({ enabled: false })).toEqual({
      enabled: false,
      label: 'dsh-trail',
    })
  })

  it('忽略 null 与空对象', () => {
    expect(normalizeOptions(null)).toEqual({ enabled: true, label: 'dsh-trail' })
    expect(normalizeOptions({})).toEqual({ enabled: true, label: 'dsh-trail' })
  })
})
