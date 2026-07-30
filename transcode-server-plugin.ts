import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// dev server 本地转码接口:浏览器不支持的视频格式(RMVB/AVI/HEVC 等)由 Node 侧调 ffmpeg
// 转成 H.264/AAC MP4,并顺带提取文本型内嵌字幕。产物按"文件名+大小"缓存,同文件重选秒完成。
//
// POST /api/transcode?filename=..&size=..   body=文件流 → { id }
// GET  /api/transcode/status?id=..          → { status, percent, videoUrl?, subtitleContent? }
// GET  /api/transcode/file/<id>.mp4         → 支持 Range 的视频流(video 元素 seek 必需)
// POST /api/transcode/subtitle?filename=..&size=..  body=文件流 → { subtitleContent? }
//   只提字幕不转码:浏览器能直接播的 MP4 不走转码,但 mov_text 内嵌字幕轨浏览器读不出,
//   由这里用 ffmpeg 秒级提取;有无字幕都按"文件名+大小"缓存,同文件重选不再上传

interface TranscodeJob {
  id: string
  status: 'uploading' | 'running' | 'done' | 'error'
  percent: number
  error?: string
  outputPath?: string
  subtitlePath?: string
}

const jobs = new Map<string, TranscodeJob>()
const workRoot = join(tmpdir(), 'lapian-transcode')

export function transcodeServerPlugin(): Plugin {
  return {
    name: 'lapian-transcode-server',
    configureServer(server) {
      server.middlewares.use('/api/transcode', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        try {
          if (req.method === 'POST' && (url.pathname === '/' || url.pathname === '')) {
            handleStart(req, res, url)
          } else if (req.method === 'POST' && url.pathname === '/subtitle') {
            handleSubtitleOnly(req, res, url)
          } else if (url.pathname === '/status') {
            handleStatus(res, url.searchParams.get('id') ?? '')
          } else if (url.pathname.startsWith('/file/')) {
            handleFile(req, res, url.pathname.slice('/file/'.length))
          } else {
            res.statusCode = 404
            res.end()
          }
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      })
    },
  }
}

function handleStart(req: IncomingMessage, res: ServerResponse, url: URL) {
  const filename = url.searchParams.get('filename') ?? 'video'
  const size = url.searchParams.get('size') ?? '0'
  const id = createHash('md5').update(`${filename}|${size}`).digest('hex').slice(0, 16)
  mkdirSync(workRoot, { recursive: true })

  const outputPath = join(workRoot, `${id}.mp4`)
  const subtitlePath = join(workRoot, `${id}.srt`)
  const existing = jobs.get(id)
  if (existing && (existing.status === 'running' || existing.status === 'uploading')) {
    respondJson(res, { id })
    return
  }
  // 跨会话缓存:产物已存在就不重转
  if (existsSync(outputPath) && statSync(outputPath).size > 0) {
    jobs.set(id, {
      id,
      status: 'done',
      percent: 100,
      outputPath,
      subtitlePath: existsSync(subtitlePath) ? subtitlePath : undefined,
    })
    respondJson(res, { id })
    return
  }

  const job: TranscodeJob = { id, status: 'uploading', percent: 0 }
  jobs.set(id, job)
  const extension = (filename.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '.bin').toLowerCase()
  const inputPath = join(workRoot, `${id}-input${extension}`)
  const sink = createWriteStream(inputPath)
  req.pipe(sink)
  const fail = (message: string) => {
    job.status = 'error'
    job.error = message
    if (!res.writableEnded) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: message }))
    }
  }
  req.on('error', (error) => fail(`上传中断：${error.message}`))
  sink.on('error', (error) => fail(`写入临时文件失败：${error.message}`))
  // 必须等文件完整落盘再响应:提前响应会让浏览器中止剩余上传,输入文件被截断
  sink.on('finish', () => {
    void runTranscode(job, inputPath, outputPath, subtitlePath)
    respondJson(res, { id })
  })
}

// 只提字幕不转码:同步接口,提取是秒级操作,不需要 job 轮询
function handleSubtitleOnly(req: IncomingMessage, res: ServerResponse, url: URL) {
  const filename = url.searchParams.get('filename') ?? 'video'
  const size = url.searchParams.get('size') ?? '0'
  const id = createHash('md5').update(`${filename}|${size}`).digest('hex').slice(0, 16)
  mkdirSync(workRoot, { recursive: true })
  const cachePath = join(workRoot, `${id}-probe.srt`)
  // 无字幕轨的结论也要缓存,不然同一部片每次重选都要白传一遍几 GB
  const missPath = join(workRoot, `${id}-probe.none`)
  if (existsSync(cachePath) && statSync(cachePath).size > 0) {
    respondJson(res, { subtitleContent: readFileSync(cachePath, 'utf-8') })
    return
  }
  if (existsSync(missPath)) {
    respondJson(res, {})
    return
  }

  const extension = (filename.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '.bin').toLowerCase()
  const inputPath = join(workRoot, `${id}-probe-input${extension}`)
  const sink = createWriteStream(inputPath)
  req.pipe(sink)
  const fail = (message: string) => {
    rmSync(inputPath, { force: true })
    if (!res.writableEnded) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: message }))
    }
  }
  req.on('error', (error) => fail(`上传中断：${error.message}`))
  sink.on('error', (error) => fail(`写入临时文件失败：${error.message}`))
  sink.on('finish', () => {
    void (async () => {
      try {
        const probe = await ffprobe(inputPath)
        const streamIndex = pickTextSubtitleStream(probe?.streams ?? [])
        if (streamIndex !== null) {
          await extractSubtitle(inputPath, streamIndex, cachePath).catch(() => undefined)
        }
        if (existsSync(cachePath) && statSync(cachePath).size > 0) {
          respondJson(res, { subtitleContent: readFileSync(cachePath, 'utf-8') })
        } else {
          writeFileSync(missPath, '')
          respondJson(res, {})
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      } finally {
        rmSync(inputPath, { force: true })
      }
    })()
  })
}

