import type { Subtitle } from '../types'

export interface DialogueDensityPoint {
  time: number
  charsPerMinute: number
}

// 台词量:中日韩按字符计,拉丁文按单词计,混排相加
const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g

export function countDialogueUnits(text: string): number {
  const cjk = text.match(CJK_PATTERN)?.length ?? 0
  const words = text
    .replace(CJK_PATTERN, ' ')
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean).length
  return cjk + words
}

// 滑动窗口统计每分钟台词量:字幕跨窗口时按时长比例分摊
export function getDialogueDensity(
  subtitles: Subtitle[],
  duration: number,
  windowSeconds = 60,
  stepSeconds = 15,
): DialogueDensityPoint[] {
  if (duration <= 0 || !subtitles.length) return []
  const entries = subtitles
    .map((subtitle) => ({
      start: subtitle.startTime,
      end: Math.max(subtitle.endTime, subtitle.startTime + 0.01),
      units: countDialogueUnits(subtitle.text),
    }))
    .filter((entry) => entry.units > 0)
  if (!entries.length) return []

  const points: DialogueDensityPoint[] = []
  for (let center = 0; center <= duration; center += stepSeconds) {
    const windowStart = Math.max(0, center - windowSeconds / 2)
    const windowEnd = Math.min(duration, center + windowSeconds / 2)
    const windowLength = Math.max(windowEnd - windowStart, 1)
    let units = 0
    for (const entry of entries) {
      const overlap = Math.min(entry.end, windowEnd) - Math.max(entry.start, windowStart)
      if (overlap <= 0) continue
      units += entry.units * (overlap / (entry.end - entry.start))
    }
    points.push({ time: center, charsPerMinute: (units / windowLength) * 60 })
  }
  return points
}

export function maxDensity(points: DialogueDensityPoint[]): number {
  return points.reduce((max, point) => Math.max(max, point.charsPerMinute), 0)
}
