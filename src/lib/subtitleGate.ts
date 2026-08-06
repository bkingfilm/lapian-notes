import type { Subtitle } from '../types'

// 字幕明显长过影片(拉错字幕版本,或影片只是片段却带了全片字幕)的判定与修剪。
// 自动搜索线在 dev server 里已有片长闸门,这里补内嵌提取和手动导入两条没有闸门的路。
// 阈值:超出量大于 min(360 秒, 影片时长)才算异常——长片对齐自动搜索线的 6 分钟错版标准,
// 短片按自身片长等比收紧(2 分钟片段带 26 分钟字幕这类畸形组合必须拦住),
// 片尾字幕广告条等几十秒级的正常超出不打扰用户。

export function lastSubtitleEndSeconds(subtitles: Subtitle[]): number {
  return subtitles.reduce((max, item) => Math.max(max, item.endTime), 0)
}

export function subtitleOverhangSeconds(subtitles: Subtitle[], duration: number): number | null {
  if (!subtitles.length || !Number.isFinite(duration) || duration <= 0) return null
  const overhang = lastSubtitleEndSeconds(subtitles) - duration
  return overhang > Math.min(360, duration) ? overhang : null
}

export function trimSubtitlesToDuration(subtitles: Subtitle[], duration: number): Subtitle[] {
  return subtitles.filter((item) => item.startTime <= duration)
}
