import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import * as hostPlugin from '../src/index.js'
import * as clientPlugin from '../src/client.js'

describe('plugin entrypoints', () => {
  it('host 入口导出 cordis 插件形状（name + apply + Config）', () => {
    expect(typeof hostPlugin.name).toBe('string')
    expect(hostPlugin.name.length).toBeGreaterThan(0)
    expect(typeof hostPlugin.apply).toBe('function')
    expect(hostPlugin.Config).toBeDefined()
  })

  it('client 入口导出 cordis 插件形状（name + apply）', () => {
    expect(typeof clientPlugin.name).toBe('string')
    expect(clientPlugin.name.length).toBeGreaterThan(0)
    expect(typeof clientPlugin.apply).toBe('function')
  })
})

describe('cordis.yml', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const doc = parse(readFileSync(`${root}/cordis.yml`, 'utf8'))

  it('可解析为组合行数组', () => {
    expect(Array.isArray(doc)).toBe(true)
    expect(doc.length).toBeGreaterThan(0)
  })

  it('每行都有 id 与 name', () => {
    for (const row of doc) {
      expect(typeof row.id).toBe('string')
      expect(typeof row.name).toBe('string')
    }
  })
})
