import type { Plugin } from 'vite'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

// dev server 本地接口:按片名搜索网络字幕,下载、解压、转码成 UTF-8 后返回文本。
// 浏览器端因 CORS 无法直连字幕站,只能由 Node 侧代办。
//
// 字幕源按片名语言自动排序:片名含中文走伪射手(assrt.net)优先,纯外文片名走 OpenSubtitles 优先,
// 一个源全落空自动落到下一个源。OpenSubtitles 有两条通道:
// - 新版官方 API(api.opensubtitles.com):需要用户自备免费 API key,放在环境变量 OPENSUBTITLES_API_KEY
// - 旧版免 key 接口(rest.opensubtitles.org):零配置兜底,背后是同一个字幕库

const ASSRT_BASE = 'https://secure.assrt.net'
const OS_LEGACY_BASE = 'https://rest.opensubtitles.org'
const OS_API_BASE = 'https://api.opensubtitles.com/api/v1'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
// 旧版接口按 User-Agent 放行,TemporaryUserAgent 是官方留给未注册应用的通用标识
const OS_LEGACY_UA = 'TemporaryUserAgent'
const OS_API_UA = 'lapian-notes'
const FETCH_TIMEOUT_MS = 15000
const MAX_CANDIDATES = 4
// 所有源加起来最多下载这么多个候选,防止多源叠加把整体耗时拖过前端的 45 秒上限
const MAX_TOTAL_DOWNLOADS = 6
const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt']
const PARSABLE_FORMATS = new Set(['srt', 'ass', 'ssa', 'vtt'])
const ARCHIVE_EXTENSIONS = ['.rar', '.zip']
// 视频文件名里的画质/编码/来源词,搜索关键词里要去掉
const NOISE_TOKENS = /^(bd|hd|4k|bluray|blu-ray|webrip|web-dl|webdl|hdtv|dvdrip|bdrip|rmvb|mkv|mp4|avi|x264|x265|h264|h265|hevc|aac|ac3|dts|chs|cht|gb|big5|中字|双字|中英双字|粤语|国语|粤语中字|字幕|高清|蓝光|超清|完整版|未删减|无删减|修复版|浏览器兼容版|兼容版|转码版|\d{3,4}p|\d{4})$/i
// 视频文件名和字幕发布名共有的版本词,重合越多说明是同一个片源版本
const RELEASE_TOKENS = ['bluray', 'blu-ray', 'bd', 'web', 'hdtv', '720p', '1080p', '2160p', 'x264', 'x265', 'chd', 'wiki', 'frds']
// OpenSubtitles 字幕头尾夹带的广告条目,进入片长校验前先剥掉,否则片尾广告会把时间轴撑长
const AD_BLOCK_PATTERN = /opensubtitles|osdb\.link|advertise your product|become vip member/i

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

interface RawSubtitle {
  filename: string
  source: string
  content: string
}

interface ProviderCandidate {
  label: string
  fetchSubtitle(): Promise<RawSubtitle | null>
}

interface SubtitleProvider {
  name: string
  search(): Promise<ProviderCandidate[]>
}

export interface SearchKeywords {
  // 伪射手用中文词优先(没有中文词时退回全部词),OpenSubtitles 只用非中文词
  assrt: string
  english: string
  hasChinese: boolean
}

export function extractKeywords(rawName: string): SearchKeywords {
  const noExt = rawName.replace(/\.[a-z0-9]{2,5}$/i, '')
  const tokens = noExt
    .split(/[【】[\]()（）._\-\s]+/)
    .map((token) => token.trim())
    .filter((token) => token && !NOISE_TOKENS.test(token))
  const chinese = tokens.filter((token) => /[一-龥]/.test(token))
  const latin = tokens.filter((token) => !/[一-龥]/.test(token))
  return {
    assrt: (chinese.length ? chinese : tokens).slice(0, 3).join(' '),
    english: latin.slice(0, 3).join(' '),
    hasChinese: chinese.length > 0,
  }
}

