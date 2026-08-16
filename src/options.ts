import z from '@deepseek-ai/schemastery'

/**
 * 插件配置（骨架占位）。选定具体功能后再按需扩展字段；
 * 保持「类型 + schemastery Schema + 归一化函数」三位一体，便于单测。
 */
export interface Options {
  /** 是否启用插件主体行为。 */
  enabled: boolean
  /** 日志与标识前缀。 */
  label: string
}

/** Cordis 插件配置 Schema（挂载时由 cordis 用它对 config 做校验与默认值填充）。 */
export const Config: z<Options> = z.object({
  enabled: z.boolean().default(true),
  label: z.string().default('dsh-trail'),
})

/**
 * 纯配置归一化函数：不依赖 schemastery，测试与运行时共用，
 * 语义与 `Config` 的默认值保持一致。
 */
export function normalizeOptions(input?: Partial<Options> | null): Options {
  return {
    enabled: input?.enabled ?? true,
    label: input?.label ?? 'dsh-trail',
  }
}
