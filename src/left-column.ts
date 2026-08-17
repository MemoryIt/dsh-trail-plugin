/**
 * 左栏尺寸/持久化纯逻辑（client 半区，与 React/DOM 无关，可单测）。
 *
 * 设计口径（DESIGN.md §5.6）：
 * - 展开宽度默认 280，拖拽钳制在 [240, min(480, 可用宽 - 480)]——聊天区至少
 *   保留 MIN_CHAT_WIDTH，窗口过窄时优先保聊天可读（窄屏自动折叠留待后续迭代）；
 * - 宽度与折叠态按「全局」记忆（DESIGN.md 开放问题之一，默认取最简单的全局），
 *   存 localStorage 单 key；读写失败静默回退默认值（隐私模式等）。
 */
export const LEFT_COLUMN_DEFAULT_WIDTH = 280
export const LEFT_COLUMN_MIN_WIDTH = 240
export const LEFT_COLUMN_MAX_WIDTH = 480
/** 折叠后保留的竖向入口条宽度。 */
export const LEFT_COLUMN_RAIL_WIDTH = 28
/** 让位后聊天区至少保留的宽度（拖拽上限受其约束）。 */
export const MIN_CHAT_WIDTH = 480

/** localStorage key（全局记忆：宽度 + 折叠态）。 */
const PREFS_KEY = 'dsh-trail.left-column'

/** 左栏持久化偏好。 */
export interface LeftColumnPrefs {
  width: number
  collapsed: boolean
}

/** localStorage 的最小结构（便于测试注入假实现）。 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 钳制拖拽宽度。
 * - 下限 LEFT_COLUMN_MIN_WIDTH（窗口过窄时聊天让位到下限之下也可接受）；
 * - 上限 min(LEFT_COLUMN_MAX_WIDTH, available - MIN_CHAT_WIDTH)，且不低过下限。
 */
export function clampColumnWidth(width: number, available: number): number {
  const chatFloor = available - MIN_CHAT_WIDTH
  const max = Math.max(LEFT_COLUMN_MIN_WIDTH, Math.min(LEFT_COLUMN_MAX_WIDTH, chatFloor))
  return Math.min(max, Math.max(LEFT_COLUMN_MIN_WIDTH, Math.round(width)))
}

function defaultStorage(): StorageLike | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

/** 读偏好：空/损坏/类型不符一律回退默认。 */
export function readLeftColumnPrefs(
  storage: StorageLike | undefined = defaultStorage(),
): LeftColumnPrefs {
  const fallback: LeftColumnPrefs = { width: LEFT_COLUMN_DEFAULT_WIDTH, collapsed: false }
  if (storage === undefined) return fallback
  try {
    const raw = storage.getItem(PREFS_KEY)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as Partial<LeftColumnPrefs>
    return {
      width: typeof parsed.width === 'number' && Number.isFinite(parsed.width)
        ? Math.min(LEFT_COLUMN_MAX_WIDTH, Math.max(LEFT_COLUMN_MIN_WIDTH, parsed.width))
        : fallback.width,
      collapsed: typeof parsed.collapsed === 'boolean' ? parsed.collapsed : fallback.collapsed,
    }
  } catch {
    return fallback
  }
}

/** 写偏好：失败静默（隐私模式等）。 */
export function writeLeftColumnPrefs(
  prefs: LeftColumnPrefs,
  storage: StorageLike | undefined = defaultStorage(),
): void {
  if (storage === undefined) return
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // 忽略写入失败
  }
}
