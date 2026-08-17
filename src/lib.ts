/** 插件运行时状态（骨架占位）。 */
export type PluginState = 'enabled' | 'disabled'

/** 稳定的插件标识，用于日志与诊断（骨架占位）。 */
export interface PluginStamp {
  name: string
  state: PluginState
}

/**
 * 纯业务逻辑占位函数。骨架阶段用它演示「与平台无关、可直接单测」的分层；
 * 后续把真正的功能逻辑放到本文件（或按需拆分成更多模块）。
 */
export function buildStamp(name: string, enabled: boolean): PluginStamp {
  return { name, state: enabled ? 'enabled' : 'disabled' }
}
