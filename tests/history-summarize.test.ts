import { describe, expect, it } from 'vitest'
import { ruleSummary, splitSentences } from '../src/history/summarize.js'
import { SUMMARY_MAX_CHARS } from '../src/history/text.js'

describe('splitSentences', () => {
  it('按 CJK 与拉丁标点切分', () => {
    expect(splitSentences('你好。世界！')).toEqual(['你好。', '世界！'])
    expect(splitSentences('hello. world!')).toEqual(['hello.', 'world!'])
  })

  it('忽略空段', () => {
    expect(splitSentences('  一。\n二？')).toEqual(['一。', '二？'])
  })
})

describe('ruleSummary', () => {
  it('优先取用户消息的第一句完整句', () => {
    expect(ruleSummary('这个插件目前只支持线性会话。我想加导航层。', '')).toBe('这个插件目前只支持线性会话。')
  })

  it('短句时退回第一句', () => {
    expect(ruleSummary('你好', '')).toBe('你好')
  })

  it('用户无文本时用助手回复', () => {
    expect(ruleSummary('', '好的，我来分析这个问题。')).toBe('好的，我来分析这个问题。')
  })

  it('两者皆空返回空串', () => {
    expect(ruleSummary('', '')).toBe('')
  })

  it('超长单句截断并加省略号', () => {
    const long = 'x'.repeat(SUMMARY_MAX_CHARS + 50)
    const summary = ruleSummary(long, '')
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS + 1)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('无意义短句被跳过，取第一条 ≥8 字符的句子', () => {
    expect(ruleSummary('嗯。好的，我明白了，现在开始实施这个方案。', '')).toBe('好的，我明白了，现在开始实施这个方案。')
  })
})
