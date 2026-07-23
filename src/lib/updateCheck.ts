// 启动时查一次 GitHub 最新 release,发现新版就在界面提示一行。
// 结果缓存 24 小时:未登录的 GitHub API 每小时只给 60 次,别浪费在重复启动上。

const RELEASES_API = 'https://api.github.com/repos/bkingfilm/lapian-notes/releases/latest'
export const RELEASES_PAGE = 'https://github.com/bkingfilm/lapian-notes/releases/latest'
const CACHE_KEY = 'lapian.updateCheck.v1'
const DISMISS_KEY = 'lapian.updateCheck.dismissedTag'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface UpdateInfo {
  latestTag: string
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const latestTag = readCachedTag() ?? (await fetchLatestTag())
  if (!latestTag) return null
  if (!isNewerThanCurrent(latestTag)) return null
  if (safeLocalStorageGet(DISMISS_KEY) === latestTag) return null
  return { latestTag }
}

export function dismissUpdate(tag: string): void {
  safeLocalStorageSet(DISMISS_KEY, tag)
}

function readCachedTag(): string | null {
  const raw = safeLocalStorageGet(CACHE_KEY)
  if (!raw) return null
  try {
    const cached = JSON.parse(raw) as { tag?: unknown; at?: unknown }
    if (typeof cached.tag !== 'string' || typeof cached.at !== 'number') return null
    if (Date.now() - cached.at > CACHE_TTL_MS) return null
    return cached.tag
  } catch {
    return null
  }
}

async function fetchLatestTag(): Promise<string | null> {
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null
    const release = (await response.json()) as { tag_name?: unknown }
    if (typeof release.tag_name !== 'string' || !release.tag_name) return null
    safeLocalStorageSet(CACHE_KEY, JSON.stringify({ tag: release.tag_name, at: Date.now() }))
    return release.tag_name
  } catch {
    // 离线/被墙/限流都静默放弃,更新提示不值得打扰用户
    return null
  }
}

function isNewerThanCurrent(tag: string): boolean {
  const latest = parseVersion(tag)
  const current = parseVersion(__APP_VERSION__)
  if (!latest || !current) return false
  for (let index = 0; index < 3; index += 1) {
    if (latest[index] !== current[index]) return latest[index] > current[index]
  }
  return false
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 隐私模式下 localStorage 不可写,忽略
  }
}
