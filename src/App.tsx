import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Toolbar } from './components/Toolbar'
import { FrameTimeline } from './components/FrameTimeline'
import { InspectorPanel } from './components/InspectorPanel'
import { BeginnerGuide } from './components/BeginnerGuide'
import { ProjectLibrary } from './components/ProjectLibrary'
import { WorkflowGuide } from './components/WorkflowGuide'
import type {
  AiWriteMode,
  Frame,
  Project,
  Segment,
} from './types'
import { updateSegmentWithAi, createEmptyProject, createSegmentFromRange, hasMeaningfulProjectContent, normalizeLoadedProject } from './lib/project'
import { importAiAnalysis, previewAiAnalysisImport } from './lib/aiImport'
import { extractVideoFrames } from './lib/videoFrames'
import { parseSubtitle } from './lib/srt'
import { extractEmbeddedSubtitles } from './lib/videoSubtitles'
import { buildAiChatMessage, exportAiAnalysisPackage, exportProjectPackage, exportSegmentDeepDivePackage, importProjectPackage } from './lib/framePackage'
import { cleanSubtitles, fetchAutoSubtitle } from './lib/autoSubtitle'
import { probeVideoPlayable, transcodeVideo } from './lib/transcode'
import { loadAutosave, saveAutosave, clearAutosave } from './lib/autosave'
import { clearProjectFrameImages, restoreProjectFrameImages, saveProjectFrameImages } from './lib/frameStore'
import { deleteLibraryProject, listLibraryProjects, loadLibraryProject, saveProjectToLibrary, type ProjectSummary } from './lib/projectStore'
import { getProjectStoryLines } from './lib/storyLines'
import { secondsToTimecode } from './lib/timecode'
import { exportMarkdown, exportScreenplayText } from './lib/markdown'
import {
  VIDEO_PICKER_TYPES,
  deleteVideoHandle,
  loadVideoHandle,
  queryHandlePermission,
  requestHandlePermission,
  saveVideoHandle,
  supportsFilePicker,
} from './lib/videoHandleStore'
import { toPng } from 'html-to-image'

import type { ExtractProgress } from './lib/videoFrames'

type Selection =
  | { kind: 'none' }
  | { kind: 'frame'; frameId: string }
  | { kind: 'segment'; segmentId: string }
  | { kind: 'segmentFrame'; segmentId: string; frameId: string }

interface FrameRange {
  start: number
  end: number
}

type ExtractPhase = 'idle' | 'transcode' | 'subtitle' | 'metadata' | 'frames' | 'cache' | 'done' | 'canceled' | 'error'

const DEFAULT_PROJECT_TITLE = '拉片笔记'
const INITIAL_AUTOSAVE = loadAutosave()
const INITIAL_PROJECT = INITIAL_AUTOSAVE?.project ?? null