export function providerOrder(hasChinese: boolean, hasApiKey: boolean): string[] {
  const english = hasApiKey ? ['opensubtitles-api', 'opensubtitles-legacy'] : ['opensubtitles-legacy']
  return hasChinese ? ['assrt', ...english] : [...english, 'assrt']
}

async function findSubtitle(rawName: string, durationSeconds: number): Promise<SubtitleSearchResult> {
  const keywords = extractKeywords(rawName)
  const apiKey = process.env.OPENSUBTITLES_API_KEY?.trim() ?? ''
  const providerByName: Record<string, SubtitleProvider | null> = {
    assrt: keywords.assrt ? { name: 'assrt', search: () => searchAssrt(keywords.assrt, rawName) } : null,
    'opensubtitles-legacy': keywords.english
      ? { name: 'opensubtitles-legacy', search: () => searchLegacyOpenSubtitles(keywords.english, rawName) }
      : null,
    'opensubtitles-api': keywords.english && apiKey
      ? { name: 'opensubtitles-api', search: () => searchOpenSubtitlesApi(keywords.english, rawName, apiKey) }
      : null,
  }
  const providers = providerOrder(keywords.hasChinese, Boolean(apiKey))
    .map((name) => providerByName[name])
    .filter((provider): provider is SubtitleProvider => Boolean(provider))

  let closestRejected: FoundSubtitle | null = null
  let downloadsLeft = MAX_TOTAL_DOWNLOADS
  for (const provider of providers) {
    let candidates: ProviderCandidate[]
    try {
      candidates = await provider.search()
    } catch {
      continue
    }
    for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
      if (downloadsLeft <= 0) break
      downloadsLeft -= 1
      try {
        const raw = await candidate.fetchSubtitle()
        if (!raw) continue
        const content = pruneAdBlocks(raw.content)
        const lastTimestampSeconds = findLastTimestamp(content)
        if (!lastTimestampSeconds) continue
        const found: FoundSubtitle = { ...raw, content, lastTimestampSeconds }
        // 时间轴与片长核对,对不上的一律不用:错误字幕会让 AI 把别的版本的对白当真,比没字幕更糟。
        // 闸门不对称:字幕比影片长 6 分钟以上=别的版本;而正片对白在片尾字幕滚动前就会结束,
        // 长片尾很常见,所以允许字幕最早在片尾前 15 分钟收尾
        const drift = lastTimestampSeconds - durationSeconds
        if (durationSeconds > 0 && (drift > 360 || drift < -900)) {
          if (
            !closestRejected ||
            Math.abs(lastTimestampSeconds - durationSeconds) < Math.abs(closestRejected.lastTimestampSeconds - durationSeconds)
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
    if (downloadsLeft <= 0) break
  }
  return {
    found: null,
    rejectedMismatch: closestRejected
      ? { filename: closestRejected.filename, lastTimestampSeconds: closestRejected.lastTimestampSeconds }
      : undefined,
  }
}

// 剥掉 srt/vtt 里命中广告特征的整块条目;非时间轴文本(如 .ass)原样返回
export function pruneAdBlocks(content: string): string {
  if (!content.includes('-->')) return content
  const blocks = content.split(/\r?\n\r?\n/)
  const kept = blocks.filter((block) => !(block.includes('-->') && AD_BLOCK_PATTERN.test(block)))
  if (kept.length === blocks.length) return content
  return kept.join('\n\n')
}

// ---------- 伪射手(assrt.net) ----------

interface AssrtCandidate {
  detailPath: string
  title: string
  score: number
}

async function searchAssrt(keyword: string, rawName: string): Promise<ProviderCandidate[]> {
  const html = await fetchText(`${ASSRT_BASE}/sub/?searchword=${encodeURIComponent(keyword)}`)
  const seen = new Set<string>()
  const candidates: AssrtCandidate[] = []
  const linkPattern = /href="(\/xml\/sub\/\d+\/\d+\.xml)"[^>]*>([^<]+)</g
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(html))) {
    const [, detailPath, title] = match
    if (seen.has(detailPath)) continue
    seen.add(detailPath)
    candidates.push({ detailPath, title: title.trim(), score: scoreAssrtCandidate(title, rawName) })
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .map((candidate) => ({
      label: candidate.title,
      fetchSubtitle: () => downloadAssrtCandidate(candidate),
    }))
}

function scoreAssrtCandidate(title: string, rawName: string): number {
  let score = 0
  const lowerTitle = title.toLowerCase()
  const lowerName = rawName.toLowerCase()
  for (const token of RELEASE_TOKENS) {
    if (lowerTitle.includes(token) && lowerName.includes(token)) score += 1
  }
  if (/简|chs|gb/i.test(title)) score += 2
  if (/srt/i.test(title)) score += 1
  return score
}

async function downloadAssrtCandidate(candidate: AssrtCandidate): Promise<RawSubtitle | null> {
  const detailUrl = `${ASSRT_BASE}${candidate.detailPath}`
  const detailHtml = await fetchText(detailUrl)
  const downloadMatch = detailHtml.match(/href="(\/download\/[^"]+)"/)
  if (!downloadMatch) return null
  const downloadUrl = `${ASSRT_BASE}${downloadMatch[1]}`
  const bytes = await fetchBytes(downloadUrl, { referer: detailUrl })
  const filename = decodeURIComponent(downloadMatch[1].split('/').pop() ?? 'subtitle')
  const extracted = extractSubtitleFile(filename, bytes)
  if (!extracted) return null
  return {
    filename: extracted.filename,
    source: candidate.title || extracted.filename,
    content: decodeSubtitleText(extracted.bytes),
  }
}

// ---------- OpenSubtitles 旧版免 key 接口 ----------

interface LegacyEntry {
  SubFileName?: string
  SubDownloadLink?: string
  SubFormat?: string
  SubEncoding?: string
  SubDownloadsCnt?: string
  SubSumCD?: string
  MovieReleaseName?: string
}

async function searchLegacyOpenSubtitles(keyword: string, rawName: string): Promise<ProviderCandidate[]> {
  const url = `${OS_LEGACY_BASE}/search/query-${encodeURIComponent(keyword.toLowerCase())}/sublanguageid-eng`
  const response = await fetchWithTimeout(url, { userAgent: OS_LEGACY_UA, headers: { 'X-User-Agent': OS_LEGACY_UA } })
  const entries = (await response.json()) as LegacyEntry[]
  if (!Array.isArray(entries)) return []
  return entries
    .filter((entry) => entry.SubDownloadLink && entry.SubFileName && PARSABLE_FORMATS.has(entry.SubFormat ?? ''))
    .map((entry) => ({ entry, score: scoreLegacyEntry(entry, rawName) }))
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => ({
      label: entry.SubFileName as string,
      fetchSubtitle: async (): Promise<RawSubtitle> => {
        const bytes = await fetchBytes(entry.SubDownloadLink as string, { userAgent: OS_LEGACY_UA })
        return {
          filename: entry.SubFileName as string,
          source: `OpenSubtitles · ${entry.MovieReleaseName?.trim() || (entry.SubFileName as string)}`,
          content: decodeSubtitleText(gunzipSync(bytes), entry.SubEncoding),
        }
      },
    }))
}

