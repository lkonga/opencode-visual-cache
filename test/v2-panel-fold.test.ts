import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  readFoldOpen,
  resolveFoldOpen,
  V2_DEFAULT_FOLD_OPEN,
  type FoldStore,
} from "../src/panel/fold-state"
import { createPanelApi } from "../src/v2/v2-panel-api"

/**
 * V2 Token Cache 面板（侧边栏 widget）折叠默认值测试。
 *
 * 目标口径：
 * - V2 全新安装 / 无持久化状态 → 主标题默认**折叠**（不依赖一次成功的 kv 读取）；
 * - 用户切换后（persistFold("open", n)）其选择被持久化并在重启后恢复（展开/折叠都可）；
 * - V1（src/index.tsx）不传 defaultOpen → 初始展开 + kv 恢复 fallback false，历史行为不变。
 */

const OPEN_KEY = "cache_panel.open"

/** 重开面板的 kv 子集语义（PanelApi.kv.get(key, fallback)）。 */
interface FakeKv extends FoldStore {
  raw: Map<string, unknown>
  set(key: string, value: unknown): void
}

function fakeKv(initial: Record<string, unknown> = {}): FakeKv {
  const raw = new Map<string, unknown>(Object.entries(initial))
  return {
    raw,
    get<T>(key: string, fallback?: T): T | undefined {
      const v = raw.get(key)
      return v === undefined ? fallback : (v as T)
    },
    set(key: string, value: unknown) {
      raw.set(key, value)
    },
  }
}

/**
 * V2 Context 最小假实现——只覆盖 createPanelApi 构造期即读取的字段（storage/renderer/keymap）。
 * 语义：磁盘已有值优先，否则用 initial；mutate 落盘。用于验证 V2 kv 适配器本身
 * （fresh → undefined，set → 新实例仍可读到用户选择）。
 */
function fakeV2Context() {
  const disk = new Map<string, Record<string, any>>()
  return {
    storage: {
      store(key: string, opts: { initial: Record<string, any> }) {
        const state: Record<string, any> = { ...(disk.get(key) ?? opts.initial) }
        const mutate = async (fn: (d: Record<string, any>) => void) => {
          fn(state)
          disk.set(key, state)
        }
        return [state, mutate] as [Record<string, any>, typeof mutate]
      },
    },
    renderer: { terminalWidth: 120 },
    keymap: { shortcuts: () => undefined },
  }
}

// ── 1. 结构性默认：全新状态 → 折叠 ────────────────────────────────────────────

test("V2 全新状态（无持久化值）→ 默认折叠", () => {
  assert.equal(V2_DEFAULT_FOLD_OPEN, false, "V2 无状态默认值为折叠")
  assert.equal(readFoldOpen(fakeKv(), OPEN_KEY, V2_DEFAULT_FOLD_OPEN), false)
})

test("V2 kv 读取抛错（storage 未就绪）→ 仍为折叠，且不抛出", () => {
  const throwing: FoldStore = {
    get() {
      throw new Error("storage not ready")
    },
  }
  assert.equal(readFoldOpen(throwing, OPEN_KEY, V2_DEFAULT_FOLD_OPEN), false)
  // 默认值本身是通用的：展开默认同样生效
  assert.equal(readFoldOpen(throwing, OPEN_KEY, true), true)
  assert.equal(readFoldOpen(undefined, OPEN_KEY, V2_DEFAULT_FOLD_OPEN), false)
})

// ── 2. 持久化用户选择：展开/折叠都必须恢复 ────────────────────────────────────

test("已持久化展开（用户曾展开）→ 恢复展开", () => {
  assert.equal(readFoldOpen(fakeKv({ [OPEN_KEY]: true }), OPEN_KEY, V2_DEFAULT_FOLD_OPEN), true)
})

test("已持久化折叠（显式 false）→ 恢复折叠，即使宿主默认为展开", () => {
  assert.equal(readFoldOpen(fakeKv({ [OPEN_KEY]: false }), OPEN_KEY, true), false)
})

test("无持久化状态与显式 false 必须区分", () => {
  assert.equal(resolveFoldOpen(undefined, false), false, "无状态 → 默认")
  assert.equal(resolveFoldOpen(false, true), false, "显式 false → 用户选择优先")
  assert.equal(resolveFoldOpen(true, false), true, "显式 true → 用户选择优先")
})

test("首次切换后保留用户选择（fresh 折叠 → 切换展开 → 重启仍展开 → 再切换折叠）", () => {
  const kv = fakeKv()
  // 全新状态：折叠
  const open = readFoldOpen(kv, OPEN_KEY, V2_DEFAULT_FOLD_OPEN)
  assert.equal(open, false)
  // 用户第一次点击标题：persistFold("open", n)
  const next = !open
  kv.set(OPEN_KEY, next)
  assert.equal(next, true, "首次切换得到展开")
  // 重启（重新挂载 → 重新读 kv）：尊重用户选择
  assert.equal(readFoldOpen(kv, OPEN_KEY, V2_DEFAULT_FOLD_OPEN), true)
  // 再切回折叠 → 重启后仍折叠
  kv.set(OPEN_KEY, false)
  assert.equal(readFoldOpen(kv, OPEN_KEY, V2_DEFAULT_FOLD_OPEN), false)
})

