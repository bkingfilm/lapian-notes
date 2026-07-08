import type { Subtitle } from '../types'
import { parseSubtitle } from './srt'

export interface AutoSubtitleResult {
  subtitles: Subtitle[]
  filename: string
  source: string
}

export interface AutoSubtitleMiss {
  // 搜到过字幕但时间轴和影片对不上,已拒绝采用
  rejectedFilename: string
  rejectedLastTimestamp: number
}

// 字幕组塞的广告/水印条目,导入前过滤
const AD_PATTERN = /www\.|http|论坛|首发|QQ|微信|公众号|招募|广告|压制|本字幕由|仅供学习|禁止用于/i

// 清理任何来源的字幕:去 ASS 样式标签、去广告条
export function cleanSubtitles(subtitles: Subtitle[]): Subtitle[] {
  return subtitles
    .map((subtitle) => ({ ...subtitle, text: subtitle.text.replace(/\{\\[^}]*\}/g, '').trim() }))
    .filter((subtitle) => subtitle.text && !AD_PATTERN.test(subtitle.text))
}

// 调 dev server 的本地字幕搜索接口。静态部署环境没有该接口,404 时安静返回 null
export async function fetchAutoSubtitle(
  name: string,
  duration: number,
  signal?: AbortSignal,
): Promise<{ result: AutoSubtitleResult | null; miss?: AutoSubtitleMiss }> {
  const query = new URLSearchParams({ name, duration: String(Math.round(duration)) })
  let response: Response
  try {
    response = await fetch(`/api/find-subtitle?${query}`, { signal })
  } catch {
    return { result: null }
  }
  if (!response.ok) return { result: null }
  const data = (await response.json().catch(() => null)) as
    | { filename?: string; source?: string; content?: string; rejectedMismatch?: { filename: string; lastTimestampSeconds: number } }
    | null
  const miss = data?.rejectedMismatch
    ? { rejectedFilename: data.rejectedMismatch.filename, rejectedLastTimestamp: data.rejectedMismatch.lastTimestampSeconds }
    : undefined
  if (!data?.content || !data.filename) return { result: null, miss }
  const subtitles = cleanSubtitles(parseSubtitle(data.content))
  // 一部电影正常有几百条以上,太少说明拿到的是坏文件
  if (subtitles.length < 50) return { result: null, miss }
  return { result: { subtitles, filename: data.filename, source: data.source ?? data.filename }, miss }
}
