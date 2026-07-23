import type { Plugin } from 'vite'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// dev server 本地接口:按片名搜索伪射手(assrt.net)字幕,下载、解压(系统 tar 支持 rar/zip)、
// 转码成 UTF-8 后返回文本。浏览器端因 CORS 无法直连字幕站,只能由 Node 侧代办。

const ASSRT_BASE = 'https://secure.assrt.net'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const FETCH_TIMEOUT_MS = 15000
const MAX_CANDIDATES = 4
const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt']
const ARCHIVE_EXTENSIONS = ['.rar', '.zip']
// 视频文件名里的画质/编码/来源词,搜索关键词里要去掉
const NOISE_TOKENS = /^(bd|hd|4k|bluray|blu-ray|webrip|web-dl|webdl|hdtv|dvdrip|bdrip|rmvb|mkv|mp4|avi|x264|x265|h264|h265|hevc|aac|ac3|dts|chs|cht|gb|big5|中字|双字|中英双字|粤语|国语|粤语中字|字幕|高清|蓝光|超清|完整版|未删减|无删减|修复版|浏览器兼容版|兼容版|转码版|\d{3,4}p|\d{4})$/i

export interface FoundSubtitle {
  filename: string
  source: string
  content: string
  lastTimestampSeconds: number
}

export interface SubtitleSearchResult {
  found: FoundSubtitle | null
  // 找到过字幕但全部和片长对不上时,记录最接近那条的信息,供前端提示
  rejectedMismatch?: { filename: string; lastTimestampSeconds: number }
}

export function subtitleFinderPlugin(): Plugin {
  return {
    name: 'lapian-subtitle-finder',
    configureServer(server) {
      server.middlewares.use('/api/find-subtitle', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const name = url.searchParams.get('name')?.trim() ?? ''
        const duration = Number(url.searchParams.get('duration') ?? 0)
        if (!name) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '缺少 name 参数' }))
          return
        }
        findSubtitle(name, duration)
          .then((result) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ...(result.found ?? {}), rejectedMismatch: result.rejectedMismatch }))
          })
          .catch((error) => {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
          })
      })
    },
  }
}

async function findSubtitle(rawName: string, durationSeconds: number): Promise<SubtitleSearchResult> {
  const keyword = extractSearchKeyword(rawName)
  if (!keyword) return { found: null }
  const candidates = await searchCandidates(keyword, rawName)
  let closestRejected: FoundSubtitle | null = null
  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    try {
      const found = await downloadCandidate(candidate)
      if (!found) continue
      // 时间轴与片长核对:尾条时间和片长差 6 分钟以内视为同版本。
      // 对不上的一律不用:错误字幕会让 AI 把别的版本的对白当真,比没字幕更糟。
      if (durationSeconds > 0 && Math.abs(found.lastTimestampSeconds - durationSeconds) > 360) {
        if (
          !closestRejected ||
          Math.abs(found.lastTimestampSeconds - durationSeconds) < Math.abs(closestRejected.lastTimestampSeconds - durationSeconds)
        ) {
          closestRejected = found
        }
        continue
      }
      return { found }
    } catch {
      continue
    }
  }
  return {
    found: null,
    rejectedMismatch: closestRejected
      ? { filename: closestRejected.filename, lastTimestampSeconds: closestRejected.lastTimestampSeconds }
      : undefined,
  }
}

function extractSearchKeyword(rawName: string): string {
  const noExt = rawName.replace(/\.[a-z0-9]{2,5}$/i, '')
  const tokens = noExt
    .split(/[-\u3010\u3011\x5b\x5d()\uff08\uff09._\s]+/)
    .map((token) => token.trim())
    .filter((token) => token && !NOISE_TOKENS.test(token))
  const chinese = tokens.filter((token) => /[一-龥]/.test(token))
  const picked = (chinese.length ? chinese : tokens).slice(0, 3).join(' ')
  return picked
}

interface Candidate {
  detailPath: string
  title: string
  score: number
}

async function searchCandidates(keyword: string, rawName: string): Promise<Candidate[]> {
  const html = await fetchText(`${ASSRT_BASE}/sub/?searchword=${encodeURIComponent(keyword)}`)
  const seen = new Set<string>()
  const candidates: Candidate[] = []
  const linkPattern = /href="(\/xml\/sub\/\d+\/\d+\.xml)"[^>]*>([^<]+)</g
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(html))) {
    const [, detailPath, title] = match
    if (seen.has(detailPath)) continue
    seen.add(detailPath)
    candidates.push({ detailPath, title: title.trim(), score: scoreCandidate(title, rawName) })
  }
  return candidates.sort((a, b) => b.score - a.score)
}

