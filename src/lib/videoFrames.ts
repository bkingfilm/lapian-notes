import type { Frame } from '../types'

export interface ExtractProgress {
  current: number
  total: number
  time: number
}

const metadataTimeoutMs = 15000
const seekTimeoutMs = 12000
// 每个 worker 是一个独立 <video> 解码器,各抽一段连续区间。串行 seek 时解码器
// 大部分时间在等 seek 完成,3 路并行在普通机器上就能把吞吐拉满,再多收益递减。
const maxWorkers = 3
// 每个 worker 至少分到这么多帧才值得多开一路解码器
const minFramesPerWorker = 40

export async function extractVideoFrames(
  source: File | string,
  interval: number,
  onProgress?: (progress: ExtractProgress) => void,
  signal?: AbortSignal,
): Promise<{ duration: number; frames: Frame[] }> {
  const isRemoteUrl = typeof source === 'string'
  const videoUrl = isRemoteUrl ? source : URL.createObjectURL(source)
  // 任一 worker 失败或外部取消时,让其余 worker 立即停下来,不再空转到超时
  const internal = new AbortController()
  const onExternalAbort = () => internal.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })
  if (signal?.aborted) internal.abort()

  const videos: HTMLVideoElement[] = []
  try {
    throwIfAborted(internal.signal)
    const probe = await createSeekableVideo(videoUrl, internal.signal)
    videos.push(probe)
    const duration = Number.isFinite(probe.duration) ? probe.duration : 0
    if (!duration) throw new Error('无法读取视频时长')

    // 320 宽足够 AI 认场景和构图,也够时间轴缩略图用;再大只是白占空间和上传流量
    const width = Math.min(probe.videoWidth || 320, 320)
    const height = Math.round(width / ((probe.videoWidth || 16) / (probe.videoHeight || 9)))

    const times = buildSampleTimes(duration, interval)
    const workerCount = Math.min(maxWorkers, Math.max(1, Math.floor(times.length / minFramesPerWorker)))
    while (videos.length < workerCount) {
      videos.push(await createSeekableVideo(videoUrl, internal.signal))
    }

    const chunks = splitIntoChunks(times, videos.length)
    const frames: Frame[] = new Array(times.length)
    let completed = 0
    onProgress?.({ current: 0, total: times.length, time: 0 })

    const runChunk = async (video: HTMLVideoElement, chunk: { time: number; index: number }[]) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建截图画布')
      for (const item of chunk) {
        throwIfAborted(internal.signal)
        video.currentTime = Math.min(item.time, Math.max(duration - 0.05, 0))
        await waitForEvent(video, 'seeked', internal.signal, seekTimeoutMs)
        context.drawImage(video, 0, 0, width, height)
        const blob = await canvasToJpegBlob(canvas)
        frames[item.index] = {
          id: `frame_${String(item.index).padStart(5, '0')}`,
          index: item.index,
          time: item.time,
          src: URL.createObjectURL(blob),
        }
        completed += 1
        onProgress?.({ current: completed, total: times.length, time: item.time })
      }
    }

    await Promise.all(
      chunks.map((chunk, index) =>
        runChunk(videos[index], chunk).catch((error) => {
          internal.abort()
          throw error
        }),
      ),
    )

    return { duration, frames }
  } finally {
    signal?.removeEventListener('abort', onExternalAbort)
    for (const video of videos) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    if (!isRemoteUrl) URL.revokeObjectURL(videoUrl)
  }
}

async function createSeekableVideo(url: string, signal?: AbortSignal): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.src = url
  await waitForEvent(video, 'loadedmetadata', signal, metadataTimeoutMs)
  return video
}

// 切成连续区间而不是交错分配:worker 内部保持顺序 seek,解码器不用来回跳 GOP
function splitIntoChunks(times: number[], workerCount: number): { time: number; index: number }[][] {
  const items = times.map((time, index) => ({ time, index }))
  const chunkSize = Math.ceil(items.length / workerCount)
  const chunks: { time: number; index: number }[][] = []
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize))
  }
  return chunks
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('无法生成截图'))),
      'image/jpeg',
      0.62,
    )
  })
}

function buildSampleTimes(duration: number, interval: number): number[] {
  const safeInterval = Math.max(1, interval)
  const times: number[] = []
  for (let time = 0; time <= duration; time += safeInterval) {
    times.push(time)
  }
  if (times.length === 0 || times.at(-1)! < duration - 0.5) {
    times.push(duration)
  }
  return times
}

function waitForEvent(
  target: HTMLMediaElement,
  eventName: 'loadedmetadata' | 'seeked',
  signal?: AbortSignal,
  timeoutMs = 15000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(createVideoReadTimeoutError(eventName))
    }, timeoutMs)

    const handleAbort = () => {
      cleanup()
      reject(createAbortError())
    }

    const cleanup = () => {
      window.clearTimeout(timer)
      target.removeEventListener(eventName, handleEvent)
      target.removeEventListener('error', handleError)
      signal?.removeEventListener('abort', handleAbort)
    }

    const handleEvent = () => {
      cleanup()
      resolve()
    }

    const handleError = () => {
      cleanup()
      reject(createVideoReadError(target.error))
    }

    if (signal?.aborted) {
      cleanup()
      reject(createAbortError())
      return
    }

    target.addEventListener(eventName, handleEvent, { once: true })
    target.addEventListener('error', handleError, { once: true })
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError()
}

function createAbortError() {
  return new DOMException('已取消生成时间轴', 'AbortError')
}

function createVideoReadTimeoutError(eventName: 'loadedmetadata' | 'seeked') {
  const phase = eventName === 'loadedmetadata' ? '读取影片时长和画面信息' : '跳转到指定时间点'
  return new Error(`${phase}超时。浏览器可能不支持这个影片格式或编码，请优先转成 H.264/AAC 的 MP4 后再导入。`)
}

function createVideoReadError(error: MediaError | null) {
  const message = error?.message?.trim()
  return new Error(message ? `视频读取失败：${message}` : '视频读取失败。浏览器可能不支持这个影片格式或编码，请优先转成 H.264/AAC 的 MP4 后再导入。')
}
