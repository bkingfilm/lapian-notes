import type { Segment, ShotDetection } from '../types'

export interface ShotStats {
  shotCount: number
  averageShotSeconds: number
  medianShotSeconds: number
  minShotSeconds: number
  maxShotSeconds: number
}

export interface CutDensityBucket {
  startTime: number
  endTime: number
  cutCount: number
}

// 切点序列还原成镜头时长序列:片头到第一个切点也算一个镜头
export function buildShotDurations(cuts: number[], duration: number, rangeStart = 0, rangeEnd = duration): number[] {
  const end = Math.min(Math.max(rangeEnd, rangeStart), Math.max(duration, rangeStart))
  if (end <= rangeStart) return []
  const inner = cuts.filter((cut) => cut > rangeStart && cut < end).sort((a, b) => a - b)
  const bounds = [rangeStart, ...inner, end]
  const durations: number[] = []
  for (let i = 1; i < bounds.length; i += 1) {
    const length = bounds[i] - bounds[i - 1]
    if (length > 0.01) durations.push(length)
  }
  return durations
}

export function getShotStats(cuts: number[], duration: number, rangeStart = 0, rangeEnd = duration): ShotStats | null {
  const durations = buildShotDurations(cuts, duration, rangeStart, rangeEnd)
  if (!durations.length) return null
  const sorted = [...durations].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  const total = durations.reduce((sum, value) => sum + value, 0)
  return {
    shotCount: durations.length,
    averageShotSeconds: total / durations.length,
    medianShotSeconds: median,
    minShotSeconds: sorted[0],
    maxShotSeconds: sorted[sorted.length - 1],
  }
}

export function getSegmentShotStats(detection: ShotDetection | undefined, segment: Segment, duration: number): ShotStats | null {
  if (!detection?.cuts.length) return null
  return getShotStats(detection.cuts, duration, segment.startTime, segment.endTime)
}

export function getCutDensity(cuts: number[], duration: number, windowSeconds = 60): CutDensityBucket[] {
  if (duration <= 0) return []
  const buckets: CutDensityBucket[] = []
  for (let start = 0; start < duration; start += windowSeconds) {
    const end = Math.min(start + windowSeconds, duration)
    buckets.push({
      startTime: start,
      endTime: end,
      cutCount: cuts.filter((cut) => cut >= start && cut < end).length,
    })
  }
  return buckets
}

export function formatShotSeconds(seconds: number): string {
  return seconds >= 10 ? `${Math.round(seconds)} 秒` : `${seconds.toFixed(1)} 秒`
}