function scoreCandidate(title: string, rawName: string): number {
  let score = 0
  const lowerTitle = title.toLowerCase()
  const lowerName = rawName.toLowerCase()
  for (const token of ['bluray', 'blu-ray', 'bd', 'web', 'hdtv', '720p', '1080p', '2160p', 'x264', 'x265', 'chd', 'wiki', 'frds']) {
    if (lowerTitle.includes(token) && lowerName.includes(token)) score += 1
  }
  if (/简|chs|gb/i.test(title)) score += 2
  if (/srt/i.test(title)) score += 1
  return score
}

async function downloadCandidate(candidate: Candidate): Promise<FoundSubtitle | null> {
  const detailUrl = `${ASSRT_BASE}${candidate.detailPath}`
  const detailHtml = await fetchText(detailUrl)
  const downloadMatch = detailHtml.match(/href="(\/download\/[^"]+)"/)
  if (!downloadMatch) return null
  const downloadUrl = `${ASSRT_BASE}${downloadMatch[1]}`
  const bytes = await fetchBytes(downloadUrl, detailUrl)
  const filename = decodeURIComponent(downloadMatch[1].split('/').pop() ?? 'subtitle')
  const extracted = extractSubtitleFile(filename, bytes)
  if (!extracted) return null
  const content = decodeSubtitleText(extracted.bytes)
  const lastTimestampSeconds = findLastTimestamp(content)
  if (!lastTimestampSeconds) return null
  return {
    filename: extracted.filename,
    source: candidate.title,
    content,
    lastTimestampSeconds,
  }
}

function extractSubtitleFile(filename: string, bytes: Buffer): { filename: string; bytes: Buffer } | null {
  const lower = filename.toLowerCase()
  if (SUBTITLE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return { filename, bytes }
  }
  if (!ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return null

  const workDir = mkdtempSync(join(tmpdir(), 'lapian-sub-'))
  try {
    const archivePath = join(workDir, `archive${lower.slice(lower.lastIndexOf('.'))}`)
    writeFileSync(archivePath, bytes)
    // Windows 自带 tar(libarchive) 支持 rar v4 和 zip
    execFileSync('tar', ['-xf', archivePath, '-C', workDir], { timeout: 30000 })
    const subtitleFiles = walkSubtitleFiles(workDir)
    if (!subtitleFiles.length) return null
    subtitleFiles.sort((a, b) => scoreSubtitleFileName(b) - scoreSubtitleFileName(a))
    const best = subtitleFiles[0]
    return { filename: best.split(/[\\/]/).pop() ?? best, bytes: readFileSync(best) }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function walkSubtitleFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      results.push(...walkSubtitleFiles(fullPath))
    } else if (SUBTITLE_EXTENSIONS.some((ext) => entry.toLowerCase().endsWith(ext))) {
      results.push(fullPath)
    }
  }
  return results
}

function scoreSubtitleFileName(path: string): number {
  const lower = path.toLowerCase()
  let score = 0
  if (/chs|简|gb(?!k)/.test(lower)) score += 4
  if (/cht|繁|big5/.test(lower)) score += 2
  if (lower.endsWith('.srt')) score += 3
  if (lower.endsWith('.ass') || lower.endsWith('.ssa')) score += 1
  return score
}

function decodeSubtitleText(bytes: Buffer): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString('utf-8')
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // 非 UTF-8:在 gb18030 和 big5 里选中文字符占比高的
    const gb = new TextDecoder('gb18030').decode(bytes)
    const big5 = new TextDecoder('big5').decode(bytes)
    return cjkRatio(gb) >= cjkRatio(big5) ? gb : big5
  }
}

function cjkRatio(text: string): number {
  const sample = text.slice(0, 8000)
  if (!sample.length) return 0
  let cjk = 0
  let bad = 0
  for (const char of sample) {
    if (/[一-龥]/.test(char)) cjk += 1
    if (char === '�') bad += 1
  }
  return (cjk - bad * 3) / sample.length
}

function findLastTimestamp(content: string): number {
  let last = 0
  const pattern = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content))) {
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    if (seconds > last) last = seconds
  }
  return last
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchWithTimeout(url)
  return response.text()
}

async function fetchBytes(url: string, referer?: string): Promise<Buffer> {
  const response = await fetchWithTimeout(url, referer)
  return Buffer.from(await response.arrayBuffer())
}

async function fetchWithTimeout(url: string, referer?: string): Promise<Response> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
  if (referer) headers.Referer = referer
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`请求失败 ${response.status}: ${url}`)
  return response
}
