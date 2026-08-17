/**
 * 规则摘要器（设计文档 §5.3）：纯函数、确定性、CJK 感知。
 * 摘要只概括本节点（本轮）内容——优先用户意图，其次助手回复；
 * 后续 M2 可选阶段可在此之上做 LLM 增强（node.summarySource 区分 'rule' | 'llm'）。
 */
import { SUMMARY_MAX_CHARS, truncate } from './text.js'

/** 摘要来源：规则 | （未来）LLM。 */
export type SummarySource = 'rule' | 'llm'

/** 句末标点（CJK 与拉丁、换行、省略号）。点在字符类内为字面量。 */
const SENTENCE_BOUNDARY = /(?<=[。！？!?；;….\n])/

/**
 * 按句子边界切分文本（保留标点）。空输入返回空数组。
 */
export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * 挑一句"有意义"的句子：优先长度 ≥ 8 的完整句，其次任何 ≥ 4 字符的句子，
 * 最后退回第一句。全空返回空串。
 */
function pickSentence(text: string): string {
  const sentences = splitSentences(text)
  const meaningful = sentences.filter((sentence) => sentence.length >= 4)
  const picked = meaningful.find((sentence) => sentence.length >= 8) ?? meaningful[0] ?? sentences[0]
  return picked ?? ''
}

/**
 * 规则摘要：优先用户消息的整句；用户无文本时用助手回复；都没有返回空串。
 * 结果统一截断到 max 字符（截断处加省略号）。
 */
export function ruleSummary(userText: string, assistantText: string, max: number = SUMMARY_MAX_CHARS): string {
  const fromUser = pickSentence(userText)
  if (fromUser !== '') return truncate(fromUser, max)
  const fromAssistant = pickSentence(assistantText)
  if (fromAssistant !== '') return truncate(fromAssistant, max)
  return ''
}
