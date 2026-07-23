// 浏览器不支持的视频格式走 dev server 本地 ffmpeg 转码(transcode-server-plugin.ts)

export interface TranscodeResult {
  videoUrl: string
  subtitleContent?: string
}

// 先让浏览器试着读元数据:能读就不需要转码。不支持的封装(RMVB/AVI)会立刻触发 error
export function probeVideoPlayable(file: File, timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(ok)
    }
    const timer = window.setTimeout(() => done(false), timeoutMs)
    video.addEventListener('loadedmetadata', () => done(Number.isFinite(video.duration) && video.duration > 0), { once: true })
    video.addEventListener('error', () => done(false), { once: true })
    video.src = url
  })
}

export async function transcodeVideo(
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<TranscodeResult | null> {
  const query = new URLSearchParams({ filename: file.name, size: String(file.size) })
  let startResponse: Response
  try {
    startResponse = await fetch(`/api/transcode/?${query}`, { method: 'POST', body: file, signal })
  } catch {
    return null
  }
  if (!startResponse.ok) return null
  const { id } = (await startResponse.json()) as { id?: string }
  if (!id) return null

  while (true) {
    if (signal?.aborted) return null
    await sleep(1500)
    let state: { status?: string; percent?: number; videoUrl?: string; subtitleContent?: string; error?: string }
    try {
      const response = await fetch(`/api/transcode/status?id=${id}`, { signal })
      if (!response.ok) return null
      state = await response.json()
    } catch {
      return null
    }
    if (state.status === 'error') throw new Error(state.error || '本地转码失败')
    onProgress(state.percent ?? 0)
    if (state.status === 'done' && state.videoUrl) {
      return { videoUrl: state.videoUrl, subtitleContent: state.subtitleContent }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
