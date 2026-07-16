import type { Frame, MacroAnalysis, Project, Segment, SegmentType, ShotDetection } from '../types'
import type { AiWriteMode } from '../types'

export const segmentColors: Record<SegmentType, string> = {
  开场: '#2d6cdf',
  起: '#3a8f5a',
  承: '#d87a2c',
  转: '#7a5ab8',
  合: '#64748b',
  冲突: '#d9a321',
  推进: '#4f9d69',
  转折: '#e17128',
  升级: '#c85050',
  低谷: '#b45309',
  高潮: '#7c6d8f',
  结尾: '#a33434',
  支线: '#8062c9',
  过渡: '#218d95',
  背景: '#80858f',
  说明: '#82664b',
  结论: '#7a4dbf',
}

export function createEmptyProject(projectTitle = '', filmTitle = ''): Project {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    projectTitle,
    filmTitle,
    sourceVideoPath: '',
    learningGoal: '',
    frameInterval: 1,
    duration: 0,
    frames: [],
    subtitles: [],
    segments: [],
    createdAt: now,
    updatedAt: now,
    schemaVersion: '1.0.0',
  }
}

export function normalizeLoadedProject(value: unknown): Project {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('文件内容不是有效的项目数据。')
  }
  const raw = value as Partial<Project> & Record<string, unknown>
  const looksLikeProject = 'frames' in raw || 'segments' in raw || 'projectTitle' in raw || 'filmTitle' in raw
  if (!looksLikeProject) {
    throw new Error('这不像拉片笔记的项目文件：缺少 frames/segments/projectTitle 字段。')
  }
  const base = createEmptyProject()
  const frames = Array.isArray(raw.frames)
    ? raw.frames.filter((frame): frame is Frame =>
        Boolean(frame && typeof frame === 'object' && typeof frame.id === 'string' && typeof frame.time === 'number'))
    : []
  const frameIds = new Set(frames.map((frame) => frame.id))
  const segments = Array.isArray(raw.segments)
    ? raw.segments.filter((segment): segment is Segment =>
        Boolean(
          segment &&
            typeof segment === 'object' &&
            typeof segment.id === 'string' &&
            typeof segment.startTime === 'number' &&
            typeof segment.endTime === 'number',
        ))
    : []
  return {
    ...base,
    ...raw,
    id: typeof raw.id === 'string' && raw.id ? raw.id : base.id,
    projectTitle: typeof raw.projectTitle === 'string' ? raw.projectTitle : '',
    filmTitle: typeof raw.filmTitle === 'string' ? raw.filmTitle : '',
    sourceVideoPath: typeof raw.sourceVideoPath === 'string' ? raw.sourceVideoPath : '',
    frameInterval: typeof raw.frameInterval === 'number' && raw.frameInterval > 0 ? raw.frameInterval : base.frameInterval,
    duration: typeof raw.duration === 'number' && Number.isFinite(raw.duration) && raw.duration >= 0 ? raw.duration : 0,
    frames: frames.map((frame) => ({ ...frame, src: typeof frame.src === 'string' ? frame.src : '' })),
    subtitles: Array.isArray(raw.subtitles) ? raw.subtitles : [],
    segments: segments.map((segment) => ({
      ...segment,
      startFrameId: frameIds.has(segment.startFrameId) ? segment.startFrameId : frames[0]?.id ?? segment.startFrameId,
      endFrameId: frameIds.has(segment.endFrameId) ? segment.endFrameId : frames.at(-1)?.id ?? segment.endFrameId,
    })),
    storyLines: Array.isArray(raw.storyLines) ? raw.storyLines : undefined,
    shotDetection: normalizeShotDetection(raw.shotDetection),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : base.schemaVersion,
  }
}

function normalizeShotDetection(value: unknown): ShotDetection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<ShotDetection>
  if (!Array.isArray(raw.cuts)) return undefined
  const cuts = raw.cuts.filter((cut): cut is number => typeof cut === 'number' && Number.isFinite(cut) && cut >= 0).sort((a, b) => a - b)
  return {
    cuts,
    sampleStep: typeof raw.sampleStep === 'number' && raw.sampleStep > 0 ? raw.sampleStep : 0.3,
    analyzedAt: typeof raw.analyzedAt === 'string' ? raw.analyzedAt : new Date().toISOString(),
  }
}

export function compactProjectForPersistence(project: Project): Project {
  return {
    ...project,
    frames: project.frames.map((frame) => ({ ...frame, src: '' })),
  }
}

export function hasMissingFrameImages(project: Project): boolean {
  return project.frames.length > 0 && project.frames.some((frame) => !frame.src)
}

export function hasMeaningfulProjectContent(project: Project): boolean {
  const defaultTitles = new Set(['拉片笔记'])
  const hasCustomTitle = Boolean(
    (project.projectTitle.trim() && !defaultTitles.has(project.projectTitle.trim())) ||
      (project.filmTitle.trim() && !defaultTitles.has(project.filmTitle.trim())),
  )
  return Boolean(
    hasCustomTitle ||
      project.sourceVideoName ||
      project.subtitlePath ||
      project.learningGoal?.trim() ||
      project.screenplayResearch?.trim() ||
      project.aiSummary?.trim() ||
      project.frames.length ||
      project.subtitles.length ||
      project.segments.length ||
      project.macroAnalysis,
  )
}