async function runTranscode(job: TranscodeJob, inputPath: string, outputPath: string, subtitlePath: string) {
  try {
    job.status = 'running'
    const probe = await ffprobe(inputPath)
    const durationSeconds = Number(probe?.format?.duration ?? 0)
    const subtitleStreamIndex = pickTextSubtitleStream(probe?.streams ?? [])
    if (subtitleStreamIndex !== null) {
      await extractSubtitle(inputPath, subtitleStreamIndex, subtitlePath).catch(() => undefined)
    }
    try {
      await runFfmpeg(buildArgs(inputPath, outputPath, 'h264_nvenc'), durationSeconds, job)
    } catch {
      // 显卡编码不可用时退回 CPU 编码
      await runFfmpeg(buildArgs(inputPath, outputPath, 'libx264'), durationSeconds, job)
    }
    if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
      throw new Error('转码没有产出有效文件')
    }
    job.outputPath = outputPath
    job.subtitlePath = existsSync(subtitlePath) && statSync(subtitlePath).size > 0 ? subtitlePath : undefined
    job.percent = 100
    job.status = 'done'
  } catch (error) {
    job.status = 'error'
    job.error = error instanceof Error ? error.message : String(error)
  } finally {
    rmSync(inputPath, { force: true })
  }
}

function buildArgs(inputPath: string, outputPath: string, videoEncoder: 'h264_nvenc' | 'libx264'): string[] {
  const quality = videoEncoder === 'h264_nvenc' ? ['-preset', 'p5', '-cq', '23'] : ['-preset', 'veryfast', '-crf', '23']
  return [
    '-y', '-v', 'error',
    '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', videoEncoder, ...quality,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    outputPath,
  ]
}

function runFfmpeg(args: string[], durationSeconds: number, job: TranscodeJob): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true })
    let stderrTail = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000)
    })
    child.stdout.on('data', (chunk: Buffer) => {
      const match = /out_time_ms=(\d+)/.exec(chunk.toString())
      if (match && durationSeconds > 0) {
        const doneSeconds = Number(match[1]) / 1_000_000
        job.percent = Math.max(job.percent, Math.min(99, Math.round((doneSeconds / durationSeconds) * 100)))
      }
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg 退出码 ${code}：${stderrTail.slice(-400)}`))
    })
  })
}

interface ProbeStream {
  index: number
  codec_type?: string
  codec_name?: string
  tags?: Record<string, string>
}

function ffprobe(inputPath: string): Promise<{ format?: { duration?: string }; streams?: ProbeStream[] } | null> {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch {
          resolve(null)
        }
      },
    )
  })
}

const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'])

function pickTextSubtitleStream(streams: ProbeStream[]): number | null {
  const textStreams = streams.filter(
    (stream) => stream.codec_type === 'subtitle' && TEXT_SUBTITLE_CODECS.has(stream.codec_name ?? ''),
  )
  if (!textStreams.length) return null
  const chinese = textStreams.find((stream) => {
    const language = stream.tags?.language?.toLowerCase() ?? ''
    const title = stream.tags?.title ?? ''
    return ['chi', 'zho', 'chs', 'cht'].includes(language) || /中|简|繁/.test(title)
  })
  return (chinese ?? textStreams[0]).index
}

function extractSubtitle(inputPath: string, streamIndex: number, subtitlePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-y', '-v', 'error', '-i', inputPath, '-map', `0:${streamIndex}`, '-f', 'srt', subtitlePath],
      { windowsHide: true, timeout: 120000 },
      (error) => (error ? reject(error) : resolve()),
    )
  })
}

function handleStatus(res: ServerResponse, id: string) {
  const job = jobs.get(id)
  if (!job) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: '任务不存在' }))
    return
  }
  respondJson(res, {
    status: job.status,
    percent: job.percent,
    error: job.error,
    videoUrl: job.status === 'done' ? `/api/transcode/file/${job.id}.mp4` : undefined,
    subtitleContent:
      job.status === 'done' && job.subtitlePath ? readFileSync(job.subtitlePath, 'utf-8') : undefined,
  })
}

function handleFile(req: IncomingMessage, res: ServerResponse, name: string) {
  const id = name.replace(/\.mp4$/i, '')
  if (!/^[a-f0-9]{16}$/.test(id)) {
    res.statusCode = 400
    res.end()
    return
  }
  const filePath = join(workRoot, `${id}.mp4`)
  if (!existsSync(filePath)) {
    res.statusCode = 404
    res.end()
    return
  }
  const totalSize = statSync(filePath).size
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', 'video/mp4')
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = Math.min(range[2] ? Number(range[2]) : totalSize - 1, totalSize - 1)
    if (start >= totalSize || start > end) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${totalSize}`)
      res.end()
      return
    }
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`)
    res.setHeader('Content-Length', end - start + 1)
    createReadStream(filePath, { start, end }).pipe(res)
    return
  }
  res.setHeader('Content-Length', totalSize)
  createReadStream(filePath).pipe(res)
}

function respondJson(res: ServerResponse, value: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}
