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

  it('host 声明必选服务 inject = sessionProjections / sessionProjectionCache', () => {
    expect(hostPlugin.inject).toEqual(['sessionProjections', 'sessionProjectionCache'])
  })

  it('client 入口导出浏览器 bundle factory（调用后返回 name + apply + inject）', () => {
    expect(typeof clientPlugin.default).toBe('function')
    const entry = clientPlugin.default(() => ({}))
    expect(typeof entry.name).toBe('string')
    expect(entry.name.length).toBeGreaterThan(0)
    expect(typeof entry.apply).toBe('function')
    expect(entry.inject).toEqual(['slots', 'sessions'])
  })
})

describe('bundle 安装形态（cordis.patch.yml + dsh.bundle）', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
    name: string
    files: string[]
    dsh?: { bundle?: { patch?: string } }
  }
  const doc = parse(readFileSync(`${root}/cordis.patch.yml`, 'utf8')) as unknown[]

  it('package.json 声明 bundle patch 且 files 携带该文件', () => {
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('cordis.patch.yml')
  })

  it('patch 是可解析的顶层数组', () => {
    expect(Array.isArray(doc)).toBe(true)
    expect(doc.length).toBeGreaterThan(0)
  })

  it('每项都是 loader patch 条目，insert 插入行 id/name 与包名一致', () => {
    const inserted = doc.flatMap((entry) => {
      expect(entry).toBeTypeOf('object')
      const row = entry as { insert?: unknown[] }
      return Array.isArray(row.insert) ? row.insert : []
    })
    expect(inserted.length).toBeGreaterThan(0)
    for (const row of inserted) {
      const entry = row as { id?: string; name?: string }
      expect(typeof entry.id).toBe('string')
      // 行 name 必须是包名：loader 按包名从 profile 的 node_modules 解析。
      expect(entry.name).toBe(manifest.name)
    }
    expect(inserted.some((row) => (row as { id?: string }).id === 'dsh-trail-plugin')).toBe(true)
  })
})