export function createSegmentFromRange(startFrame: Frame, endFrame: Frame, duration = Math.max(startFrame.time, endFrame.time)): Segment {
  const now = new Date().toISOString()
  const startTime = Math.min(startFrame.time, endFrame.time)
  const endTime = Math.max(startFrame.time, endFrame.time)
  const type = inferSegmentType(startTime, endTime, duration)
  return {
    id: crypto.randomUUID(),
    startFrameId: startFrame.time <= endFrame.time ? startFrame.id : endFrame.id,
    endFrameId: startFrame.time <= endFrame.time ? endFrame.id : startFrame.id,
    startTime,
    endTime,
    type,
    title: `${type}段落 ${formatShortTime(startTime)}-${formatShortTime(endTime)}`,
    color: segmentColors[type],
    narrativeOrder: '顺叙',
    aiGenerated: false,
    confidence: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function inferSegmentType(startTime: number, endTime: number, duration: number): SegmentType {
  if (duration <= 0) return '推进'
  const midpoint = (startTime + endTime) / 2 / duration
  if (midpoint < 0.12) return '开场'
  if (midpoint < 0.3) return '冲突'
  if (midpoint < 0.65) return '推进'
  if (midpoint < 0.88) return '高潮'
  return '结尾'
}

function formatShortTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const restSeconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
}

export function updateSegmentWithAi(segment: Segment, analysis: Partial<Segment> & { confidence?: number }, mode: AiWriteMode = 'fill-empty'): Partial<Segment> {
  return {
    segmentFunction: mergeAiField(segment.segmentFunction, analysis.segmentFunction, mode),
    keyBeats: mergeAiField(segment.keyBeats, analysis.keyBeats, mode),
    screenplayDraft: mergeAiField(segment.screenplayDraft, analysis.screenplayDraft, mode),
    screenplayBlocks: mergeScreenplayBlocks(segment.screenplayBlocks, analysis.screenplayBlocks, mode),
    screenplaySceneIds: mergeSceneIds(segment.screenplaySceneIds, analysis.screenplaySceneIds, mode),
    screenplaySceneNote: mergeAiField(segment.screenplaySceneNote, analysis.screenplaySceneNote, mode),
    creativeIntent: mergeAiField(segment.creativeIntent, analysis.creativeIntent, mode),
    informationControl: mergeAiField(segment.informationControl, analysis.informationControl, mode),
    rhythmDesign: mergeAiField(segment.rhythmDesign, analysis.rhythmDesign, mode),
    techniques: mergeAiField(segment.techniques, analysis.techniques, mode),
    audienceExperience: mergeAiField(segment.audienceExperience, analysis.audienceExperience, mode),
    reusableMethod: mergeAiField(segment.reusableMethod, analysis.reusableMethod, mode),
    primaryLine: mergeAiField(segment.primaryLine, analysis.primaryLine, mode),
    isShared: analysis.isShared ?? segment.isShared,
    sharedLines: mergeLineIds(segment.sharedLines, analysis.sharedLines, mode),
    importance: analysis.importance ?? segment.importance,
    structureRole: mergeAiField(segment.structureRole, analysis.structureRole, mode),
    confidence: analysis.confidence ?? segment.confidence,
    aiGenerated: segment.aiGenerated,
  }
}

function mergeLineIds(current: string[] | undefined, incoming: string[] | undefined, mode: AiWriteMode): string[] | undefined {
  if (!incoming?.length) return current
  if (mode === 'replace') return incoming
  if (!current?.length) return incoming
  if (mode === 'append') return [...new Set([...current, ...incoming])]
  return current
}

function mergeScreenplayBlocks(
  current: Segment['screenplayBlocks'],
  incoming: Segment['screenplayBlocks'],
  mode: AiWriteMode,
): Segment['screenplayBlocks'] {
  if (!incoming?.length) return current
  if (mode === 'replace') return incoming
  if (mode === 'append') return [...(current ?? []), ...incoming]
  return current?.length ? current : incoming
}

function mergeSceneIds(current: number[] | undefined, incoming: number[] | undefined, mode: AiWriteMode): number[] | undefined {
  if (!incoming?.length) return current
  if (mode === 'replace') return normalizeSceneIds(incoming)
  if (mode === 'append') return normalizeSceneIds([...(current ?? []), ...incoming])
  return current?.length ? current : normalizeSceneIds(incoming)
}

function normalizeSceneIds(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value)).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b)
}

function mergeAiField(current: string | undefined, incoming: string | undefined, mode: AiWriteMode): string | undefined {
  if (!incoming) return current
  if (mode === 'replace') return incoming
  if (mode === 'append') return current ? `${current}\n\n${incoming}` : incoming
  return current || incoming
}

export function fallbackMacroAnalysis(): MacroAnalysis {
  return {
    overallStructure: '先判断这部片借用了哪种结构模型，或如何偏离常规模型；三幕、四段、旅程式、群像式都只是参考。',
    narrativeStrategy: '重点看主角或核心人物想要什么、阻力来自哪里、失败代价是什么，以及利害关系如何变大。',
    rhythmPattern: '标出激励事件、关键转折、中点变化、低谷、高潮和解决；若影片不按常规推进，也记录它如何偏离常规。',
    informationStrategy: '观察信息释放：观众先知道什么、被延迟什么、何时误判、何时反转、何时得到答案。',
    coreCreativeIntent: '判断人物在故事中发生了什么变化，以及作者为什么用这种人物变化承载主题。',
    writingLessons: [
      '先把电影拆成时间线上的剧情段落，再标出关键节点和节奏变化。',
      '每个段落先写作用，再补关键动作与信息控制。',
    ],
    confidence: 0.45,
  }
}
