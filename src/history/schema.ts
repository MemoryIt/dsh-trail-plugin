/**
 * History Index 投影单元的 zod schema（host 侧专用：框架在 view 输出离开
 * host 前用它校验）。client 半区不要 import 本模块（避免把 zod 打进浏览器
 * bundle）。
 */
import { z } from 'zod'
import type { HistoryIndexState, HistoryNodeKind } from './types.js'

const historyNodeKindSchema = z.enum(['user', 'assistant', 'mixed', 'tool', 'other'])

const historyNodeSchema = z.object({
  nodeKey: z.string(),
  turn: z.number().int().nonnegative(),
  parentKey: z.string().nullable(),
  startSeq: z.number().int().nonnegative(),
  endSeq: z.number().int().nonnegative(),
  boundarySeq: z.number().int().nonnegative().nullable(),
  kind: historyNodeKindSchema as z.ZodType<HistoryNodeKind>,
  summary: z.string(),
  text: z.string(),
  messageSeqs: z.array(z.number().int().nonnegative()),
})

/** view 输出的 wire 载荷 schema。 */
export const historyIndexSchema: z.ZodType<HistoryIndexState> = z.object({
  nodes: z.array(historyNodeSchema),
})