export function scoreLegacyEntry(entry: LegacyEntry, rawName: string): number {
  let score = 0
  if (entry.SubFormat === 'srt') score += 3
  if (entry.SubSumCD === '1') score += 2
  // 下载量取对数计入,让口碑字幕排前但不至于淹没版本匹配信号
  score += Math.min(6, Math.log10(Number(entry.SubDownloadsCnt ?? 0) + 1))
  const lowerRelease = (entry.MovieReleaseName ?? '').toLowerCase()
  const lowerName = rawName.toLowerCase()
  for (const token of RELEASE_TOKENS) {
    if (lowerRelease.includes(token) && lowerName.includes(token)) score += 1
  }
  return score
}

// ---------- OpenSubtitles 新版官方 API(需 OPENSUBTITLES_API_KEY) ----------

interface OsApiEntry {
  attributes?: {
    release?: string
    download_count?: number
    files?: Array<{ file_id?: number; file_name?: string }>
  }
}

async function searchOpenSubtitlesApi(keyword: string, rawName: string, apiKey: string): Promise<ProviderCandidate[]> {
  const url = `${OS_API_BASE}/subtitles?query=${encodeURIComponent(keyword)}&languages=en&order_by=download_count&order_direction=desc`
  const response = await fetchWithTimeout(url, { userAgent: OS_API_UA, headers: { 'Api-Key': apiKey } })
  const payload = (await response.json()) as { data?: OsApiEntry[] }
  const entries = Array.isArray(payload.data) ? payload.data : []
  const lowerName = rawName.toLowerCase()
  const releaseOverlap = (entry: OsApiEntry): number => {
    const lowerRelease = (entry.attributes?.release ?? '').toLowerCase()
    let overlap = 0
    for (const token of RELEASE_TOKENS) {
      if (lowerRelease.includes(token) && lowerName.includes(token)) overlap += 1
    }
    return overlap
  }
  return entries
    .sort(
      (a, b) =>
        releaseOverlap(b) - releaseOverlap(a) ||
        (b.attributes?.download_count ?? 0) - (a.attributes?.download_count ?? 0),
    )
    .map((entry) => {
      const file = entry.attributes?.files?.[0]
      if (!file?.file_id) return null
      const filename = file.file_name || entry.attributes?.release || `opensubtitles-${file.file_id}.srt`
      return {
        label: filename,
        fetchSubtitle: async (): Promise<RawSubtitle | null> => {
          const download = await fetchWithTimeout(`${OS_API_BASE}/download`, {
            method: 'POST',
            userAgent: OS_API_UA,
            headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: file.file_id }),
          })
          const { link } = (await download.json()) as { link?: string }
          if (!link) return null
          const bytes = await fetchBytes(link, { userAgent: OS_API_UA })
          return {
            filename,
            source: `OpenSubtitles · ${entry.attributes?.release?.trim() || filename}`,
            content: decodeSubtitleText(bytes),
          }
        },
      }
    })
    .filter((candidate): candidate is ProviderCandidate => Boolean(candidate))
}

