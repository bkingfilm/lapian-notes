import type { Frame, Project } from '../types'
import { buildAiPrompt, buildSrtFromSubtitles, isDataImage, safeName } from './framePackage'
import type { FileSaveResult, LooseSheetInfo } from './framePackage'
import { secondsToTimecode } from './timecode'

// 国内大模型(Kimi/豆包/通义/DeepSeek)不支持上传 ZIP,这里导出它们能直接收的散文件:
// 任务说明 txt(含返回结构示例)+字幕 txt+画面速览拼图 jpg。
// 拼图代替逐帧图:国内模型单次上传文件数有限,7000 张帧图传不进去,
// 按全片均匀采样拼成大图,每格左上角烧时间码,牺牲密度换可上传。

const SHEET_COLUMNS = 4
const SHEET_ROWS = 6
const TILE_WIDTH = 320
const TILE_HEIGHT = 180
// 15 张拼图封顶(360 格),别把国内模型的上传文件数额度吃光
const MAX_TILES = SHEET_COLUMNS * SHEET_ROWS * 15
const MIN_TILE_INTERVAL_SECONDS = 5
const JPEG_QUALITY = 0.8
const PROMPT_FILE_NAME = '1-任务说明.txt'
const SUBTITLE_FILE_NAME = '2-字幕.txt'

interface LooseFile {
  name: string
  blob: Blob
}

export interface DomesticPackageResult {
  result: FileSaveResult
  fileCount: number
  sheetCount: number
  tileIntervalSeconds: number
}

export async function exportDomesticAiPackage(project: Project): Promise<DomesticPackageResult> {
  const exportableFrames = project.frames.filter((frame) => isDataImage(frame.src))
  if (!exportableFrames.length) throw new Error('没有可导出的抽帧图片，请先导入电影并完成抽帧。')

  const { sheets, tileIntervalSeconds } = await buildContactSheets(exportableFrames, project.duration)
  const sheetInfo: LooseSheetInfo = { sheetCount: sheets.length, tileIntervalSeconds }

  const files: LooseFile[] = [
    { name: PROMPT_FILE_NAME, blob: new Blob([buildAiPrompt(project, sheetInfo)], { type: 'text/plain' }) },
    ...(project.subtitles.length
      ? [{ name: SUBTITLE_FILE_NAME, blob: new Blob([buildSrtFromSubtitles(project.subtitles)], { type: 'text/plain' }) }]
      : []),
    ...sheets.map((blob, index) => ({
      name: `画面速览-${String(index + 1).padStart(2, '0')}.jpg`,
      blob,
    })),
  ]

  const folderName = safeName(project.projectTitle || project.filmTitle || '拉片项目') + '-AI分析材料'
  const result = await saveLooseFiles(folderName, files)
  return { result, fileCount: files.length, sheetCount: sheets.length, tileIntervalSeconds }
}

// 上传散文件给 AI 时配的开场白,对应 buildAiChatMessage 的免压缩包版
export function buildDomesticAiChatMessage(hasSubtitles: boolean): string {
  return [
    '请按「1-任务说明.txt」的要求分析这部电影：画面速览拼图每格左上角是该画面的时间码',
    hasSubtitles ? '，「2-字幕.txt」是全片字幕' : '',
    '。最终只输出符合任务说明末尾结构示例的 JSON，不要输出 JSON 之外的内容。',
  ].join('')
}

async function buildContactSheets(
  frames: Frame[],
  duration: number,
): Promise<{ sheets: Blob[]; tileIntervalSeconds: number }> {
  const totalSpan = Math.max(duration, frames[frames.length - 1]?.time ?? 0, 1)
  const tileIntervalSeconds = Math.max(MIN_TILE_INTERVAL_SECONDS, Math.ceil(totalSpan / MAX_TILES))
  const sampled = sampleFrames(frames, totalSpan, tileIntervalSeconds)

  const tilesPerSheet = SHEET_COLUMNS * SHEET_ROWS
  const sheets: Blob[] = []
  for (let start = 0; start < sampled.length; start += tilesPerSheet) {
    sheets.push(await drawSheet(sampled.slice(start, start + tilesPerSheet)))
  }
  return { sheets, tileIntervalSeconds }
}

function sampleFrames(frames: Frame[], totalSpan: number, intervalSeconds: number): Frame[] {
  const sampled: Frame[] = []
  let frameIndex = 0
  for (let t = 0; t <= totalSpan && sampled.length < MAX_TILES; t += intervalSeconds) {
    // frames 按时间升序,游标只进不退,找离采样点最近的帧
    while (frameIndex + 1 < frames.length && Math.abs(frames[frameIndex + 1].time - t) <= Math.abs(frames[frameIndex].time - t)) {
      frameIndex += 1
    }
    const candidate = frames[frameIndex]
    if (sampled[sampled.length - 1] !== candidate) sampled.push(candidate)
  }
  return sampled
}

async function drawSheet(tiles: Frame[]): Promise<Blob> {
  const rows = Math.ceil(tiles.length / SHEET_COLUMNS)
  const canvas = document.createElement('canvas')
  canvas.width = SHEET_COLUMNS * TILE_WIDTH
  canvas.height = rows * TILE_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建画布，浏览器不支持 Canvas。')
  context.fillStyle = '#111'
  context.fillRect(0, 0, canvas.width, canvas.height)

  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index]
    const x = (index % SHEET_COLUMNS) * TILE_WIDTH
    const y = Math.floor(index / SHEET_COLUMNS) * TILE_HEIGHT
    try {
      const image = await loadImage(tile.src)
      context.drawImage(image, x, y, TILE_WIDTH, TILE_HEIGHT)
    } catch {
      // 单帧图片失效不拖垮整张拼图,留黑格但时间码照标
    }
    const label = secondsToTimecode(tile.time)
    context.font = 'bold 15px sans-serif'
    context.textBaseline = 'top'
    context.lineWidth = 3
    context.strokeStyle = 'rgba(0, 0, 0, 0.85)'
    context.strokeText(label, x + 6, y + 5)
    context.fillStyle = '#fff'
    context.fillText(label, x + 6, y + 5)
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('拼图导出失败。'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

async function saveLooseFiles(folderName: string, files: LooseFile[]): Promise<FileSaveResult> {
  const picker = (window as Window & {
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<{
      getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<{
        getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
          createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void> }>
        }>
      }>
    }>
  }).showDirectoryPicker

  if (picker) {
    try {
      const root = await picker({ id: 'lapian-domestic-ai', mode: 'readwrite' })
      const folder = await root.getDirectoryHandle(folderName, { create: true })
      for (const file of files) {
        const handle = await folder.getFileHandle(file.name, { create: true })
        const writable = await handle.createWritable()
        await writable.write(file.blob)
        await writable.close()
      }
      return 'saved'
    } catch (error) {
      // 用户主动取消时不要偷偷改成逐个下载
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      // 其余失败(权限被拒等)落到逐个下载
    }
  }

  for (const file of files) {
    const url = URL.createObjectURL(file.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${folderName}-${file.name}`
    link.click()
    URL.revokeObjectURL(url)
    // 连点太快浏览器会吞掉部分下载
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return 'downloaded'
}
