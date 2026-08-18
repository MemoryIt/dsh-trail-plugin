import type { Context } from '@deepseek-ai/cordis'
import { backfillMissingHistory, type SessionPersistenceLike, type SessionProjectionCacheLike } from './backfill.js'
import { foldHistoryIndex, initHistoryIndex } from './history/fold.js'
import { historyIndexSchema } from './history/schema.js'
import type { HistoryIndexState } from './history/types.js'
import { Config, normalizeOptions, type Options } from './options.js'

/** 插件名：同时用作组合行 id 与日志命名空间。 */
export const name = 'dsh-trail-plugin'

/** 必选服务（cordis fiber inject）：投影注册表与会话投影缓存。
 * 声明后 fiber 进入 PENDING，两者齐备才激活 apply；apply 内直接
 * `ctx.sessionProjections` / `ctx.sessionProjectionCache` 读取。
 * 官方先例：`@deepseek-ai/dsh-session-projection` 文档「domain plugins
 * register under ctx.inject(['sessionProjections'], …)」。 */
export const inject = ['sessionProjections', 'sessionProjectionCache']

export { Config }
export type { Options }

/** 投影 key：client 用 useProjection('history') 读取。 */
export const HISTORY_PROJECTION_KEY = 'history'

/** 投影 state 版本：state 字段或折叠语义变化时递增（旧缓存行自动失效重算）。 */
export const HISTORY_PROJECTION_STATE_VERSION = 2

/** sessionProjections 服务的最小结构（官方类型来自 @deepseek-ai/dsh-session-projection）。 */
interface ProjectionRegistryLike {
  register(definition: unknown): () => void
}

/** Host 必选服务在 ctx 上的最小形状（不 import dsh 包，类型来自本地接口）。 */
type HostServices = {
  sessionProjections: ProjectionRegistryLike
  sessionProjectionCache: SessionProjectionCacheLike
}

/**
 * Host 侧插件入口。
 *
 * 注册 History Index 投影单元：把每个会话的 SessionEvent 折叠为节点树
 * （src/history/fold.ts），由官方投影缓存持久化（$DSH_HOME/storages/
 * session_projcache.json），client 半区经 useProjection('history') 读取
 * 完整索引——不受对话窗口限制，重启后从缓存+尾部重放恢复。
 *
 * 依赖声明见 `inject`：`sessionProjections` / `sessionProjectionCache` 是
 * 必选服务（fiber 等待齐备后才进入 apply，缺席不再静默跳过）；
 * `sessionPersistence` 仍是可选服务（`ctx.get` 读取，headless 组装可缺席）。
 */
export function apply(ctx: Context, config: Partial<Options> = {}): void {
  const options = normalizeOptions(config)
  const logger = ctx.logger('dsh-trail')

  if (!options.enabled) {
    logger.warn(`[${options.label}] disabled by config`)
    return
  }

  ctx.effect(() => {
    logger.info(`[${options.label}] hello world from dsh-trail-plugin (host)`)
    return () => {
      logger.info(`[${options.label}] host plugin stopped`)
    }
  })

  // 必选服务（inject 声明保证 present，fiber 齐备后才进入本函数）：
  const { sessionProjections, sessionProjectionCache } = ctx as unknown as HostServices
  sessionProjections.register({
    key: HISTORY_PROJECTION_KEY,
    schema: historyIndexSchema,
    init: initHistoryIndex,
    apply: (state: HistoryIndexState, event: unknown) => foldHistoryIndex(state, event as never),
    view: (state: HistoryIndexState) => state,
    stateVersion: HISTORY_PROJECTION_STATE_VERSION,
  })

  // 启动后补齐缺 history 投影缓存的旧会话（顺序、幂等、可中断）。
  // history 投影注册前已存在、之后从未打开的会话没有持久化缓存行 → 列表行投影
  // 缺 history → 左栏空态；coldSnapshot 是官方冷读补齐路径（缓存行+尾部重放 →
  // 重折叠 → fail-soft 写回），与「会话打开时自动补齐」同一机制，只是批量提前触发。
  // sessionProjectionCache 已必选，此处只剩 sessionPersistence 需要判缺席。
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
  if (persistence !== undefined) {
    ctx.effect(() => {
      const controller = new AbortController()
      void backfillMissingHistory({ persistence, cache: sessionProjectionCache, logger, signal: controller.signal })
        .catch((error: unknown) => logger.warn(`history backfill: 后台补齐意外失败: ${String(error)}`))
      return () => controller.abort()
    })
  }
}
