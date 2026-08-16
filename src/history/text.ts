/**
 * 文本提取与摘要工具（纯函数，host 折叠与 client 渲染共用）。
 */
import type { HistoryNodeKind } from './types.js'

/** 规则摘要的最大字符数。 */
export const SUMMARY_MAX_CHARS = 60

/** 内联查看文本的单节点上限（原文留在 session log，索引不重复存储全文）。 */
export const NODE_TEXT_MAX_CHARS = 4000

/** 摘要截断：压缩空白后截到 max 字符，超出加省略号。 */
export function truncate(text: string, max: number = SUMMARY_MAX_CHARS): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

/**
 * 从内容块数组提取纯文本：取所有带 `text` 字符串字段的块（text / 未来块类型
 * 均兼容），以换行连接。空数组或非数组返回空串。
 */
export function extractText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const text = (block as Record<string, unknown>).text
    if (typeof text === 'string' && text !== '') parts.push(text)
  }
  return parts.join('\n')
}

/** 有界追加：text 已达上限后不再增长。 */
export function appendBounded(text: string, more: string): string {
  if (more === '') return text
  if (text.length >= NODE_TEXT_MAX_CHARS) return text
  const joined = text === '' ? more : `${text}\n${more}`
  return joined.slice(0, NODE_TEXT_MAX_CHARS)
}

/** 类型合并：事件进入节点时更新 kind。steering 视作 user。 */
export function mergeKind(current: HistoryNodeKind, incoming: string): HistoryNodeKind {
  const role = incoming === 'steering' ? 'user' : incoming
  if (role === 'tool') {
    if (current === 'user' || current === 'assistant' || current === 'mixed') return 'mixed'
    return 'tool'
  }
  if (role === 'user') {
    if (current === 'assistant' || current === 'tool' || current === 'mixed') return 'mixed'
    return 'user'
  }
  if (role === 'assistant') {
    if (current === 'user' || current === 'tool' || current === 'mixed') return 'mixed'
    return 'assistant'
  }
  return current
}

/** kind 的兜底标签（摘要为空时展示）。 */
export function kindLabel(kind: HistoryNodeKind): string {
  switch (kind) {
    case 'user': return '用户消息'
    case 'assistant': return '助手回复'
    case 'mixed': return '对话回合'
    case 'tool': return '工具执行'
    default: return '其他'
  }
}