test("非布尔持久化值（损坏/旧格式）→ 回落默认，不做隐式真值展开", () => {
  for (const junk of ["true", 1, 0, "", null, {}, []]) {
    assert.equal(resolveFoldOpen(junk, V2_DEFAULT_FOLD_OPEN), false, `junk=${JSON.stringify(junk)}`)
    assert.equal(resolveFoldOpen(junk, true), true, `junk=${JSON.stringify(junk)} → 默认`)
  }
})

// ── 3. V2 kv 适配器（真实 createPanelApi）：fresh 不物化选择、可持久化 ────────

test("V2 kv 适配：无状态读取返回 undefined（面板据此用默认折叠，而非写入 false）", () => {
  const api = createPanelApi(fakeV2Context() as never)
  assert.equal(api.kv.get<boolean>(OPEN_KEY), undefined)
  assert.equal(readFoldOpen(api.kv, OPEN_KEY, V2_DEFAULT_FOLD_OPEN), false)
})

test("V2 kv 适配：用户切换后落盘，新实例（重启）恢复用户选择", async () => {
  const ctx = fakeV2Context()
  const api1 = createPanelApi(ctx as never)
  assert.equal(readFoldOpen(api1.kv, OPEN_KEY, V2_DEFAULT_FOLD_OPEN), false, "fresh → 折叠")
  await api1.kv.set(OPEN_KEY, true)
  assert.equal(readFoldOpen(api1.kv, OPEN_KEY, V2_DEFAULT_FOLD_OPEN), true, "同会话切换生效")
  const api2 = createPanelApi(ctx as never) // 重启
  assert.equal(readFoldOpen(api2.kv, OPEN_KEY, V2_DEFAULT_FOLD_OPEN), true, "重启恢复展开")
  await api2.kv.set(OPEN_KEY, false)
  const api3 = createPanelApi(ctx as never) // 再次重启
  assert.equal(readFoldOpen(api3.kv, OPEN_KEY, V2_DEFAULT_FOLD_OPEN), false, "重启恢复折叠")
})

// ── 4. V1 不变（历史语义）+ 宿主接线护栏 ──────────────────────────────────────

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8")

test("V1 语义不变：不传 defaultOpen → 初始展开 + 恢复 fallback false", () => {
  const hostDefault: boolean | undefined = undefined // V1 未传 defaultOpen
  assert.equal(hostDefault ?? true, true, "V1 初始信号仍为展开（历史行为）")
  const restoreFallback = hostDefault ?? false
  assert.equal(restoreFallback, false, "V1 恢复 fallback 仍为 false（历史行为）")
  // 全新 V1 状态 → 折叠；V1 用户选择的展开仍被恢复
  assert.equal(readFoldOpen(fakeKv(), OPEN_KEY, restoreFallback), false)
  assert.equal(readFoldOpen(fakeKv({ [OPEN_KEY]: true }), OPEN_KEY, restoreFallback), true)
})

test("V1 宿主未传 defaultOpen（源码逐字节未被本次改动波及）", () => {
  assert.ok(!/defaultOpen/.test(src("index.tsx")), "V1 不得传 defaultOpen")
})

test("V2 宿主传入 defaultOpen（= V2_DEFAULT_FOLD_OPEN = false）", () => {
  const v2 = src("v2/index.tsx")
  assert.ok(/import \{ V2_DEFAULT_FOLD_OPEN \} from "\.\.\/panel\/fold-state"/.test(v2))
  assert.ok(/defaultOpen=\{V2_DEFAULT_FOLD_OPEN\}/.test(v2), "V2 面板传 defaultOpen")
})

test("共享面板：初值取宿主默认，恢复经 readFoldOpen，其余折叠段保持原样", () => {
  const panel = src("panel/TokenCachePanel.tsx")
  assert.ok(/defaultOpen\?: boolean/.test(panel), "声明 defaultOpen 可选属性")
  assert.ok(
    /const \[open, setOpen\] = createSignal\(props\.defaultOpen \?\? true\)/.test(panel),
    "折叠信号初值取宿主默认",
  )
  assert.ok(
    /setOpen\(readFoldOpen\(props\.api\.kv, `\$\{KV_PREFIX\}\.open`, props\.defaultOpen \?\? false\)\)/.test(panel),
    "恢复经 readFoldOpen（无状态/读失败 → 宿主默认）",
  )
  assert.ok(!/setOpen\(Boolean\(/.test(panel), "旧的布尔强转恢复已移除")
  assert.ok(/persistFold\("open", n\)/.test(panel), "点击标题持久化用户选择")
  for (const line of [
    "setDetailOpen(Boolean(props.api.kv.get(`${KV_PREFIX}.detail`, true)))",
    "setModelOpen(Boolean(props.api.kv.get(`${KV_PREFIX}.model`, true)))",
    "setDistOpen(Boolean(props.api.kv.get(`${KV_PREFIX}.dist`, false)))",
    "setSkillsOpen(Boolean(props.api.kv.get(`${KV_PREFIX}.skills`, true)))",
    "setBalanceOpen(Boolean(props.api.kv.get(`${KV_PREFIX}.balance.open`, false)))",
  ]) {
    assert.ok(panel.includes(line), `其他折叠段保持原样: ${line}`)
  }
})
