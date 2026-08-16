import type { Context } from '@deepseek-ai/cordis'

/** 插件名：client 半区与 host 半区同名，运行时按入口（./client）区分。 */
export const name = 'dsh-trail-plugin'

/**
 * Client 侧插件入口（骨架占位）。
 *
 * 功能未定前不注册任何 UI，仅演示「可选服务」读取模式：
 * 浏览器端的 slots / theme 等服务可能缺席，必须先判空再使用。
 *
 * 选定 UI 功能后：
 * 1. 用 Slots.listSubTree 查询目标 Slot 及注册协议（single/list/keyed/chain）；
 * 2. 在 apply 里 `const slots = ctx.get('slots')`，判空后
 *    `slots.inject('目标.slot', () => slots.register({ name, ... }, props => ...))`；
 * 3. 需要 React 时按 DSH 惯例引入 react（用 React.createElement，不用 JSX 语法糖）。
 */
export function apply(ctx: Context): void {
  const slots = ctx.get('slots', false)
  const theme = ctx.get('theme', false)
  ctx.logger('dsh-trail').info(
    `client plugin loaded (slots: ${slots !== undefined}, theme: ${theme !== undefined})`,
  )
}
