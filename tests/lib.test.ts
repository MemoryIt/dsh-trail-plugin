import { describe, expect, it } from 'vitest'
import { buildStamp } from '../src/lib.js'

describe('buildStamp', () => {
  it('启用状态', () => {
    expect(buildStamp('dsh-trail', true)).toEqual({ name: 'dsh-trail', state: 'enabled' })
  })

  it('停用状态', () => {
    expect(buildStamp('dsh-trail', false)).toEqual({ name: 'dsh-trail', state: 'disabled' })
  })
})
