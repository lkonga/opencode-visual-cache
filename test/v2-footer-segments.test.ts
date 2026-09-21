import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  buildFooterSegments,
  footerText,
  formatHitText,
  type FooterSegmentInput,
} from "../src/v2/footer-segments"
import { collectLastHitRate } from "../src/v2/data"

/**
 * V2 底部状态栏（prompt.footer.status）口径测试。
 *
 * 目标口径：V2 底部栏**不显示**命中率趋势增量（↑/↓ N.N%），
 * 但**保留**稳定命中率 · Tokens · 余额；V1（src/index.tsx）与侧边栏面板趋势不变。
 */

const LABELS = { hit: "Hit", tok: "Tokens", bal: "Balance" }
const PALETTE = { muted: "MUTED", text: "TEXT" }
const SUCCESS = "SUCCESS"
const ERROR = "ERROR"

/** 基准输入：仅命中率可变，用于证明"趋势增量不进分段"。 */
function input(over: Partial<FooterSegmentInput> = {}): FooterSegmentInput {
  return {
    hitRate: 85,
    hitColor: SUCCESS,
    tokensTotal: 1000,
    showBalance: true,
    balanceText: "$12.34",
    labels: LABELS,
    palette: PALETTE,
    ...over,
  }
}

/** 最小 V2 Context 假实现：只覆盖 collectLastHitRate 用到的 surface。 */
function fakeContext(messages: unknown[], session?: unknown) {
  return {
    data: {
      session: {
        get: () => session,
        message: { list: () => messages },
      },
    },
  } as never
}

const msg = (freshInput: number, read: number, write = 0) => ({
  type: "assistant",
  tokens: { input: freshInput, cache: { read, write } },
})

/** 命中率 → 颜色（与 StatusView 同阈值）。 */
const hitColorFor = (rate: number) => (rate >= 85 ? SUCCESS : ERROR)

/** 用真实数据层算出底部栏分段（与 StatusView 同一来源与同一构造器）。 */
function readFooter(stats: { hitRate: number; input: number; read: number; write: number }, balance = "$3.00") {
  return buildFooterSegments(
    input({
      hitRate: stats.hitRate,
      hitColor: hitColorFor(stats.hitRate),
      tokensTotal: stats.input + stats.read + stats.write,
      balanceText: balance,
    }),
  )
}

// ── 1. 核心：命中率大幅上下跳动时，底部栏都不出现趋势增量 ──────────────────────

test("V2 footer 在命中率上升（+52.0pp）时不渲染趋势增量", () => {
  // 上一条 40%（600 fresh / 400 read）→ 最后一条 92%（80 fresh / 920 read）
  const stats = collectLastHitRate(fakeContext([msg(600, 400), msg(80, 920)]), "ses_1")
  assert.equal(stats.prevHitRate, 40, "数据层仍提供上一条命中率（V1 趋势所需）")
  assert.equal(stats.hitRate, 92)

  const text = footerText(readFooter(stats))
  assert.ok(!/[↑↓]/.test(text), `底部栏不得出现趋势箭头: ${JSON.stringify(text)}`)
  assert.equal(text, "Hit 92.0% · Tokens 2.0K · Balance $3.00 · ")
})

test("V2 footer 在命中率下降（−49.0pp）时同样不渲染趋势增量", () => {
  const stats = collectLastHitRate(fakeContext([msg(100, 900), msg(590, 410)]), "ses_2") // 90% → 41%
  assert.equal(stats.prevHitRate, 90)
  assert.equal(stats.hitRate, 41)

  const text = footerText(readFooter(stats))
  assert.ok(!/[↑↓]/.test(text), `底部栏不得出现趋势箭头: ${JSON.stringify(text)}`)
  assert.equal(text, "Hit 41.0% · Tokens 2.0K · Balance $3.00 · ")
})

test("趋势方向不影响分段结构：仅命中率段文本与命中率颜色变化", () => {
  const up = buildFooterSegments(input({ hitRate: 92, hitColor: SUCCESS }))
  const down = buildFooterSegments(input({ hitRate: 41, hitColor: ERROR }))

  assert.equal(up.length, 7, "命中率/标签/Tokens/标签/余额/标签/末尾分隔符 = 7 段（无趋势段）")
  assert.equal(down.length, 7)
  // 命中率段是唯一带 success/error 的段：它是命中率颜色，不是趋势色（趋势段根本不存在）
  assert.equal(up[1].color, SUCCESS)
  assert.equal(down[1].color, ERROR)
  assert.deepEqual(
    up.map((s) => s.color).filter((_, i) => i !== 1),
    down.map((s) => s.color).filter((_, i) => i !== 1),
    "除命中率段外，颜色结构一致——不存在趋势色段",
  )
  assert.deepEqual(
    up.slice(2).map((s) => s.text),
    down.slice(2).map((s) => s.text),
    "Tokens/余额/分隔段逐字相同",
  )
  assert.equal(up[1].text, "92.0%")
  assert.equal(down[1].text, "41.0%")
})

