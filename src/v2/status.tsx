/** @jsxImportSource @opentui/solid */

import { createMemo, For, onMount, Show } from "solid-js"
import type { Context } from "./types"
import type { PanelApi, PanelSignals } from "../panel/panel-api"
import { collectLastHitRate } from "./data"
import { desaturateTo, formatBalanceText, MAX_SAT, FALLBACK, visualWidth } from "../core"
import { createT } from "../i18n"
import { mapTheme } from "./theme"
import { buildFooterSegments, type FooterSegment } from "./footer-segments"

const KV_PREFIX = "cache_panel"

/**
 * 底部状态栏（prompt.footer.status）——对齐 V1 BottomStatusBar 统计段口径：
 * 单条命中率（最后一条有 token 的 assistant 消息）+ Tokens 总量 + 余额。
 * 余额读共享 signals.balanceState（PluginRoot 驱动轮询）；provider 不支持余额时隐藏余额段（对齐 V1）。
 * 颜色经 mapTheme（V1 形状）——与侧边栏命中率颜色同源，保证两处一致。
 * 显隐受 signals.sectionBottom 控制（/cache-section 切换），启动时从 kv 恢复偏好（对齐 V1）。
 *
 * V2 差异：**不显示命中率趋势增量（↑/↓ N.N%）**——该差值随每条消息跳动，底部提示行噪声大于信息量。
 * 稳定命中率 / Tokens / 余额保持原口径；V1 底部栏与侧边栏面板仍保留趋势（见 src/index.tsx）。
 * 分段构造抽到 footer-segments.ts（纯函数）以便测试锁定该口径。
 */
export function StatusView(props: {
  context: Context
  api: PanelApi
  signals: PanelSignals
  sessionID: string
}) {
  const t = createT(() => props.signals.langCode())

  // 恢复显隐偏好（默认显示；关闭时隐藏统计段，与宿主默认 hint 行一致）
  onMount(() => {
    try {
      const v = props.api.kv.get<boolean>(`${KV_PREFIX}.section.bottom`, true)
      props.signals.setSectionBottom(v !== false)
    } catch {}
  })

  // 与侧边栏 TokenCachePanel 同一颜色来源（mapTheme → desaturateTo）
  const pal = createMemo(() => {
    const th = mapTheme(props.context.theme) as unknown as Record<string, string>
    const sat = (k: string, fb: string) => desaturateTo(th[k], MAX_SAT, fb)
    return {
      text: sat("text", FALLBACK.text),
      muted: sat("textMuted", FALLBACK.muted),
      success: sat("success", FALLBACK.success),
      warning: sat("warning", FALLBACK.warning),
      error: sat("error", FALLBACK.error),
    }
  })

  const stats = createMemo(() => collectLastHitRate(props.context, props.sessionID))

  const hitColor = createMemo(() => {
    const r = stats().hitRate
    if (r >= 85) return pal().success
    if (r >= 70) return pal().warning
    return pal().error
  })

  // 余额文本（对齐 V1）：ok → 数值；loading → …；error → ⚠；idle → -
  const balanceText = createMemo(() => {
    const s = props.signals.balanceState()
    if (s.status === "ok" && s.data) return formatBalanceText(s.data, props.signals.balanceCurrency(), props.signals.exchangeRate())
    if (s.status === "loading") return "\u2026"
    if (s.status === "error") return "\u26a0"
    return "-"
  })

  const segs = createMemo<FooterSegment[]>(() => {
    const s = stats()
    return buildFooterSegments({
      hitRate: s.hitRate,
      hitColor: hitColor(),
      // 输入侧总量（不含输出）；与 V1 底部栏同口径
      tokensTotal: s.input + s.read + s.write,
      showBalance: !props.signals.balanceUnsupported(),
      balanceText: balanceText(),
      labels: { hit: t("barHit"), tok: t("barTok"), bal: t("barBal") },
      palette: { muted: pal().muted, text: pal().text },
    })
  })
  const segsW = createMemo(() => {
    let w = 0
    for (const sg of segs()) w += visualWidth(sg.text)
    return w
  })

  return (
    <Show when={segsW() > 0 && stats().hitRate >= 0 && props.signals.sectionBottom()}>
      <text>
        <For each={segs()}>{(sg) => <span style={{ fg: sg.color }}>{sg.text}</span>}</For>
      </text>
    </Show>
  )
}
