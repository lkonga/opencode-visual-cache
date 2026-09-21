/**
 * 主标题折叠态解析——纯函数，无 solid/opentui 依赖，便于测试。
 *
 * 契约（V1/V2 共用）：
 * - 持久化值优先（true = 展开 / false = 折叠），用户可以折叠或展开，选择必须被尊重；
 * - 无持久化状态（undefined / null / 非布尔）→ 使用宿主默认值 defaultOpen；
 * - 读取失败（如 V2 storage 尚未就绪）→ 退回 defaultOpen，绝不抛出：折叠态是
 *   结构性默认，不能依赖一次成功的 kv 读取才生效。
 *
 * 宿主默认值：
 * - V2（src/v2/index.tsx）：defaultOpen = false → 全新安装/无状态时折叠。
 * - V1（src/index.tsx）：不传 defaultOpen → 初始 true + kv 恢复 fallback false，
 *   与历史行为逐字节一致（V1 不受本模块影响）。
 */

/** V2 无状态默认值：折叠。 */
export const V2_DEFAULT_FOLD_OPEN = false

/** 消费端最小 kv 契约（PanelApi.kv 的子集）。 */
export interface FoldStore {
  get<T>(key: string, fallback?: T): T | undefined
}

/**
 * 解析折叠态：持久化布尔值优先；无持久化状态（undefined/null/非布尔）→ defaultOpen。
 * 显式 false 与「无状态」必须区分——前者是用户选择，后者才回落默认值。
 */
export function resolveFoldOpen(persisted: unknown, defaultOpen: boolean): boolean {
  return typeof persisted === "boolean" ? persisted : defaultOpen
}

/** 从 kv 读取折叠态：无状态或读取失败 → defaultOpen（不抛）。 */
export function readFoldOpen(store: FoldStore | undefined, key: string, defaultOpen: boolean): boolean {
  if (!store) return defaultOpen
  try {
    return resolveFoldOpen(store.get<boolean>(key), defaultOpen)
  } catch {
    return defaultOpen
  }
}
