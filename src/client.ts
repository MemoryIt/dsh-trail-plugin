/**
 * dsh-trail-plugin client 半区（History Index 左栏原型的 hello world 版本）。
 *
 * 打包约定：本文件被 tsc 编译为 `export default function factory(require) {...}`，
 * `scripts/build-client.mjs` 再把它包装成 DSH 浏览器模块加载器 handoff
 * （`window.__ModuleLoader__.load({ id, factory })`），覆盖写回 lib/client.js
 * （即 package.json `exports["./client"]` 指向、web 端 /plugins/<id>/client.js
 * 提供的文件）。
 *
 * factory 内的 `require` 是加载器绑定的同步模块表查询：只允许解析平台模块
 * （react / @deepseek-ai/cordis / @deepseek-ai/dsh-client-ui-slots ...），
 * 其余依赖必须内联。本插件运行时只需要 react。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 模块表 require 签名（同步）。 */
type BundleRequire = (spec: string) => unknown

/** 浏览器端 slots 服务的最小结构（与 Slots.listSubTree 契约一致）。 */
interface ClientSlots {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): unknown
}

/** cordis 插件入口（client 侧）。 */
interface PluginEntry {
  name: string
  apply(ctx: Context): void
}

/** 与 src/index.ts 的 host 插件同名，运行时按入口（./client）区分。 */
const PLUGIN_NAME = 'dsh-trail-plugin'

/** 视图条目 id（出现在会话头部 tab 环里，M1 起逐步替换为真实节点）。 */
const VIEW_ID = 'history'

/** 占位节点行（M1 前使用默认内容填充）。 */
const PLACEHOLDER_ROWS = [
  { icon: '●', text: '' }, // 首行由组件注入当前 Session id
  { icon: '○', text: '节点 1 —— M1 接入真实节点列表' },
  { icon: '○', text: '节点 2 —— 支持跳转查看 / fork 续写' },
  { icon: '○', text: '节点 3 —— 多叶子角标与级联浏览' },
]

/**
 * 视图组件工厂：History Index 占位页（GUI hello world）。
 * 使用官方主题 token（--dsw-alias-*）与标准 slot props（sessionId）。
 * @param React - 平台模块 react 的命名空间。
 */
function createHistoryView(React: typeof import('react')) {
  return function HistoryView(props: { sessionId: string }): ReturnType<typeof React.createElement> {
    const rows = [
      { icon: '●', text: `当前 Session：${props.sessionId}` },
      ...PLACEHOLDER_ROWS.slice(1),
    ]
    const itemStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      marginBottom: '6px',
      borderRadius: '6px',
      background: 'var(--dsw-alias-bg-base)',
      border: '1px solid var(--dsw-alias-border-l1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
    }
    return React.createElement(
      'div',
      { style: { padding: '16px' } },
      React.createElement(
        'div',
        {
          style: {
            maxWidth: '420px',
            padding: '16px',
            borderRadius: '10px',
            background: 'var(--dsw-alias-bg-layer-1)',
            border: '1px solid var(--dsw-alias-border-l1)',
          },
        },
        React.createElement(
          'h2',
          { style: { margin: '0 0 4px', fontSize: '15px', color: 'var(--dsw-alias-label-primary)' } },
          'History Index',
        ),
        React.createElement(
          'p',
          { style: { margin: '0 0 14px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
          'hello world —— 左栏原型占位（M1 接入真实节点）',
        ),
        rows.map((row, index) => React.createElement(
          'div',
          { key: index, style: itemStyle },
          React.createElement(
            'span',
            { style: { color: 'var(--dsw-alias-brand-primary)' } },
            row.icon,
          ),
          React.createElement('span', null, row.text),
        )),
      ),
    )
  }
}

/**
 * 浏览器 bundle factory：返回 cordis 插件入口。
 * 在 apply 里把 `history` 视图注册进官方 `conversation.view` 视图环
 * （与 chat / trajectory 平级的新 tab，官方推荐的可添加席位）。
 */
export default function factory(require: BundleRequire): PluginEntry {
  const React = require('react') as typeof import('react')

  return {
    name: PLUGIN_NAME,
    apply(ctx: Context) {
      const slots = ctx.get('slots') as ClientSlots | undefined
      if (slots === undefined) return
      slots.inject('conversation.view', () => slots.register(
        { name: 'conversation.view', id: VIEW_ID, order: 20, label: '历史索引' },
        createHistoryView(React),
      ))
    },
  }
}