// ── 2. 保留项：稳定命中率 · Tokens · 余额 ────────────────────────────────────

test("V2 footer 精确保留 命中率 · Tokens · 余额 段（顺序/文本/颜色）", () => {
  const stats = collectLastHitRate(fakeContext([msg(150, 850)]), "ses_3") // 850 / (150+850) = 85.0%
  assert.equal(stats.hitRate, 85)

  const segs = readFooter(stats)
  assert.equal(footerText(segs), "Hit 85.0% · Tokens 1.0K · Balance $3.00 · ")
  assert.deepEqual(segs, [
    { text: "Hit ", color: "MUTED" },
    { text: "85.0%", color: SUCCESS },
    { text: " · Tokens ", color: "MUTED" },
    { text: "1.0K", color: "TEXT" },
    { text: " · Balance ", color: "MUTED" },
    { text: "$3.00", color: "TEXT" },
    { text: " · ", color: "MUTED" },
  ])
})

test("provider 不支持余额时隐藏余额段（对齐 V1），命中率与 Tokens 保留", () => {
  const text = footerText(buildFooterSegments(input({ showBalance: false })))
  assert.equal(text, "Hit 85.0% · Tokens 1.0K · ")
  assert.ok(!text.includes("Balance"))
})

test("无 token 数据：命中率为 --，且不引入趋势段", () => {
  const text = footerText(buildFooterSegments(input({ hitRate: -1, tokensTotal: 0, balanceText: "-" })))
  assert.equal(text, "Hit -- · Tokens 0 · Balance - · ")
  assert.ok(!/[↑↓]/.test(text))
})

test("命中率文本口径与 V1 一致（截断 1 位小数）", () => {
  assert.equal(formatHitText(85.99), "85.9%")
  assert.equal(formatHitText(100), "100.0%")
  assert.equal(formatHitText(0), "0.0%")
  assert.equal(formatHitText(-1), "--")
})

test("相同输入渲染完全相同——分段不携带任何随时间变化的增量", () => {
  const a = buildFooterSegments(input())
  assert.deepEqual(buildFooterSegments(input()), a)
  for (const rate of [0, 12.34, 50, 85.5, 100]) {
    assert.equal(buildFooterSegments(input({ hitRate: rate })).length, a.length, "段数不随命中率变化")
  }
})

// ── 3. 回归护栏：V1 与侧边栏趋势不受影响 ──────────────────────────────────────

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8")
/** 渲染层用 `\u2191` / `\u2193` 转义输出箭头；注释中的字面箭头不计。 */
const arrowEscapes = (text: string) => /\\u219[13]/.test(text)

test("V2 底部栏源码不再渲染/计算趋势增量", () => {
  const status = src("v2/status.tsx")
  assert.ok(!arrowEscapes(status), "status.tsx 不得保留箭头转义渲染")
  assert.ok(!/\bprevHitRate\b/.test(status), "status.tsx 不得再读取 prevHitRate")
  assert.ok(!/\btrendLabel\b|\bhasTrendData\b/.test(status), "status.tsx 不得使用趋势标签/数据")
  assert.ok(status.includes("buildFooterSegments"), "status.tsx 经纯函数构造分段")
  for (const label of ["barHit", "barTok", "barBal"]) {
    assert.ok(status.includes(label), `status.tsx 保留 ${label} 段`)
  }
})

test("V2 分段纯函数不含任何箭头/趋势输入", () => {
  const mod = src("v2/footer-segments.ts")
  assert.ok(!arrowEscapes(mod))
  assert.ok(!/\bprevHitRate\b|\btrendLabel\b/.test(mod))
})

test("V1 底部栏仍保留趋势增量与路径显示（未被本次改动波及）", () => {
  const v1 = src("index.tsx")
  assert.ok(arrowEscapes(v1), "V1 仍渲染 ↑/↓ 趋势")
  assert.ok(/\btrend =\s*createMemo/.test(v1), "V1 仍计算 trend memo")
  assert.ok(/const tr = trend\(\)/.test(v1), "V1 仍把 trend 写入统计分段")
  assert.ok(/dirDisplay\b/.test(v1), "V1 底部栏仍显示路径")
  assert.ok(/dirFallback\b/.test(v1), "V1 仅路径回退分支仍在")
  assert.ok(/\bdirectory\b/.test(v1), "V1 路径来源仍在")
})

test("共享侧边栏面板仍保留趋势（V2 侧边栏行为不变）", () => {
  const panel = src("panel/TokenCachePanel.tsx")
  assert.ok(arrowEscapes(panel), "侧边栏面板仍渲染趋势")
  assert.ok(/\btrendLabel\b/.test(panel))
  assert.ok(/\bhasTrendData\b/.test(panel))
})

test("数据层仍提供 prevHitRate（趋势供给未删除，便于 V1 复用）", () => {
  assert.ok(/\bprevHitRate\b/.test(src("v2/data.ts")))
})
