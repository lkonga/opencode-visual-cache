/**
 * V2 底部状态栏（prompt.footer.status）分段构造——纯函数，无 solid/opentui 依赖，便于测试。
 *
 * 口径差异（V2 底部栏与 V1 唯一的显示差异）：
 * V2 底部栏**不显示命中率趋势增量**（`↑/↓ N.N%`）。该增量是"最后一条消息 − 上一条消息"的实时差值，
 * 每轮对话都会跳动，在空间紧张的输入框提示行上噪声大于信息量。
 * V1 底部栏（src/index.tsx BottomStatusBar）与侧边栏面板（src/panel/TokenCachePanel.tsx）均**保留**趋势显示。
 *
 * 保留段：稳定命中率（最后一条有 token 的 assistant 消息）· Tokens（输入侧总量）· 余额。
 * 输入面（FooterSegmentInput）不含趋势/前一条命中率字段——趋势无法被渲染是结构性保证，而非条件判断。
 */

import { fmtCompact } from "../core"

export interface FooterSegment {
  text: string
  color: string | undefined
}

export interface FooterSegmentInput {
  /** 最后一条有 token 的 assistant 消息的命中率（0–100）；-1 = 无数据 */
  hitRate: number
  /** 命中率颜色（pal().success / warning / error） */
  hitColor: string | undefined
  /** 输入侧 token 总量（不含输出）；与 V1 底部栏同口径 */
  tokensTotal: number
  /** provider 支持余额查询时为 true；不支持时隐藏余额段（对齐 V1） */
  showBalance: boolean
  /** 余额文本：ok → 数值；loading → …；error → ⚠；idle → - */
  balanceText: string
  /** 已翻译的段标签 */
  labels: { hit: string; tok: string; bal: string }
  /** 标签与末尾分隔符颜色（pal().muted）与数值颜色（pal().text） */
  palette: { muted: string | undefined; text: string | undefined }
}

/** 段间分隔符（与 V1 一致：" · "） */
export const FOOTER_SEPARATOR = " \u00b7 "

/** 命中率文本：保留 1 位小数（截断而非四舍五入，与 V1 一致）；无数据为 "--"。 */
export function formatHitText(hitRate: number): string {
  return hitRate >= 0 ? (Math.floor(hitRate * 10) / 10).toFixed(1) + "%" : "--"
}

/** 构造 V2 底部栏分段：命中率 · Tokens · 余额（+ 末尾分隔符）。 */
export function buildFooterSegments(input: FooterSegmentInput): FooterSegment[] {
  const segs: FooterSegment[] = [
    { text: input.labels.hit + " ", color: input.palette.muted },
    { text: formatHitText(input.hitRate), color: input.hitColor },
    { text: FOOTER_SEPARATOR + input.labels.tok + " ", color: input.palette.muted },
    { text: fmtCompact(input.tokensTotal), color: input.palette.text },
  ]
  if (input.showBalance) {
    segs.push({ text: FOOTER_SEPARATOR + input.labels.bal + " ", color: input.palette.muted })
    segs.push({ text: input.balanceText, color: input.palette.text })
  }
  segs.push({ text: FOOTER_SEPARATOR, color: input.palette.muted })
  return segs
}

/** 分段拼接为单行文本（渲染等宽统计；测试与调宽口径共用）。 */
export function footerText(segs: FooterSegment[]): string {
  return segs.map((s) => s.text).join("")
}