// ---------- 通用工具 ----------

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

export function decodeSubtitleText(bytes: Buffer, encodingHint?: string): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString('utf-8')
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  // OpenSubtitles 会随字幕给出编码字段,可信时直接采用
  if (encodingHint) {
    const normalized = encodingHint.trim().toLowerCase().replace(/^cp(\d+)$/, 'windows-$1')
    try {
      return new TextDecoder(normalized, { fatal: true }).decode(bytes)
    } catch {
      // 标注的编码不可用或和内容不符,落回自动探测
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // 非 UTF-8:在 gb18030 和 big5 里选中文字符占比高的;两边都几乎没有中文,按西欧编码处理
    const gb = new TextDecoder('gb18030').decode(bytes)
    const big5 = new TextDecoder('big5').decode(bytes)
    const best = cjkRatio(gb) >= cjkRatio(big5) ? gb : big5
    if (cjkRatio(best) < 0.01) return new TextDecoder('windows-1252').decode(bytes)
    return best
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

interface FetchOptions {
  referer?: string
  userAgent?: string
  headers?: Record<string, string>
  method?: string
  body?: string
}

async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await fetchWithTimeout(url, options)
  return response.text()
}

async function fetchBytes(url: string, options: FetchOptions = {}): Promise<Buffer> {
  const response = await fetchWithTimeout(url, options)
  return Buffer.from(await response.arrayBuffer())
}

async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { 'User-Agent': options.userAgent ?? USER_AGENT, ...options.headers }
  if (options.referer) headers.Referer = options.referer
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    body: options.body,
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`请求失败 ${response.status}: ${url}`)
  return response
}
