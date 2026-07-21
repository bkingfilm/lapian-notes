import type { Frame } from '../types'

export interface ExtractProgress {
  current: number
  total: number
  time: number
}

const metadataTimeoutMs = 15000
const seekTimeoutMs = 12000

export async function extractVideoFrames(
  source: File | string,
  interval: number,
  onProgress?: (progress: ExtractProgress) => void,
  signal?: AbortSignal,
): Promise<{ duration: number; frames: Frame[] }> {
  const isRemoteUrl = typeof source === 'string'
  const videoUrl = isRemoteUrl ? source : URL.createObjectURL(source)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.src = videoUrl
  video.playsInline = true

  try {
    throwIfAborted(signal)
    await waitForEvent(video, 'loadedmetadata', signal, metadataTimeoutMs)
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (!duration) throw new Error('无法读取视频时长')

    const canvas = document.createElement('canvas')
    // 320 宽足够 AI 认场景和构图,也够时间轴缩略图用;再大只是白占空间和上传流量
    const width = Math.min(video.videoWidth || 320, 320)
    const height = Math.round(width / ((video.videoWidth || 16) / (video.videoHeight || 9)))
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建截图画布')

    const times = buildSampleTimes(duration, interval)
    const frames: Frame[] = []
    onProgress?.({ current: 0, total: times.length, time: 0 })

    for (const [index, time] of times.entries()) {
      throwIfAborted(signal)
      video.currentTime = Math.min(time, Math.max(duration - 0.05, 0))
      await waitForEvent(video, 'seeked', signal, seekTimeoutMs)
      context.drawImage(video, 0, 0, width, height)
      const blob = await canvasToJpegBlob(canvas)
      frames.push({
        id: `frame_${String(index).padStart(5, '0')}`,
        index,
        time,
        src: URL.createObjectURL(blob),
      })
      onProgress?.({ current: index + 1, total: times.length, time })
    }

    return { duration, frames }
  } finally {
    video.pause()
    if (!isRemoteUrl) URL.revokeObjectURL(videoUrl)
  }
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
