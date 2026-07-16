import type { ShotDetection } from '../types'

export interface ShotDetectProgress {
  time: number
  duration: number
  percent: number
  cutCount: number
}

// requestVideoFrameCallback 的最小类型声明,兼容旧 lib.dom
interface VideoFrameMetadataLike {
  mediaTime: number
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: VideoFrameMetadataLike) => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

const SAMPLE_WIDTH = 64
const SAMPLE_HEIGHT = 36
const HISTOGRAM_BINS = 32
// 静音加速播放的目标倍速:60Hz 显示下约每 0.27 秒视频取一帧,足够抓 0.5 秒以上的镜头
const TARGET_PLAYBACK_RATE = 16
// 两个切点最小间隔,再快的剪辑低于这个值多半是检测抖动
const MIN_SHOT_SECONDS = 0.35
// 硬切判定阈值:亮度平均绝对差(0-255)与直方图 L1 距离(0-1)
const PIXEL_DIFF_FLOOR = 20
const HIST_DIFF_FLOOR = 0.32
// 局部自适应:相对最近若干采样的运动基线要足够突出,避免快速运镜误报
const BASELINE_WINDOW = 12
const BASELINE_RATIO = 2.4
const BASELINE_MARGIN = 6

export function supportsShotDetection(): boolean {
  return typeof (HTMLVideoElement.prototype as VideoWithFrameCallback).requestVideoFrameCallback === 'function'
}

export async function detectShots(
  source: File | string,
  onProgress?: (progress: ShotDetectProgress) => void,
  signal?: AbortSignal,
): Promise<ShotDetection> {
  if (!supportsShotDetection()) {
    throw new Error('当前浏览器不支持镜头检测所需的视频帧回调,请换用较新的 Chrome / Edge。')
  }
  const isRemoteUrl = typeof source === 'string'
  const videoUrl = isRemoteUrl ? source : URL.createObjectURL(source)
  const video = document.createElement('video') as VideoWithFrameCallback
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = videoUrl

  try {
    await waitForMetadata(video, signal)
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (!duration) throw new Error('无法读取视频时长')

    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_WIDTH
    canvas.height = SAMPLE_HEIGHT
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法创建分析画布')

    const cuts: number[] = []
    const recentDiffs: number[] = []
    let prevLuma: Float32Array | null = null
    let prevHist: Float32Array | null = null
    let prevTime = 0
    let sampleCount = 0
    let lastCutAt = -Infinity

    await new Promise<void>((resolve, reject) => {
      let frameHandle = 0
      let finished = false

      const finish = (error?: Error) => {
        if (finished) return
        finished = true
        video.cancelVideoFrameCallback?.(frameHandle)
        video.removeEventListener('ended', handleEnded)
        video.removeEventListener('error', handleError)
        signal?.removeEventListener('abort', handleAbort)
        video.pause()
        if (error) reject(error)
        else resolve()
      }

      const handleEnded = () => finish()
      const handleError = () => finish(new Error('视频读取失败,浏览器可能不支持这个影片格式或编码。'))
      const handleAbort = () => finish(new DOMException('已取消镜头检测', 'AbortError'))

      const handleFrame = (_now: number, metadata: VideoFrameMetadataLike) => {
        if (finished) return
        const time = metadata.mediaTime
        try {
          context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)
          const { luma, hist } = sampleFrame(context)
          if (prevLuma && prevHist && time > prevTime) {
            const pixelDiff = meanAbsoluteDiff(luma, prevLuma)
            const histDiff = histogramDistance(hist, prevHist)
            const baseline = medianOf(recentDiffs)
            const isCut =
              pixelDiff > PIXEL_DIFF_FLOOR &&
              histDiff > HIST_DIFF_FLOOR &&
              pixelDiff > baseline * BASELINE_RATIO + BASELINE_MARGIN &&
              time - lastCutAt >= MIN_SHOT_SECONDS
            if (isCut) {
              cuts.push(time)
              lastCutAt = time
            } else {
              recentDiffs.push(pixelDiff)
              if (recentDiffs.length > BASELINE_WINDOW) recentDiffs.shift()
            }
          }
          prevLuma = luma
          prevHist = hist
          prevTime = time
          sampleCount += 1
          if (sampleCount % 8 === 0) {
            onProgress?.({
              time,
              duration,
              percent: Math.min(100, Math.round((time / duration) * 100)),
              cutCount: cuts.length,
            })
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
          return
        }
        frameHandle = video.requestVideoFrameCallback!(handleFrame)
      }

      if (signal?.aborted) {
        handleAbort()
        return
      }
      video.addEventListener('ended', handleEnded, { once: true })
      video.addEventListener('error', handleError, { once: true })
      signal?.addEventListener('abort', handleAbort, { once: true })

      video.playbackRate = resolvePlaybackRate(video)
      frameHandle = video.requestVideoFrameCallback!(handleFrame)
      video.play().catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error('无法开始播放影片进行分析。'))
      })
    })

    const sampleStep = sampleCount > 1 ? Number((duration / sampleCount).toFixed(3)) : duration
    onProgress?.({ time: duration, duration, percent: 100, cutCount: cuts.length })
    return {
      cuts: cuts.map((cut) => Number(cut.toFixed(2))),
      sampleStep,
      analyzedAt: new Date().toISOString(),
    }
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    if (!isRemoteUrl) URL.revokeObjectURL(videoUrl)
  }
}

function resolvePlaybackRate(video: HTMLVideoElement): number {
  try {
    video.playbackRate = TARGET_PLAYBACK_RATE
    return video.playbackRate || TARGET_PLAYBACK_RATE
  } catch {
    return 8
  }
}

function sampleFrame(context: CanvasRenderingContext2D): { luma: Float32Array; hist: Float32Array } {
  const { data } = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT)
  const pixelCount = SAMPLE_WIDTH * SAMPLE_HEIGHT
  const luma = new Float32Array(pixelCount)
  const hist = new Float32Array(HISTOGRAM_BINS)
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4
    const value = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]
    luma[i] = value
    hist[Math.min(HISTOGRAM_BINS - 1, Math.floor((value / 256) * HISTOGRAM_BINS))] += 1
  }
  for (let i = 0; i < HISTOGRAM_BINS; i += 1) hist[i] /= pixelCount
  return { luma, hist }
}

function meanAbsoluteDiff(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

function histogramDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i])
  return sum / 2
}

function medianOf(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function waitForMetadata(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('读取影片信息超时。浏览器可能不支持这个影片格式或编码,请优先转成 H.264/AAC 的 MP4 后再试。'))
    }, 15000)
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('loadedmetadata', handleLoaded)
      video.removeEventListener('error', handleError)
      signal?.removeEventListener('abort', handleAbort)
    }
    const handleLoaded = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('视频读取失败,浏览器可能不支持这个影片格式或编码。'))
    }
    const handleAbort = () => {
      cleanup()
      reject(new DOMException('已取消镜头检测', 'AbortError'))
    }
    if (signal?.aborted) {
      handleAbort()
      return
    }
    video.addEventListener('loadedmetadata', handleLoaded, { once: true })
    video.addEventListener('error', handleError, { once: true })
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}