export default function App() {
  const [project, setProject] = useState<Project>(
    () => INITIAL_PROJECT ?? createEmptyProject(),
  )

  const [status, setStatus] = useState<string>('')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(() => INITIAL_AUTOSAVE?.savedAt ?? null)
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [extractProgress, setExtractProgress] = useState<ExtractProgress | null>(null)
  const [extractError, setExtractError] = useState<string>('')
  const [extractPhase, setExtractPhase] = useState<ExtractPhase>('idle')
  const [extractAbort, setExtractAbort] = useState<AbortController | null>(null)
  const [analysisAbort, setAnalysisAbort] = useState<AbortController | null>(null)
  const [markdownPreview, setMarkdownPreview] = useState<string | null>(null)
  const [aiImportText, setAiImportText] = useState('')
  const [isAiImportOpen, setIsAiImportOpen] = useState(false)
  const [libraryProjects, setLibraryProjects] = useState<ProjectSummary[] | null>(null)
  // 打开页面时若恢复了上次项目,显示一次性欢迎条,告知来源并给出口
  const [showWelcomeBack, setShowWelcomeBack] = useState<boolean>(() => Boolean(INITIAL_PROJECT))
  const [frameRangeStartId, setFrameRangeStartId] = useState<string | null>(null)
  const [frameRangeEndId, setFrameRangeEndId] = useState<string | null>(null)

  // File=用户直接选择的文件;string=本地转码后的 dev server 视频地址
  const videoFileRef = useRef<File | string | null>(null)
  // 系统文件选择器拿到的句柄,等新项目 id 生成后存进 IndexedDB
  const pendingVideoHandleRef = useRef<FileSystemFileHandle | null>(null)
  // 分享长图是否带工具署名,默认开,用户可在导出弹窗关闭
  const [shareCreditOn, setShareCreditOn] = useState<boolean>(() => localStorage.getItem('lapian.share-credit') !== 'off')
  // 播放器用的视频地址(objectURL 或转码 URL),null=未关联影片
  const [videoPlayerUrl, setVideoPlayerUrl] = useState<string | null>(null)
  const playerRef = useRef<HTMLVideoElement>(null)
  // 「播放本段」的自动暂停点:到达后暂停一次并清除,不限制后续手动播放
  const playStopAtRef = useRef<number | null>(null)
  const relinkInputRef = useRef<HTMLInputElement>(null)
  const projectRef = useRef(project)
  projectRef.current = project
  const taskAbortRef = useRef<AbortController | null>(null)
  const pkgInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const subtitleInputRef = useRef<HTMLInputElement>(null)
  const aiResultInputRef = useRef<HTMLInputElement>(null)

  const selectedFrame: Frame | undefined = useMemo(() => {
    if (selection.kind !== 'frame' && selection.kind !== 'segmentFrame') return undefined
    return project.frames.find((frame) => frame.id === selection.frameId)
  }, [selection, project.frames])

  const selectedSegment = useMemo(() => {
    if (selection.kind !== 'segment' && selection.kind !== 'segmentFrame') return undefined
    return project.segments.find((segment) => segment.id === selection.segmentId)
  }, [selection, project.segments])

  const sortedSegments = useMemo(
    () => [...project.segments].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime),
    [project.segments],
  )

  const selectedSegmentPosition = useMemo(() => {
    if (!selectedSegment) return undefined
    const index = sortedSegments.findIndex((segment) => segment.id === selectedSegment.id)
    return index >= 0 ? { index, total: sortedSegments.length } : undefined
  }, [selectedSegment, sortedSegments])

  const boundaryFrame = useMemo(() => {
    if (selection.kind !== 'segmentFrame') return undefined
    return project.frames.find((frame) => frame.id === selection.frameId)
  }, [selection, project.frames])

  const frameRange = useMemo<FrameRange | null>(() => {
    if (!frameRangeStartId || !frameRangeEndId) return null
    const start = project.frames.findIndex((frame) => frame.id === frameRangeStartId)
    const end = project.frames.findIndex((frame) => frame.id === frameRangeEndId)
    if (start < 0 || end < 0) return null
    return { start: Math.min(start, end), end: Math.max(start, end) }
  }, [frameRangeStartId, frameRangeEndId, project.frames])

  const frameImageSignature = useMemo(
    () => project.frames.map((frame) => `${frame.id}:${frame.src ? `${frame.src.length}:${frame.src.slice(-24)}` : '0'}`).join('|'),
    [project.frames],
  )

  const hasVideo = Boolean(project.sourceVideoName)
  const isTaskRunning = Boolean(extractAbort || analysisAbort)
  const analysisInProgress = Boolean(analysisAbort || (extractAbort && project.frames.length > 0))
  const aiImportPreview = useMemo(() => {
    if (!aiImportText.trim()) return null
    try {
      return { value: previewAiAnalysisImport(project, aiImportText), error: '' }
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [aiImportText, project])
  

  useEffect(() => {
    if (!INITIAL_PROJECT) return

    restoreProjectFrameImages(INITIAL_PROJECT)
      .then(({ project: restoredProject, restoredCount }) => {
        if (restoredCount > 0) {
          setProject((current) => ({ ...current, ...restoredProject }))
          setStatus(`已恢复上次项目，已找回 ${restoredCount} 帧图片。`)
        }
      })
      .catch(() => {
        setStatus('恢复项目时出现问题，已继续加载文本数据。')
      })
      .finally(() => {
        void tryRestoreVideoHandle(INITIAL_PROJECT)
      })
    // INITIAL_PROJECT is a mount-time snapshot; restoration must run only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!hasMeaningfulProjectContent(project)) {
        clearAutosave()
        setLastSavedAt(null)
        return
      }
      if (saveAutosave(project)) {
        setLastSavedAt(new Date().toISOString())
      } else {
        setStatus('自动保存失败：本地存储空间不足，请手动“保存项目”导出 ZIP。')
      }
      void saveProjectToLibrary(project).catch(() => undefined)
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [project])

  useEffect(() => {
    if (!hasMeaningfulProjectContent(project) || !frameImageSignature) return
    const timer = window.setTimeout(() => {
      saveProjectFrameImages(project).catch(() => {
        setStatus('当前帧图片保存失败，将在下一次继续尝试。')
      })
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [frameImageSignature, project])

  // 防止影片没拖准虚线框时,浏览器默认行为直接打开视频文件顶掉整个应用
  useEffect(() => {
    const prevent = (event: DragEvent) => {
      event.preventDefault()
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  const updateProject = (patch: Partial<Project>) => {
    setProject((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))
  }

  function stripExtension(name: string) {
    return name.replace(/\.[^.]+$/, '')
  }

  function updateStatus(text: string) {
    setStatus(text)
  }

  function clearFrameRange() {
    setFrameRangeStartId(null)
    setFrameRangeEndId(null)
  }

  function resetSelection() {
    setSelection({ kind: 'none' })
    clearFrameRange()
  }

  function clearVideoFileReference() {
    videoFileRef.current = null
    setVideoPlayerUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
      return null
    })
  }

  function attachPlayableVideo(source: File | string) {
    setVideoPlayerUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
      return typeof source === 'string' ? source : URL.createObjectURL(source)
    })
  }

  function handleSeekTo(time: number, stopAt?: number) {
    const player = playerRef.current
    if (!player || !videoPlayerUrl) {
      setStatus('还没有关联影片文件:在右侧播放器面板点「关联影片文件」选择本片,即可点时间跳转播放。')
      return
    }
    playStopAtRef.current = stopAt !== undefined && stopAt > time ? stopAt : null
    player.currentTime = Math.max(0, time)
    void player.play().catch(() => undefined)
  }

  function handlePlayerTimeUpdate() {
    const stopAt = playStopAtRef.current
    const player = playerRef.current
    if (stopAt === null || !player) return
    if (player.currentTime >= stopAt) {
      player.pause()
      playStopAtRef.current = null
    }
  }

  // 「关联影片文件」:有存过的句柄就一键接回(最多点一次浏览器的"允许"),
  // 没有或失败再走文件选择;选择器选中的文件顺手把句柄存上,下次就免翻了
  async function handleRelinkClick() {
    const handle = await loadVideoHandle(project.id).catch(() => null)
    if (handle) {
      const permission = await requestHandlePermission(handle)
      if (permission === 'granted') {
        try {
          const file = await handle.getFile()
          videoFileRef.current = file
          attachPlayableVideo(file)
          setStatus(`已接回影片：${file.name}，可以播放和重新抽帧了。`)
          return
        } catch {
          // 原文件可能被移动或删除,走手动选择
        }
      }
    }
    if (supportsFilePicker()) {
      let picked: FileSystemFileHandle | undefined
      try {
        const handles = await window.showOpenFilePicker!({ types: VIDEO_PICKER_TYPES })
        picked = handles[0]
      } catch {
        return // 用户取消
      }
      if (!picked) return
      try {
        const file = await picked.getFile()
        void saveVideoHandle(project.id, picked).catch(() => undefined)
        videoFileRef.current = file
        attachPlayableVideo(file)
        const expected = project.sourceVideoName
        setStatus(
          expected && file.name !== expected
            ? `已关联影片:${file.name}。注意和项目记录的「${expected}」文件名不同,请确认是同一部电影。`
            : `已关联影片:${file.name},可以播放和重新抽帧了。`,
        )
      } catch {
        setStatus('读取所选文件失败，请重试。')
      }
      return
    }
    relinkInputRef.current?.click()
  }

  // 项目载入后尝试用存过的句柄自动接回影片:浏览器还记得授权时零点击,
  // 只剩"prompt"状态时给个提示引导去点「关联影片文件」
  async function tryRestoreVideoHandle(target: Project) {
    if (!target.sourceVideoName || videoFileRef.current) return
    const handle = await loadVideoHandle(target.id).catch(() => null)
    if (!handle) return
    const permission = await queryHandlePermission(handle)
    if (permission === 'granted') {
      try {
        const file = await handle.getFile()
        videoFileRef.current = file
        attachPlayableVideo(file)
        setStatus((current) => `${current ? `${current} ` : ''}影片已自动接回：${file.name}。`)
      } catch {
        // 原文件不在了,保持未关联状态
      }
      return
    }
    if (permission === 'prompt') {
      setStatus((current) => `${current ? `${current} ` : ''}上次的影片文件还记着,点右侧「关联影片文件」一键接回。`)
    }
  }

  // 项目恢复后重新关联影片:只接上播放和抽帧能力,不改动项目内容
  function handleRelinkVideo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    videoFileRef.current = file
    attachPlayableVideo(file)
    const expected = project.sourceVideoName
    setStatus(
      expected && file.name !== expected
        ? `已关联影片:${file.name}。注意和项目记录的「${expected}」文件名不同,请确认是同一部电影。`
        : `已关联影片:${file.name},可以播放和重新抽帧了。`,
    )
    e.target.value = ''
  }

  function revokeFrameObjectUrls(frames: Frame[]) {
    for (const frame of frames) {
      if (frame.src?.startsWith('blob:')) URL.revokeObjectURL(frame.src)
    }
  }

  function setFrameRange(startFrameId: string, endFrameId: string | null = null) {
    setFrameRangeStartId(startFrameId)
    setFrameRangeEndId(endFrameId ?? startFrameId)
  }

  async function handleOpenLibrary() {
    try {
      setLibraryProjects(await listLibraryProjects())
    } catch {
      setLibraryProjects([])
      setStatus('读取项目库失败。')
    }
  }

  async function handleSwitchProject(id: string) {
    try {
      await saveProjectToLibrary(project).catch(() => undefined)
      const target = await loadLibraryProject(id)
      if (!target) {
        setStatus('这个项目读取失败，可能已损坏。')
        return
      }
      revokeFrameObjectUrls(project.frames)
      const restored = await restoreProjectFrameImages(target)
      setProject(restored.project)
      setSelection({ kind: 'none' })
      resetSelection()
      setMarkdownPreview(null)
      setAiImportText('')
      setIsAiImportOpen(false)
      clearVideoFileReference()
      setLibraryProjects(null)
      setStatus(`已切换到「${target.projectTitle || target.filmTitle || '未命名项目'}」${restored.restoredCount ? `，找回 ${restored.restoredCount} 帧截图` : ''}。需要重新抽帧时再重新选择影片文件即可。`)
      void tryRestoreVideoHandle(restored.project)
    } catch (error) {
      setStatus(`切换项目失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function handleDeleteLibraryProject(id: string) {
    const item = libraryProjects?.find((entry) => entry.id === id)
    if (!window.confirm(`删除项目「${item?.title ?? '未命名'}」？笔记和帧图缓存会一起删除，无法恢复。`)) return
    try {
      await deleteLibraryProject(id)
      void deleteVideoHandle(id)
      if (id === project.id) {
        revokeFrameObjectUrls(project.frames)
        clearAutosave()
        setProject(createEmptyProject())
        setSelection({ kind: 'none' })
        resetSelection()
        setLastSavedAt(null)
      }
      setLibraryProjects(await listLibraryProjects())
      setStatus('项目已删除。')
    } catch (error) {
      setStatus(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function handleDeleteProject() {
    if (!window.confirm('删除当前项目后将清空项目内容、字幕和帧图数据，是否继续？想换电影不用删除，直接点「更换电影」即可。')) return
    const deletingProjectId = project.id
    clearProjectFrameImages(deletingProjectId).catch(() => {
      updateStatus('清理项目缓存图片失败。')
    })
    void deleteLibraryProject(deletingProjectId).catch(() => undefined)
    clearAutosave()
    revokeFrameObjectUrls(project.frames)
    const next = createEmptyProject()
    setProject(next)
    setSelection({ kind: 'none' })
    resetSelection()
    setMarkdownPreview(null)
    setAiImportText('')
    setIsAiImportOpen(false)
    setLastSavedAt(null)
    updateStatus('项目已删除。')
    clearVideoFileReference()
    if (extractAbort) {
      extractAbort.abort()
      setExtractAbort(null)
    }
    taskAbortRef.current?.abort()
    taskAbortRef.current = null
    if (analysisAbort) {
      analysisAbort.abort()
      setAnalysisAbort(null)
    }
  }

  async function handleGenerateAiPackage() {
    if (!project.sourceVideoName) {
      setStatus('请先导入电影。')
      return
    }
    if (extractAbort || analysisAbort) {
      setStatus('当前有正在进行的任务。')
      return
    }

    try {
      let sourceProject = project
      if (!sourceProject.frames.length || sourceProject.frameInterval !== 1) {
        setStatus('正在按 1 秒间隔抽帧，准备 AI 分析包...')
        const rebuilt = await startExtractFrames(true, { ...sourceProject, frameInterval: 1 }, 1)
        if (!rebuilt) return
        sourceProject = rebuilt
      }
      const saved = await exportAiAnalysisPackage(sourceProject)
      await announceAiPackageResult(saved, sourceProject.subtitles.length === 0)
    } catch (error) {
      setStatus(`生成 AI 分析包失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function handleOpenProject(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const next = normalizeLoadedProject(JSON.parse(await file.text()))
      revokeFrameObjectUrls(project.frames)
      setProject(next)
      setSelection({ kind: 'none' })
      resetSelection()
      setIsAiImportOpen(false)
      clearVideoFileReference()
      const restored = await restoreProjectFrameImages(next)
      setProject(restored.project)
      if (restored.project.frames.some((frame) => frame.src)) {
        await saveProjectFrameImages(restored.project)
      }
      setLastSavedAt(new Date().toISOString())
      setStatus(
        restored.restoredCount > 0
          ? `已打开项目文件：${file.name}，并恢复 ${restored.restoredCount} 张截图。`
          : `已打开项目文件：${file.name}`,
      )
    } catch (error) {
      setStatus(`打开项目失败：${error instanceof Error ? error.message : String(error)}`)
    }
    e.target.value = ''
  }

  async function handleOpenProjectPackage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.name.toLowerCase().endsWith('.json')) {
      await handleOpenProject(e)
      return
    }
    try {
      const imported = await importProjectPackage(file)
      setSelection({ kind: 'none' })
      resetSelection()
      setIsAiImportOpen(false)
      clearVideoFileReference()
      const restored = await restoreProjectFrameImages(imported.project)
      const next = restored.project
      revokeFrameObjectUrls(project.frames)
      setProject(next)
      if (next.frames.some((frame) => frame.src)) {
        await saveProjectFrameImages(next)
      }
      setLastSavedAt(new Date().toISOString())
      setStatus(`已打开项目：已恢复 ${Math.max(imported.restoredCount, restored.restoredCount)} 张截图，可继续编辑时间轴和分析。`)
    } catch (error) {
      setStatus(`打开项目失败：${error instanceof Error ? error.message : String(error)}`)
    }
    e.target.value = ''
  }

  async function handleSaveProjectPackage() {
    try {
      const saved = await exportProjectPackage(project)
      const imageCount = project.frames.filter((frame) => frame.src).length
      const contentText = imageCount
        ? `包含 project.json、analysis.md 和 ${imageCount} 张截图`
        : '包含 project.json 和 analysis.md，当前没有截图'
      setStatus(saved === 'saved' ? `项目已保存为 ZIP，${contentText}。` : `项目 ZIP 已生成，${contentText}，请在浏览器完成下载。`)
    } catch (error) {
      setStatus(`保存项目失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function startExtractFrames(
    forceRebuild = false,
    sourceProject = project,
    frameInterval = sourceProject.frameInterval,
    existingController?: AbortController,
  ): Promise<Project | undefined> {
    const videoFile = videoFileRef.current
    if (!videoFile) {
      setStatus('项目已恢复，但浏览器无法自动重新读取原电影文件。请先重新选择电影文件后再抽帧。')
      return
    }

    if (!existingController && (extractAbort || analysisAbort)) {
      setStatus('当前有正在进行的任务。')
      return
    }

    if (!forceRebuild && sourceProject.frames.length && !window.confirm('已有抽帧素材，重新准备 AI 素材会更新截图序列。是否继续？')) {
      return
    }

    const controller = existingController ?? new AbortController()
    taskAbortRef.current = controller
    setExtractAbort(controller)
    setExtractError('')
    setExtractPhase('metadata')
    setExtractProgress({ current: 0, total: 0, time: 0 })
    updateStatus('开始抽帧...')

    try {
      const result = await extractVideoFrames(
        videoFile,
        frameInterval,
        (progress) => {
          if (controller.signal.aborted || taskAbortRef.current !== controller) return
          setExtractPhase('frames')
          setExtractProgress(progress)
          updateStatus(`抽帧中：${progress.current}/${progress.total}`)
        },
        controller.signal,
      )
      if (controller.signal.aborted || taskAbortRef.current !== controller) {
        throw new DOMException('已取消生成时间轴', 'AbortError')
      }

      let next: Project = {
        ...sourceProject,
        frameInterval,
        frames: result.frames,
        duration: result.duration,
        segments: [],
        subtitles: sourceProject.subtitles,
        updatedAt: new Date().toISOString(),
      }
      revokeFrameObjectUrls(sourceProject.frames)
      setProject((current) => {
        // 自动搜索的字幕可能在抽帧期间已写入 state,合并进来避免覆盖
        if (current.id === next.id && current.subtitles.length && !next.subtitles.length) {
          next = { ...next, subtitles: current.subtitles, subtitlePath: current.subtitlePath }
        }
        return next
      })
      resetSelection()
      setStatus(`抽帧完成，已生成 ${result.frames.length} 个时间点。`)
      clearFrameRange()

      if (controller.signal.aborted || taskAbortRef.current !== controller) {
        throw new DOMException('已取消生成时间轴', 'AbortError')
      }
      setExtractPhase('cache')
      await saveProjectFrameImages(next)
        .then((count) => {
          setStatus((prev) => `${prev} 已保存 ${count} 张图片。`)
        })
        .catch(() => {
          setStatus('抽帧已完成，但图片缓存保存失败。')
        })
      return next
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setExtractPhase('canceled')
        updateStatus('任务已取消。')
      } else {
        const message = error instanceof Error ? error.message : String(error)
        setExtractPhase('error')
        setExtractError(message)
        setStatus(`抽帧失败：${message}`)
      }
    } finally {
      if (taskAbortRef.current === controller) {
        taskAbortRef.current = null
        setExtractAbort(null)
        setExtractProgress(null)
        if (!controller.signal.aborted) {
          setExtractPhase((phase) => (phase === 'error' ? 'error' : 'done'))
        }
      }
    }
    return undefined
  }

  function cancelExtractFrames() {
    const controller = taskAbortRef.current ?? extractAbort
    if (!controller && !analysisAbort) {
      setStatus('当前没有进行中的任务。')
      return
    }
    controller?.abort()
    analysisAbort?.abort()
    taskAbortRef.current = null
    setExtractAbort(null)
    setExtractProgress(null)
    setExtractPhase('canceled')
    setExtractError('')
    setStatus('任务已取消。')
  }

  function handleVideoSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    void processVideoFile(file)
  }

  // 「导入电影」入口:支持 File System Access API 时用系统选择器拿文件句柄,
  // 存下句柄后刷新/切项目就能一键接回影片;不支持的浏览器降级走 input
  async function openVideoPicker() {
    if (supportsFilePicker()) {
      let handle: FileSystemFileHandle | undefined
      try {
        const handles = await window.showOpenFilePicker!({ types: VIDEO_PICKER_TYPES })
        handle = handles[0]
      } catch {
        return // 用户取消选择
      }
      if (!handle) return
      let file: File
      try {
        file = await handle.getFile()
      } catch {
        setStatus('读取所选文件失败，请重试。')
        return
      }
      pendingVideoHandleRef.current = handle
      await processVideoFile(file)
      return
    }
    videoInputRef.current?.click()
  }

  // 恢复的项目续跑抽帧:影片文件不在手时先走关联流程(句柄一键接回或重新选),再抽帧
  async function handleResumeExtract() {
    if (isTaskRunning) {
      setStatus('当前有任务在进行,等它完成或取消后再继续。')
      return
    }
    if (!videoFileRef.current) {
      await handleRelinkClick()
      if (!videoFileRef.current) return
    }
    void startExtractFrames(true)
  }

  // 拖放导入影片:校验类型后走和文件选择完全相同的导入管线
  function handleDropVideo(file: File, handle?: FileSystemFileHandle) {
    const looksLikeVideo =
      file.type.startsWith('video/') ||
      /\.(mp4|m4v|mov|mkv|avi|webm|rmvb|rm|wmv|flv|ts|mpg|mpeg)$/i.test(file.name)
    if (!looksLikeVideo) {
      setStatus(`拖入的「${file.name}」不像影片文件,请拖入 MP4 / MKV / AVI 等视频。`)
      return
    }
    if (isTaskRunning) {
      setStatus('当前有导入任务在进行,等它完成或取消后再拖入新影片。')
      return
    }
    if (handle) pendingVideoHandleRef.current = handle
    void processVideoFile(file)
  }

  async function processVideoFile(file: File) {
    const willReplaceCurrentProject = Boolean(project.sourceVideoName || project.frames.length || project.subtitles.length || project.segments.length || project.macroAnalysis)
    if (
      willReplaceCurrentProject &&
      !window.confirm('导入新电影会开始一个新项目。当前项目已自动保存在「我的项目」里，随时可以切回。确定换电影？')
    ) {
      pendingVideoHandleRef.current = null
      return
    }

    const title = stripExtension(file.name)
    let nextProject: Project = {
      ...createEmptyProject(title, title),
      filmTitle: title,
      projectTitle: title,
      sourceVideoName: file.name,
      sourceVideoPath: file.name,
      frameInterval: 1,
      updatedAt: new Date().toISOString(),
    }
    void saveProjectToLibrary(project).catch(() => undefined)
    revokeFrameObjectUrls(project.frames)
    setProject(nextProject)
    setStatus(`已选择电影：${file.name}`)
    videoFileRef.current = file
    attachPlayableVideo(file)
    const pendingHandle = pendingVideoHandleRef.current
    pendingVideoHandleRef.current = null
    if (pendingHandle) void saveVideoHandle(nextProject.id, pendingHandle).catch(() => undefined)
    const controller = new AbortController()
    taskAbortRef.current = controller
    setExtractAbort(controller)
    setExtractError('')
    setExtractPhase('subtitle')
    setExtractProgress({ current: 0, total: 0, time: 0 })
    clearFrameRange()
    setSelection({ kind: 'none' })
    setMarkdownPreview(null)
    setAiImportText('')
    setIsAiImportOpen(false)

    // 浏览器读不了的格式(RMVB/AVI/HEVC 等)先交给 dev server 本地 ffmpeg 转码
    let videoSource: File | string = file
    const playable = await probeVideoPlayable(file)
    if (controller.signal.aborted || taskAbortRef.current !== controller) return
    if (!playable) {
      setExtractPhase('transcode')
      setExtractProgress({ current: 0, total: 100, time: 0 })
      setStatus('浏览器不支持这个视频格式，正在用本机 ffmpeg 自动转码...')
      try {
        const transcoded = await transcodeVideo(file, (percent) => {
          if (controller.signal.aborted || taskAbortRef.current !== controller) return
          setExtractProgress({ current: percent, total: 100, time: 0 })
          updateStatus(`本地转码中：${percent}%`)
        }, controller.signal)
        if (controller.signal.aborted || taskAbortRef.current !== controller) return
        if (!transcoded) {
          throw new Error('本地转码接口不可用。请确认工具是用 npm run dev 启动的，且本机装有 ffmpeg。')
        }
        videoSource = transcoded.videoUrl
        videoFileRef.current = transcoded.videoUrl
        attachPlayableVideo(transcoded.videoUrl)
        if (transcoded.subtitleContent) {
          const embedded = cleanSubtitles(parseSubtitle(transcoded.subtitleContent))
          if (embedded.length) {
            nextProject = {
              ...nextProject,
              subtitles: embedded,
              subtitlePath: `${file.name} 内嵌字幕`,
              updatedAt: new Date().toISOString(),
            }
            setProject(nextProject)
          }
        }
        setStatus('本地转码完成，正在按 1 秒抽帧准备 AI 素材...')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setExtractPhase('error')
        setExtractError(message)
        setStatus(`自动转码失败：${message}`)
        taskAbortRef.current = null
        setExtractAbort(null)
        setExtractProgress(null)
        return
      }
    }

    if (typeof videoSource !== 'string' && !nextProject.subtitles.length) {
      try {
        const embeddedSubtitles = await extractEmbeddedSubtitles(videoSource, controller.signal)
        if (controller.signal.aborted || taskAbortRef.current !== controller) return
        if (embeddedSubtitles.length) {
          nextProject = {
            ...nextProject,
            subtitles: embeddedSubtitles,
            subtitlePath: `${file.name} 内嵌字幕`,
            updatedAt: new Date().toISOString(),
          }
          setProject(nextProject)
          setStatus(`已从电影读取字幕：${embeddedSubtitles.length} 条，正在按 1 秒抽帧准备 AI 素材...`)
        }
      } catch (error) {
        if (controller.signal.aborted || taskAbortRef.current !== controller) {
          setExtractPhase('canceled')
          return
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          setExtractPhase('canceled')
          return
        }
        setStatus('未能读取电影内嵌字幕，仍继续按 1 秒抽帧准备 AI 素材。')
      }
    }
    if (controller.signal.aborted || taskAbortRef.current !== controller) return
    const extracted = await startExtractFrames(true, nextProject, 1, controller)
    if (!extracted || controller.signal.aborted) return
    await autoPrepareAnalysisPackage(extracted, controller.signal)
  }

  // 抽帧完成后的自动链路:没字幕先搜网络字幕,有字幕直接出 AI 分析包
  async function autoPrepareAnalysisPackage(extracted: Project, signal: AbortSignal) {
    let working = extracted
    let subtitleMissNote = ''
    if (!working.subtitles.length) {
      try {
        setStatus('没有内嵌字幕，正在自动搜索网络字幕...')
        const { result, miss } = await fetchAutoSubtitle(
          working.filmTitle || working.sourceVideoName || '',
          working.duration,
          signal,
        )
        if (signal.aborted) return
        if (!result && miss) {
          subtitleMissNote = `搜到的字幕「${miss.rejectedFilename}」时间轴和影片对不上（字幕全长 ${secondsToTimecode(miss.rejectedLastTimestamp)}，影片 ${secondsToTimecode(working.duration)}），已拒绝采用，建议手动找对应版本导入。`
          setStatus(`${subtitleMissNote}正在按无字幕打包...`)
        }
        if (result) {
          working = {
            ...working,
            subtitles: result.subtitles,
            subtitlePath: `网络字幕：${result.filename}`,
            updatedAt: new Date().toISOString(),
          }
          const merged = working
          setProject((current) => (current.id === merged.id ? { ...current, subtitles: merged.subtitles, subtitlePath: merged.subtitlePath, updatedAt: merged.updatedAt } : current))
          setStatus(`已自动下载字幕：${result.filename}，${result.subtitles.length} 条（来源：${result.source}）。正在生成 AI 分析包...`)
        }
      } catch {
        if (signal.aborted) return
      }
    }
    try {
      const saved = await exportAiAnalysisPackage(working)
      await announceAiPackageResult(saved, working.subtitles.length === 0, subtitleMissNote)
    } catch (error) {
      setStatus(`自动生成 AI 分析包失败：${error instanceof Error ? error.message : String(error)}。可手动点“生成 AI 分析包”重试。`)
    }
  }

  async function announceAiPackageResult(saved: 'saved' | 'downloaded', withoutSubtitles = false, extraNote = '') {
    const copied = await navigator.clipboard.writeText(buildAiChatMessage()).then(() => true, () => false)
    const copyHint = copied
      ? '发给 AI 的指令已复制到剪贴板：先粘贴指令，再上传 ZIP（AI 不会自动读包里的任务说明）。'
      : '上传 ZIP 时请附一句：“解压后严格按包内 prompt.md 分析，只返回 schema.json 结构的 JSON。”'
    const subtitleNote = withoutSubtitles ? `${extraNote}本片没有字幕，包里只有画面截图，AI 会纯靠画面分析（精度略降，之后导入字幕可重新生成）。` : ''
    setStatus(`${saved === 'saved' ? 'AI 分析包已保存。' : 'AI 分析包已生成，请在浏览器完成下载。'}${subtitleNote}${copyHint}完成后把 AI 返回的 JSON 导入回来。`)
  }

  async function handleSubtitleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (project.subtitles.length && !window.confirm('导入新字幕会替换当前字幕内容。是否继续？')) {
      e.target.value = ''
      return
    }
    try {
      const text = await readSubtitleFile(file)
      const subtitles = parseSubtitle(text)
      if (!subtitles.length) {
        throw new Error('没有识别到有效字幕，请确认文件是 SRT、ASS、SSA 或 VTT 格式。')
      }
      const projectWithSubtitles = {
        ...project,
        subtitles,
        subtitlePath: file.name,
        updatedAt: new Date().toISOString(),
      }
      setProject(projectWithSubtitles)
      setStatus(`已导入字幕：${subtitles.length} 条。点击“生成 AI 分析包”后会把字幕和截图一起打包。`)
    } catch (error) {
      setStatus(`导入字幕失败：${error instanceof Error ? error.message : String(error)}`)
    }
    e.target.value = ''
  }

  async function readSubtitleFile(file: File): Promise<string> {
    const buffer = await file.arrayBuffer()
    const utf8Text = new TextDecoder('utf-8').decode(buffer)
    if (!utf8Text.includes('�')) return utf8Text
    try {
      const gbText = new TextDecoder('gb18030').decode(buffer)
      return gbText.includes('�') && utf8Text.length >= gbText.length ? utf8Text : gbText
    } catch {
      return utf8Text
    }
  }

  function handleCreateSegmentFromRange(startFrameId: string | null = frameRangeStartId, endFrameId: string | null = frameRangeEndId) {
    if (!startFrameId || !endFrameId) {
      setStatus('请先点击一个时间点，在右侧设为段落起点，再选择终点创建段落。')
      return
    }

    const startIndex = project.frames.findIndex((frame) => frame.id === startFrameId)
    const endIndex = project.frames.findIndex((frame) => frame.id === endFrameId)
    if (startIndex < 0 || endIndex < 0) {
      setStatus('时间点数据异常，请重新选择时间点。')
      return
    }
    if (startIndex === endIndex) {
      setStatus('请再选择一个不同的时间点作为段落终点。')
      return
    }

    const start = Math.min(startIndex, endIndex)
    const end = Math.max(startIndex, endIndex)
    const startFrame = project.frames[start]
    const endFrame = project.frames[end]
    const segment = createSegmentFromRange(startFrame, endFrame, project.duration)
    setProject((current) => ({
      ...current,
      segments: [...current.segments, segment],
      updatedAt: new Date().toISOString(),
    }))
    setSelection({ kind: 'segment', segmentId: segment.id })
    clearFrameRange()
    setStatus(`已创建段落：${secondsToTimecode(segment.startTime)} - ${secondsToTimecode(segment.endTime)}，时长 ${secondsToTimecode(segment.endTime - segment.startTime)}。`)
  }

  function handleFrameClick(clicked: Frame, shiftKey: boolean) {
    if (shiftKey) {
      if (!frameRangeStartId) {
        setFrameRange(clicked.id, clicked.id)
        setSelection({ kind: 'segmentFrame', segmentId: '', frameId: clicked.id })
        setStatus(`已记录起点：${secondsToTimecode(clicked.time)}，再选一个点作为终点。`)
        return
      }

      setFrameRangeEndId(clicked.id)
      handleCreateSegmentFromRange(frameRangeStartId, clicked.id)
      return
    }

    if (frameRangeStartId) {
      setFrameRangeEndId(clicked.id)
      setSelection({ kind: 'frame', frameId: clicked.id })
      return
    }

    if (selection.kind === 'segment' && selectedSegment) {
      setSelection({ kind: 'segmentFrame', segmentId: selectedSegment.id, frameId: clicked.id })
      return
    }

    setSelection({ kind: 'frame', frameId: clicked.id })
  }

  function handleGapSelect(startTime: number, endTime: number) {
    if (!project.frames.length) return
    const startIndex = findNearestFrameIndex(startTime, 'start')
    const endIndex = findNearestFrameIndex(endTime, 'end')
    if (startIndex < 0 || endIndex < 0) return
    const start = Math.min(startIndex, endIndex)
    const end = Math.max(startIndex, endIndex)
    const startFrame = project.frames[start]
    const endFrame = project.frames[end]
    setFrameRange(startFrame.id, endFrame.id)
    setSelection({ kind: 'frame', frameId: startFrame.id })
    setStatus(`已选择待补区间：${secondsToTimecode(startFrame.time)} - ${secondsToTimecode(endFrame.time)}，可直接创建段落。`)
  }

  function findNearestFrameIndex(time: number, boundary: 'start' | 'end'): number {
    if (!project.frames.length) return -1
    const sorted = project.frames
      .map((frame, index) => ({ frame, index }))
      .sort((a, b) => a.frame.time - b.frame.time)
    const preferred =
      boundary === 'start'
        ? sorted.find((item) => item.frame.time >= time)
        : [...sorted].reverse().find((item) => item.frame.time <= time)
    if (preferred) return preferred.index
    return sorted.reduce((nearest, item) =>
      Math.abs(item.frame.time - time) < Math.abs(nearest.frame.time - time) ? item : nearest,
    ).index
  }

  function handleSegmentClick(segmentId: string) {
    setSelection({ kind: 'segment', segmentId })
  }

  function handleFrameChange(frameId: string, patch: Partial<Frame>) {
    setProject((current) => ({
      ...current,
      frames: current.frames.map((frame) => (frame.id === frameId ? { ...frame, ...patch } : frame)),
      updatedAt: new Date().toISOString(),
    }))
  }

  function handleSegmentChange(segmentId: string, patch: Partial<Segment>) {
    setProject((current) => ({
      ...current,
      segments: current.segments.map((segment) =>
        segment.id === segmentId ? { ...segment, ...patch, updatedAt: new Date().toISOString() } : segment,
      ),
      updatedAt: new Date().toISOString(),
    }))
  }

  function handleSegmentNavigate(direction: 'prev' | 'next') {
    if (!selectedSegment) return
    const index = sortedSegments.findIndex((segment) => segment.id === selectedSegment.id)
    const target = sortedSegments[direction === 'prev' ? index - 1 : index + 1]
    if (target) setSelection({ kind: 'segment', segmentId: target.id })
  }

  function handleUseFrameAsSegmentBoundary(segmentId: string, frame: Frame, boundary: 'start' | 'end') {
    const segment = project.segments.find((item) => item.id === segmentId)
    if (!segment) return
    const patch: Partial<Segment> = {}
    if (boundary === 'start') {
      patch.startFrameId = frame.id
      patch.startTime = frame.time
      if (frame.time > segment.endTime) {
        patch.endFrameId = frame.id
        patch.endTime = frame.time
      }
    } else {
      patch.endFrameId = frame.id
      patch.endTime = frame.time
      if (frame.time < segment.startTime) {
        patch.startFrameId = frame.id
        patch.startTime = frame.time
      }
    }
    handleSegmentChange(segmentId, patch)
    setStatus(`已把 ${secondsToTimecode(frame.time)} 设为段落${boundary === 'start' ? '起点' : '终点'}。`)
  }

  function handleSegmentDelete(segmentId: string) {
    if (!window.confirm('删除当前段落？段落里的分析文本会一起删除。')) return
    setProject((current) => ({
      ...current,
      segments: current.segments.filter((segment) => segment.id !== segmentId),
      updatedAt: new Date().toISOString(),
    }))
    setSelection({ kind: 'none' })
    setStatus('段落已删除。')
  }

  const [isShareExportOpen, setIsShareExportOpen] = useState(false)
  const [isGuideOpen, setIsGuideOpen] = useState(false)

  function handleExportShareImage() {
    if (!project.segments.length) {
      setStatus('请先导入 AI 结果生成时间轴,再导出分享图。')
      return
    }
    setIsShareExportOpen(true)
  }

  function toggleShareCredit(next: boolean) {
    setShareCreditOn(next)
    localStorage.setItem('lapian.share-credit', next ? 'on' : 'off')
  }

  // 首次导出成功时在状态栏带一句求 star,只出现一次
  function withStarHint(message: string): string {
    if (localStorage.getItem('lapian.star-hint-shown')) return message
    localStorage.setItem('lapian.star-hint-shown', '1')
    return `${message}觉得工具有用的话,欢迎到 GitHub 给个 star:github.com/bkingfilm/lapian-notes`
  }

  async function runShareExport(mode: 'structure' | 'full') {
    setIsShareExportOpen(false)
    const target = document.querySelector<HTMLElement>(mode === 'structure' ? '.swimlane-module' : '.story-map')
    if (!target) {
      setStatus('没有找到可导出的时间轴区域。')
      return
    }
    let creditEl: HTMLDivElement | null = null
    try {
      setStatus('正在生成分享图,内容多时需要几秒...')
      // 展开横向滚动区,防止长片泳道被裁切
      target.classList.add('share-exporting')
      if (shareCreditOn) {
        creditEl = document.createElement('div')
        creditEl.className = 'share-credit'
        creditEl.textContent = '由「拉片笔记」生成 · 开源免费 · github.com/bkingfilm/lapian-notes'
        target.appendChild(creditEl)
      }
      const dataUrl = await Promise.race([
        toPng(target, {
          backgroundColor: '#ffffff',
          pixelRatio: 2,
          width: target.scrollWidth,
          height: target.scrollHeight,
        }),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error('生成超时(60秒)。内容可能过大,试试「结构图」模式,或减少段落后重试')), 60000),
        ),
      ])
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `${project.projectTitle || DEFAULT_PROJECT_TITLE}-${mode === 'structure' ? '结构图' : '完整拉片长图'}.png`
      link.click()
      setStatus(withStarHint(mode === 'structure' ? '结构图已生成(泳道+情绪曲线),适合直接发社交平台。' : '完整拉片长图已生成,适合存档或给人细读。'))
    } catch (error) {
      setStatus(`生成分享图失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      creditEl?.remove()
      target.classList.remove('share-exporting')
    }
  }

  function handleExportMarkdown() {
    const hasExportableContent = hasMeaningfulProjectContent(project)
    if (!hasExportableContent) {
      setStatus('请先导入电影，或至少填写项目名/拆解目标后再导出。')
      return
    }
    setMarkdownPreview(exportMarkdown(project))
    setStatus('文字剧本拆解 Markdown 预览已打开。')
  }

  function handleExportMarkdownToFile() {
    if (!markdownPreview) return
    downloadText(`${project.projectTitle || DEFAULT_PROJECT_TITLE}.md`, markdownPreview, 'text/markdown')
    setMarkdownPreview(null)
    setStatus(withStarHint('Markdown 已导出。'))
  }

  function handleExportScreenplayText() {
    if (!project.segments.length) {
      setStatus('请先生成或创建剧情段落后再导出剧本正文。')
      return
    }
    downloadText(`${project.projectTitle || DEFAULT_PROJECT_TITLE}-剧本正文.md`, exportScreenplayText(project), 'text/markdown')
    setStatus('剧本正文已导出。')
  }

  function handleCopyMarkdown() {
    if (!markdownPreview) return
    navigator.clipboard.writeText(markdownPreview).then(
      () => setStatus('Markdown 已复制。'),
      () => setStatus('复制失败，请手动复制。'),
    )
  }

  function handleAiImportApply(mode: AiWriteMode, skipMovieCheck = false) {
    if (!aiImportText.trim()) {
      setStatus('请先选择或粘贴 AI 返回的 JSON。')
      return
    }

    try {
      const imported = importAiAnalysis(project, aiImportText, { skipMovieCheck })
      if (imported.segmentDeepDive) {
        applySegmentDeepDive(imported.segmentDeepDive)
        return
      }
      const patch: Partial<Project> = {}
      if (imported.macroAnalysis) {
        patch.macroAnalysis = imported.macroAnalysis
      }
      if (imported.segments.length > 0) {
        patch.segments = mergeImportedSegments(project.segments, imported.segments, mode)
      }
      if (imported.audienceCurvePoints?.length) {
        patch.audienceCurvePoints = imported.audienceCurvePoints
      }
      if (imported.storyLines?.length) {
        patch.storyLines = imported.storyLines
      }
      if (!patch.macroAnalysis && !patch.segments && !patch.audienceCurvePoints) {
        setStatus('AI 内容里没有可应用的全片分析或分段。')
        return
      }
      updateProject(patch)
      if (imported.segments.length > 0) {
        setSelection({ kind: 'segment', segmentId: imported.segments[0].id })
      }
      setAiImportText('')
      setIsAiImportOpen(false)
      setStatus(aiImportApplyStatus(mode, Boolean(imported.macroAnalysis), imported.segments.length))
    } catch (error) {
      // 片名对不上时给放行选项:跨电脑分享的 JSON 常和对方的视频文件名不一致
      if (error instanceof Error && error.name === 'MovieMismatchError') {
        const proceed = window.confirm(
          `${error.message}\n\n如果确定是同一部电影（比如朋友分享的分析文件、只是视频文件名不同），点「确定」继续导入；不确定就点「取消」检查一下。`,
        )
        if (proceed) handleAiImportApply(mode, true)
        return
      }
      setStatus(`解析 AI 内容失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function applySegmentDeepDive(deepDive: NonNullable<ReturnType<typeof importAiAnalysis>['segmentDeepDive']>) {
    const byId = deepDive.segmentId ? project.segments.find((segment) => segment.id === deepDive.segmentId) : undefined
    const byOverlap =
      deepDive.startTime !== undefined && deepDive.endTime !== undefined
        ? [...project.segments]
            .map((segment) => ({
              segment,
              score: segmentOverlapScore(segment, { startTime: deepDive.startTime!, endTime: deepDive.endTime! } as Segment),
            }))
            .filter(({ score }) => score >= 0.5)
            .sort((a, b) => b.score - a.score)[0]?.segment
        : undefined
    const target = byId ?? byOverlap
    if (!target) {
      setStatus('没有找到深拆结果对应的段落。请确认导入的是当前项目、当前段落的深拆 JSON。')
      return
    }
    const patch = updateSegmentWithAi(target, deepDive.patch, 'replace')
    if (deepDive.patch.title) patch.title = deepDive.patch.title
    handleSegmentChange(target.id, patch)
    setSelection({ kind: 'segment', segmentId: target.id })
    setAiImportText('')
    setIsAiImportOpen(false)
    const blockCount = deepDive.patch.screenplayBlocks?.length ?? 0
    setStatus(`已应用段落深拆：${secondsToTimecode(target.startTime)} - ${secondsToTimecode(target.endTime)}，剧本小节 ${blockCount} 条。`)
  }

  async function handleExportSegmentDeepDive() {
    if (!selectedSegment) return
    try {
      const saved = await exportSegmentDeepDivePackage(project, selectedSegment)
      const copied = await navigator.clipboard.writeText(buildAiChatMessage()).then(() => true, () => false)
      const copyHint = copied ? '上传指令已复制到剪贴板，先粘贴指令再传 ZIP。' : '上传时请附一句：“解压后严格按包内 prompt.md 深拆这个段落，只返回 schema.json 结构的 JSON。”'
      setStatus(`${saved === 'saved' ? '本段小包已保存，把它发给 AI。' : '本段小包已生成，请在浏览器完成下载，然后发给 AI。'}${copyHint}AI 返回 JSON 后点“导入 AI 结果”导回，会自动填进这一段。`)
    } catch (error) {
      setStatus(`导出段落深拆包失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function handleAiResultFileImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      if (!text.trim()) throw new Error('文件内容为空。')
      setAiImportText(text)
      setIsAiImportOpen(true)
      setStatus(`已读取 AI 结果文件：${file.name}。请确认预览后应用。`)
    } catch (error) {
      setStatus(`读取 AI 结果文件失败：${error instanceof Error ? error.message : String(error)}`)
    }
    e.target.value = ''
  }

  function aiImportApplyStatus(mode: AiWriteMode, hasMacro: boolean, segmentCount: number): string {
    const parts = []
    if (hasMacro) parts.push('全片分析')
    if (segmentCount) parts.push(`${segmentCount} 个分段`)
    if (!segmentCount) return `已应用：${parts.join('、')}。`
    if (mode === 'fill-empty') return `补空字段已应用：${parts.join('、')}。`
    return `${mode === 'append' ? '追加' : '替换'}已应用：${parts.join('、')}。`
  }

  function mergeImportedSegments(currentSegments: Segment[], importedSegments: Segment[], mode: AiWriteMode): Segment[] {
    if (mode === 'replace') return sortSegments(importedSegments)
    if (mode === 'append') return sortSegments([...currentSegments, ...importedSegments])

    const usedImportedIds = new Set<string>()
    const merged = currentSegments.map((segment) => {
      const imported = findBestImportedSegment(segment, importedSegments, usedImportedIds)
      if (!imported) return segment
      usedImportedIds.add(imported.id)
      return {
        ...segment,
        ...updateSegmentWithAi(segment, imported, 'fill-empty'),
        updatedAt: new Date().toISOString(),
      }
    })
    const unmatched = importedSegments.filter((segment) => !usedImportedIds.has(segment.id))
    return sortSegments([...merged, ...unmatched])
  }

  function sortSegments(segments: Segment[]): Segment[] {
    return [...segments].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)
  }

  function findBestImportedSegment(segment: Segment, importedSegments: Segment[], usedImportedIds: Set<string>): Segment | undefined {
    return importedSegments
      .filter((item) => !usedImportedIds.has(item.id))
      .map((item) => ({ item, score: segmentOverlapScore(segment, item) }))
      .filter(({ score }) => score >= 0.35)
      .sort((a, b) => b.score - a.score)[0]?.item
  }

  function segmentOverlapScore(left: Segment, right: Segment): number {
    const overlap = Math.max(0, Math.min(left.endTime, right.endTime) - Math.max(left.startTime, right.startTime))
    const duration = Math.max(left.endTime - left.startTime, right.endTime - right.startTime, 1)
    return overlap / duration
  }

  function downloadText(filename: string, content: string, type: string) {
    const blob = new Blob([content], { type })
    downloadBlob(filename, blob)
  }

  function downloadBlob(filename: string, blob: Blob) {
    const acceptType = blob.type && blob.type.length > 0 ? blob.type : 'application/octet-stream'
    const picker = (window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string
        types: Array<{ description: string; accept: Record<string, string[]> }>
      }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>
    }).showSaveFilePicker

    const extension = filename.match(/\.[a-z0-9]+$/i)?.[0]
    if (picker && extension) {
      picker({
        suggestedName: filename,
        types: [{ description: 'Export file', accept: { [acceptType]: [extension] } }],
      })
        .then(async (handle) => {
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
        })
        .catch(() => {
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = filename
          link.click()
          URL.revokeObjectURL(url)
        })
      return
    }

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <input
        ref={pkgInputRef}
        className="hidden-input"
        type="file"
        accept="application/zip,application/json,.zip,.json"
        onChange={handleOpenProjectPackage}
      />
      <input
        ref={videoInputRef}
        className="hidden-input"
        type="file"
        accept="video/*,.mp4,.mov,.mkv,.avi,.webm"
        onChange={handleVideoSelect}
      />
      <input
        ref={subtitleInputRef}
        className="hidden-input"
        type="file"
        accept=".srt,.ass,.ssa,.vtt,text/plain,text/vtt"
        onChange={handleSubtitleImport}
      />
      <input
        ref={relinkInputRef}
        className="hidden-input"
        type="file"
        accept="video/*,.mp4,.mov,.mkv,.avi,.webm,.rmvb,.rm,.wmv,.flv,.ts"
        onChange={handleRelinkVideo}
      />
      <input
        ref={aiResultInputRef}
        className="hidden-input"
        type="file"
        accept=".json,.txt,.md,application/json,text/plain,text/markdown"
        onChange={handleAiResultFileImport}
      />

      <Toolbar
        project={project}
        isTaskRunning={isTaskRunning}
        onOpenLibrary={handleOpenLibrary}
        onSaveProjectPackage={handleSaveProjectPackage}
        onVideoPath={() => void openVideoPicker()}
        onSubtitle={() => subtitleInputRef.current?.click()}
        onGenerateAiPackage={handleGenerateAiPackage}
        onImportAiResult={() => aiResultInputRef.current?.click()}
        onExportMarkdown={handleExportMarkdown}
        onExportScreenplay={handleExportScreenplayText}
        onExportShareImage={handleExportShareImage}
        onOpenGuide={() => setIsGuideOpen(true)}
      />

      <section className="workspace">
        <section className="main-pane">
          {showWelcomeBack ? (
            <div className="welcome-back-banner">
              <span>
                已恢复你上次的项目「{project.projectTitle || project.filmTitle || '未命名项目'}」
                {project.segments.length ? `（${project.segments.length} 个段落）` : ''}，可以直接继续。
              </span>
              <div className="welcome-back-actions">
                <button type="button" onClick={() => setShowWelcomeBack(false)}>继续这个项目</button>
                <button
                  type="button"
                  onClick={() => {
                    setShowWelcomeBack(false)
                    videoInputRef.current?.click()
                  }}
                >
                  拆一部新电影
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowWelcomeBack(false)
                    void handleOpenLibrary()
                  }}
                >
                  看我的项目
                </button>
              </div>
            </div>
          ) : null}
          <WorkflowGuide
            project={project}
            isTaskRunning={isTaskRunning}
            onImportVideo={() => videoInputRef.current?.click()}
            onRegenerateAiPackage={handleGenerateAiPackage}
            onImportAiResult={() => aiResultInputRef.current?.click()}
            onExportMarkdown={handleExportMarkdown}
          />
          <FrameTimeline
            hasVideo={hasVideo}
            duration={project.duration}
            frames={project.frames}
            storyLines={getProjectStoryLines(project)}
            macroAnalysis={project.macroAnalysis}
            audienceCurvePoints={project.audienceCurvePoints ?? []}
            extractProgress={extractProgress}
            extractError={extractError}
            extractPhase={extractPhase}
            analysisInProgress={analysisInProgress}
            onCancelExtract={cancelExtractFrames}
            segments={project.segments}
            subtitles={project.subtitles}
            selectedFrameId={selectedFrame?.id}
            selectedSegmentId={selectedSegment?.id}
            selectedRange={frameRange}
            onCreateSegmentFromRange={handleCreateSegmentFromRange}
            onClearRange={clearFrameRange}
            onGapSelect={handleGapSelect}
            onFrameClick={handleFrameClick}
            onSegmentClick={handleSegmentClick}
            onSeekTo={handleSeekTo}
            onDropVideo={handleDropVideo}
            onResumeExtract={() => void handleResumeExtract()}
          />
        </section>

        <InspectorPanel
          project={project}
          selectedFrame={selectedFrame}
          selectedSegment={selectedSegment}
          selectedSegmentPosition={selectedSegmentPosition}
          boundaryFrame={boundaryFrame}
          frames={project.frames}
          hasFrameRangeStart={Boolean(frameRangeStartId)}
          onProjectChange={updateProject}
          onStartSegmentRange={(frameId) => {
            setFrameRange(frameId)
            const frame = project.frames.find((item) => item.id === frameId)
            if (frame) setStatus(`已记录起点：${secondsToTimecode(frame.time)}，再选一个点作为终点。`)
          }}
          onEndSegmentRange={(frameId) => {
            setFrameRangeEndId(frameId)
            handleCreateSegmentFromRange(frameRangeStartId, frameId)
          }}
          onClearSegmentRange={clearFrameRange}
          onFrameChange={handleFrameChange}
          onSegmentChange={handleSegmentChange}
          onSegmentNavigate={handleSegmentNavigate}
          onUseFrameAsSegmentBoundary={handleUseFrameAsSegmentBoundary}
          onSegmentDelete={handleSegmentDelete}
          onExportSegmentDeepDive={handleExportSegmentDeepDive}
          onProjectDelete={handleDeleteProject}
          videoPlayerUrl={videoPlayerUrl}
          playerRef={playerRef}
          onSeekTo={handleSeekTo}
          onPlayerTimeUpdate={handlePlayerTimeUpdate}
          onRelinkVideo={() => void handleRelinkClick()}
        />
      </section>

      <footer className="status-bar">
        <span className="status-bar-message">{status || '就绪'}</span>
        <span className="status-bar-saved">
          {lastSavedAt ? `已自动保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '尚未自动保存'}
        </span>
      </footer>

      {isGuideOpen ? <BeginnerGuide onClose={() => setIsGuideOpen(false)} /> : null}

      {isShareExportOpen ? (
        <section className="markdown-preview">
          <div className="markdown-preview-panel share-export-panel">
            <div className="markdown-preview-header">
              <strong>导出分享图</strong>
              <div>
                <button onClick={() => setIsShareExportOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="share-export-options">
              <button type="button" onClick={() => void runShareExport('structure')}>
                <strong>结构图(推荐)</strong>
                <span>泳道时间轴 + 情绪曲线,横幅一张,发 X/朋友圈一眼看懂全片结构</span>
              </button>
              <button type="button" onClick={() => void runShareExport('full')}>
                <strong>完整笔记长图</strong>
                <span>包含结构树全部段落的截图和文字,很长,适合存档或给人细读</span>
              </button>
            </div>
            <label className="share-credit-toggle">
              <input type="checkbox" checked={shareCreditOn} onChange={(e) => toggleShareCredit(e.target.checked)} />
              <span>图末带一行工具署名(让更多人找到这个免费工具)</span>
            </label>
          </div>
        </section>
      ) : null}

      {libraryProjects !== null ? (
        <ProjectLibrary
          projects={libraryProjects}
          currentProjectId={project.id}
          onOpen={handleSwitchProject}
          onDelete={handleDeleteLibraryProject}
          onImportZip={() => {
            setLibraryProjects(null)
            pkgInputRef.current?.click()
          }}
          onClose={() => setLibraryProjects(null)}
        />
      ) : null}

      {markdownPreview ? (
        <section className="markdown-preview">
          <div className="markdown-preview-panel">
            <div className="markdown-preview-header">
              <strong>Markdown 预览</strong>
              <div>
                <button onClick={handleCopyMarkdown}>复制</button>
                <button onClick={handleExportMarkdownToFile}>确认导出</button>
                <button onClick={() => setMarkdownPreview(null)}>关闭</button>
              </div>
            </div>
            <pre>{markdownPreview}</pre>
          </div>
        </section>
      ) : null}

      {isAiImportOpen ? (
        <section className="markdown-preview">
          <div className="markdown-preview-panel ai-import-panel">
            <div className="markdown-preview-header">
              <strong>导入 AI 分析结果</strong>
              <div>
                <button
                  disabled={
                    !aiImportPreview?.value ||
                    Boolean(aiImportPreview.value.needsTimeline) ||
                    (!aiImportPreview.value.segmentCount && !aiImportPreview.value.hasMacroAnalysis && !aiImportPreview.value.deepDive)
                  }
                  onClick={() => handleAiImportApply('replace')}
                >
                  应用结果
                </button>
                <button onClick={() => {
                  setIsAiImportOpen(false)
                  setAiImportText('')
                }}>取消</button>
              </div>
            </div>
            <p className="ai-import-note">选择 AI 返回的 JSON 文件后，点击“应用结果”生成剧情时间轴和结构树。粘贴框只是备用入口。</p>
            {aiImportPreview ? (
              <div className={`ai-import-preview ${aiImportPreview.error || aiImportPreview.value?.needsTimeline ? 'warn' : 'ready'}`}>
                {aiImportPreview.error ? (
                  <span>未识别：{aiImportPreview.error}</span>
                ) : aiImportPreview.value ? (
                  aiImportPreview.value.deepDive ? (
                    <span>
                      段落深拆结果：
                      {aiImportPreview.value.deepDive.startTime !== undefined && aiImportPreview.value.deepDive.endTime !== undefined
                        ? `${secondsToTimecode(aiImportPreview.value.deepDive.startTime)} - ${secondsToTimecode(aiImportPreview.value.deepDive.endTime)}｜`
                        : ''}
                      {aiImportPreview.value.deepDive.title || '未命名段落'}｜剧本小节 {aiImportPreview.value.deepDive.blockCount} 条
                    </span>
                  ) : (
                    <>
                      <span>{aiImportPreview.value.hasMacroAnalysis ? '包含全片分析' : '不含全片分析'}</span>
                      <span>{aiImportPreview.value.segmentCount ? `包含 ${aiImportPreview.value.segmentCount} 个分段` : '不含分段'}</span>
                      {aiImportPreview.value.needsTimeline ? <strong>需要先导入电影并完成抽帧，才能应用分段。</strong> : null}
                    </>
                  )
                ) : null}
              </div>
            ) : null}
            <textarea
              className="ai-import-textarea"
              autoFocus
              placeholder="也可以把 AI 返回的 JSON 或 Markdown 代码块粘贴到这里。"
              value={aiImportText}
              onChange={(event) => setAiImportText(event.target.value)}
            />
          </div>
        </section>
      ) : null}
    </main>
  )
}

