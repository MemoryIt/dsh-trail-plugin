/**
 * History Index 投影层的共享类型：host 侧折叠与 client 侧渲染共用。
 * 纯类型模块，无运行时依赖（client bundle 只以 type-only 引入）。
 */
import type { SummarySource } from './summarize.js'

/** 逻辑节点类型（决定左栏行图标）。 */
export type HistoryNodeKind = 'user' | 'assistant' | 'mixed' | 'tool' | 'other'

/**
 * 一个逻辑节点（设计文档 §5.1 / §5.3 / §5.4）。
 * state 为 plain JSON，可持久化到投影缓存（session_projcache 存储域）。
 */
export interface HistoryNodeEntry {
  /** 本 session 内稳定键：turn 号（跨父子 session 对齐留待 M4 用官方谱系）。 */
  nodeKey: string
  /** 对应 turn。 */
  turn: number
  /** 树边：父节点（前一个 turn）的 nodeKey；根节点为 null。 */
  parentKey: string | null
  /** 本节点覆盖的 seq 范围。 */
  startSeq: number
  endSeq: number
  /** 安全 fork 边界：turn/end 事件 seq；turn 未结束时为 null（不可 fork）。 */
  boundarySeq: number | null
  /** 节点类型（决定图标）。 */
  kind: HistoryNodeKind
  /** 规则摘要（设计 §5.4 存储格式的 text 字段；LLM 增强后改 source）。 */
  summary: string
  /** 摘要来源：'rule' | （未来）'llm'。 */
  summarySource: SummarySource
  /** 摘要最近一次生成的事件时间（epoch ms），供未来刷新判断。 */
  updatedAt: number
  /** 内联查看用文本（有界截断；原文留在 session log，不重复存储）。 */
  text: string
  /** 本节点内的消息 seq（跳转定位用）。 */
  messageSeqs: number[]
}

/** 投影单元的 state（即 view 输出）：根→叶有序节点路径。 */
export interface HistoryIndexState {
  nodes: HistoryNodeEntry[]
}
