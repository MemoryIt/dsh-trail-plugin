import type { Context } from '@deepseek-ai/cordis'
import { Config, normalizeOptions, type Options } from './options.js'

/** 插件名：同时用作组合行 id 与日志命名空间。 */
export const name = 'dsh-trail-plugin'

export { Config }
export type { Options }

/**
 * Host 侧插件入口（骨架占位）。
 *
 * 当前仅演示三件事：
 * 1. 配置注入：cordis 挂载时把 `config` 传入 apply，由 schemastery Schema 校验；
 * 2. 核心服务：`ctx.logger` 等核心服务混入 ctx，无需 inject 声明；
 * 3. 可逆副作用：`ctx.effect` 注册的清理函数会在插件停止/更新时自动执行。
 *
 * 后续功能（注册 Service / Tool / 事件监听）都加在这里。
 */
export function apply(ctx: Context, config: Partial<Options> = {}): void {
  const options = normalizeOptions(config)
  const logger = ctx.logger('dsh-trail')

  if (!options.enabled) {
    logger.warn(`[${options.label}] disabled by config`)
    return
  }

  ctx.effect(() => {
    logger.info(`[${options.label}] host plugin started`)
    return () => {
      logger.info(`[${options.label}] host plugin stopped`)
    }
  })
}
