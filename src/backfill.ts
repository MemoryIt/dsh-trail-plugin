/**
 * Host 侧批量补齐缺失的 history 投影缓存。
 *
 * 背景：history 投影单元注册（2026-08-16）之前就已存在、之后从未再打开的会话，
 * 持久化缓存行（session_projcache）里没有 history 键 —— session.list 列表行投影
 * 走 cachedSnapshot 读缓存，缺 history → client 左栏在这些会话上为空态。
 *
 * 本模块把官方「会话打开时才触发」的冷读补齐（coldSnapshot：缓存行 + persistence
 * 尾部重放 → registry 重折叠 → fail-soft 写回）提前到启动时批量触发一次。机制与
 * 官方完全同源，不引入新存储、不改 log、不动投影单元；幂等自愈（只处理当前缺失）。
 */

/** 列表行投影所需的最小 SessionHeader 形状（不 import dsh 包）。 */
export interface SessionHeaderLike {
  id: string
  createdAt: number
  cwd?: string
}

/** 官方 ProjectionSnapshot 的最小形状。 */
export interface ProjectionSnapshotLike {
  asOfSeq: number
  values: Record<string, unknown>
}

/** ctx.sessionPersistence 的最小形状（只用到 list）。 */
export interface SessionPersistenceLike {
  list(signal?: AbortSignal): Promise<SessionHeaderLike[]>
}

/** ctx.sessionProjectionCache 的最小形状。 */
export interface SessionProjectionCacheLike {
  cachedSnapshot(meta: SessionHeaderLike): ProjectionSnapshotLike | undefined
  coldSnapshot(id: string, signal?: AbortSignal): Promise<ProjectionSnapshotLike>
}

/** 与 ctx.logger 兼容的最小日志接口。 */
export interface BackfillLoggerLike {
  info(message: string): void
  warn(message: string): void
}

export interface BackfillMissingHistoryParams {
  persistence: SessionPersistenceLike
  cache: SessionProjectionCacheLike
  logger: BackfillLoggerLike
  /** 插件停止/更新时由 ctx.effect cleanup abort，中断后台循环。 */
  signal?: AbortSignal
}

export interface BackfillMissingHistoryResult {
  /** 检查的会话总数。 */
  checked: number
  /** 判定缺失且 coldSnapshot 成功（官方已写回缓存）的会话数。 */
  backfilled: number
  /** 判定缺失但冷读失败（如会话已被删除）被跳过的会话数。 */
  skipped: number
}

/**
 * 顺序补齐所有缺 history 投影缓存的会话。
 *
 * - 判定：`cachedSnapshot(meta)` 的 `values.history` 缺失即视为缺失——包括整体
 *   无可用行（记录缺席/identity 不匹配）、history 行 version 不匹配，以及缓存读
 *   抛错（如某行 schema 解析失败）：一律按缺失处理，由 coldSnapshot 走权威重折叠。
 * - 补齐：逐个**顺序** `coldSnapshot(id, signal)`（官方 fail-soft 写回）。
 * - 错误隔离：单会话失败只 warn 并计入 skipped，不中断其余。
 * - 中断：`signal` abort 立即退出循环（进行中的 coldSnapshot 因 abort 失败时不
 *   计入 skipped——是我们主动停止，不是该会话失败）。
 * - 幂等：只处理当前缺失的会话；已补齐（含空 log 的 init 空态行）不再重复处理。
 */
export async function backfillMissingHistory(
  params: BackfillMissingHistoryParams,
): Promise<BackfillMissingHistoryResult> {
  const { persistence, cache, logger, signal } = params
  const result: BackfillMissingHistoryResult = { checked: 0, backfilled: 0, skipped: 0 }

  let metas: SessionHeaderLike[]
  try {
    metas = await persistence.list(signal)
  } catch (error) {
    logger.warn(`history backfill: 枚举会话失败，跳过本次补齐: ${String(error)}`)
    return result
  }

  for (const meta of metas) {
    if (signal?.aborted) break
    result.checked += 1

    let missing = false
    try {
      missing = cache.cachedSnapshot(meta)?.values['history'] === undefined
    } catch {
      // 缓存读异常（如某行 schema 解析失败）：按缺失处理，冷读走权威重折叠。
      missing = true
    }
    if (!missing) continue

    try {
      await cache.coldSnapshot(meta.id, signal)
      result.backfilled += 1
    } catch (error) {
      if (signal?.aborted) break
      result.skipped += 1
      logger.warn(`history backfill: 会话 ${meta.id} 冷读补齐失败，跳过: ${String(error)}`)
    }
  }

  logger.info(`history backfill: 检查 ${result.checked} 个会话，补齐 ${result.backfilled} 个，跳过 ${result.skipped} 个`)
  return result
}
