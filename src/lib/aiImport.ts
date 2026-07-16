import type { AudienceCurvePoint, AudienceCurvePointImportance, AudienceEmotionType, AudienceRhythmRole, MacroAnalysis, NarrativeOrder, Project, Segment, SegmentType, StoryLine } from '../types'
import { narrativeOrders, segmentTypes } from '../types'
import { type AiTimeValue, clampTime, parseAiTime } from './aiTime'
import { segmentColors } from './project'
import { AUDIENCE_LINE_ID } from './storyLines'

interface ImportedAnalysis {
  movieIdentity?: ImportedMovieIdentity
  project?: ImportedMovieIdentity
  projectMeta?: ImportedMovieIdentity
  metadata?: ImportedMovieIdentity
  macroAnalysis?: Partial<MacroAnalysis>
  storyLines?: unknown
  segments?: ImportedSegment[]
  segmentDeepDive?: unknown
  audienceCurvePoints?: ImportedAudienceCurvePoint[]
  emotionPoints?: ImportedAudienceCurvePoint[]
}

export interface SegmentDeepDiveImport {
  segmentId?: string
  startTime?: number
  endTime?: number
  patch: Partial<Segment>
}

interface ImportedMovieIdentity {
  projectTitle?: unknown
  filmTitle?: unknown
  sourceVideoName?: unknown
  movieTitle?: unknown
  title?: unknown
}

type ImportedSegment = Partial<Segment> & {
  startTime?: AiTimeValue
  endTime?: AiTimeValue
  start?: AiTimeValue
  end?: AiTimeValue
}

type ImportedAudienceCurvePoint = Partial<AudienceCurvePoint> & {
  isKeyPoint?: boolean
}

export interface AiImportPreview {
  hasMacroAnalysis: boolean
  segmentCount: number
  needsTimeline: boolean
  deepDive?: { title?: string; startTime?: number; endTime?: number; blockCount: number }
}

export function previewAiAnalysisImport(project: Project, text: string): AiImportPreview {
  const parsed = unwrapImportedPayload(parsePastedJson(text))
  if (Array.isArray(parsed)) {
    return {
      hasMacroAnalysis: false,
      segmentCount: parsed.length,
      needsTimeline: parsed.length > 0 && !project.frames.length,
    }
  }
  if (!isRecord(parsed)) throw new Error('没有识别到可解析的 AI JSON。')
  if (isImportedAnalysis(parsed)) {
    const imported = parsed as ImportedAnalysis
    const segments = Array.isArray(imported.segments) ? imported.segments : []
    const deepDive = normalizeSegmentDeepDive(project, imported.segmentDeepDive)
    return {
      hasMacroAnalysis: Boolean(normalizeMacroAnalysis(imported.macroAnalysis)),
      segmentCount: segments.length,
      needsTimeline: segments.length > 0 && !project.frames.length,
      deepDive: deepDive
        ? {
            title: deepDive.patch.title,
            startTime: deepDive.startTime,
            endTime: deepDive.endTime,
            blockCount: deepDive.patch.screenplayBlocks?.length ?? 0,
          }
        : undefined,
    }
  }
  return {
    hasMacroAnalysis: Boolean(normalizeMacroAnalysis(parsed as Partial<MacroAnalysis>)),
    segmentCount: 0,
    needsTimeline: false,
  }
}

export function importAiAnalysis(project: Project, text: string, options?: { skipMovieCheck?: boolean }): { macroAnalysis?: MacroAnalysis; segments: Segment[]; audienceCurvePoints?: AudienceCurvePoint[]; storyLines?: StoryLine[]; segmentDeepDive?: SegmentDeepDiveImport } {
  const parsed = unwrapImportedPayload(parsePastedJson(text))
  if (!options?.skipMovieCheck) validateImportedMovieMatch(project, parsed)
  if (Array.isArray(parsed)) {
    if (!project.frames.length) throw new Error('导入分段需要先生成时间轴。')
    return {
      segments: normalizeImportedSegments(project, parsed as ImportedSegment[]),
      audienceCurvePoints: [],
    }
  }
  if (!isRecord(parsed)) throw new Error('没有识别到可解析的 AI JSON。')
  let macroSource: Partial<MacroAnalysis> | undefined
  let segmentsSource: ImportedSegment[] = []
  let audienceCurveSource: ImportedAudienceCurvePoint[] = []
  let storyLinesSource: unknown
  let deepDiveSource: unknown
  if (isImportedAnalysis(parsed)) {
    const imported = parsed as ImportedAnalysis
    macroSource = imported.macroAnalysis
    segmentsSource = Array.isArray(imported.segments) ? imported.segments : []
    storyLinesSource = imported.storyLines
    deepDiveSource = imported.segmentDeepDive
    audienceCurveSource = Array.isArray(imported.audienceCurvePoints)
      ? imported.audienceCurvePoints
      : Array.isArray(imported.emotionPoints)
        ? imported.emotionPoints
        : []
  } else {
    macroSource = parsed as Partial<MacroAnalysis>
  }
  if (segmentsSource.length && !project.frames.length) throw new Error('导入分段需要先生成时间轴；如果只想导入全片分析，请不要包含 segments。')
  return {
    macroAnalysis: normalizeMacroAnalysis(macroSource),
    segments: normalizeImportedSegments(project, segmentsSource),
    audienceCurvePoints: normalizeAudienceCurvePoints(audienceCurveSource, project.duration),
    storyLines: normalizeImportedStoryLines(storyLinesSource),
    segmentDeepDive: normalizeSegmentDeepDive(project, deepDiveSource),
  }
}

function normalizeSegmentDeepDive(project: Project, value: unknown): SegmentDeepDiveImport | undefined {
  if (!isRecord(value)) return undefined
  const patch: Partial<Segment> = {}
  const title = stringOr(value.title)
  if (title) patch.title = title
  for (const key of ['screenplayDraft', 'segmentFunction', 'keyBeats', 'techniques', 'creativeIntent', 'informationControl', 'rhythmDesign', 'audienceExperience', 'reusableMethod'] as const) {
    const text = stringOr(value[key])
    if (text) patch[key] = text
  }
  const blocks = normalizeScreenplayBlocks(project, value.screenplayBlocks)
  if (blocks?.length) patch.screenplayBlocks = blocks
  if (typeof value.confidence === 'number') patch.confidence = value.confidence
  if (!Object.keys(patch).length) return undefined
  return {
    segmentId: stringOr(value.segmentId) || undefined,
    startTime: typeof value.startTime === 'number' ? value.startTime : undefined,
    endTime: typeof value.endTime === 'number' ? value.endTime : undefined,
    patch,
  }
}

function normalizeImportedStoryLines(value: unknown): StoryLine[] | undefined {
  if (!Array.isArray(value)) return undefined
  const lines: StoryLine[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = stringOr(item.id).replace(/\s+/g, '_').toLowerCase()
    const title = stringOr(item.title) || stringOr(item.label) || stringOr(item.name)
    if (!id || !title || id === AUDIENCE_LINE_ID) continue
    if (lines.some((line) => line.id === id)) continue
    const line: StoryLine = { id, title }
    const subtitle = stringOr(item.subtitle)
    const description = stringOr(item.description)
    if (subtitle) line.subtitle = subtitle
    if (description) line.description = description
    lines.push(line)
  }
  return lines.length ? lines : undefined
}

function normalizeImportedSegments(project: Project, segments: ImportedSegment[]): Segment[] {
  return segments
    .map((segment) => normalizeSegment(project, segment))
    .filter((segment): segment is Segment => Boolean(segment))
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)
}

function isImportedAnalysis(value: unknown): value is ImportedAnalysis {
  return isRecord(value) && ('macroAnalysis' in value || 'segments' in value || 'segmentDeepDive' in value || 'audienceCurvePoints' in value || 'emotionPoints' in value)
}

function parsePastedJson(text: string): unknown {
  const jsonText = extractJsonText(text)
  try {
    return JSON.parse(jsonText)
  } catch (error) {
    try {
      return JSON.parse(repairLooseJson(jsonText))
    } catch {
      throw error
    }
  }
}

function unwrapImportedPayload(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (isImportedAnalysis(value) || isMacroLike(value)) return value
  for (const key of ['result', 'data', 'analysis', 'output', 'content']) {
    const nested = value[key]
    if (isRecord(nested) && (isImportedAnalysis(nested) || isMacroLike(nested))) return nested
    if (Array.isArray(nested)) return nested
  }
  return value
}

function validateImportedMovieMatch(project: Project, parsed: unknown) {
  const importedNames = extractImportedMovieNames(parsed)
  if (!importedNames.length) return

  const currentNames = [
    project.projectTitle,
    project.filmTitle,
    project.sourceVideoName,
    project.sourceVideoPath,
  ].filter((value): value is string => Boolean(value?.trim()))

  if (!currentNames.length) return

  const importedNormalized = importedNames.map(normalizeMovieName).filter(Boolean)
  const currentNormalized = currentNames.map(normalizeMovieName).filter(Boolean)
  const matched = importedNormalized.some((imported) =>
    currentNormalized.some((current) => current.includes(imported) || imported.includes(current)),
  )

  if (!matched) {
    const error = new Error(`AI 结果似乎属于“${importedNames[0]}”，和当前项目“${currentNames[0]}”不一致。`)
    error.name = 'MovieMismatchError'
    throw error
  }
}

function extractImportedMovieNames(value: unknown): string[] {
  if (!isRecord(value)) return []
  const names = new Set<string>()
  collectMovieNames(value, names)
  for (const key of ['movieIdentity', 'project', 'projectMeta', 'metadata', 'meta']) {
    const nested = value[key]
    if (isRecord(nested)) collectMovieNames(nested, names)
  }
  return [...names]
}

function collectMovieNames(value: Record<string, unknown>, names: Set<string>) {
  for (const key of ['filmTitle', 'sourceVideoName', 'projectTitle', 'movieTitle']) {
    const item = value[key]
    if (typeof item === 'string' && item.trim()) names.add(item.trim())
  }
}

function normalizeMovieName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[【[].*?[】\]]/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[【】[\]（）(){}<>《》「」『』"'“”‘’]/g, '')
    .replace(/中英双字|中文字幕|英文字幕|双语字幕|浏览器兼容版|兼容版|转码版|蓝光|bluray|bdrip|bd|web-dl|webrip|1080p|2160p|720p|x264|x265|h264|h265|aac|dts|hdr|sdr|分辨率/gi, '')
    .replace(/\d{3,4}p?/gi, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
}

function isMacroLike(value: Record<string, unknown>): boolean {
  return (
    'overallStructure' in value ||
    'narrativeStrategy' in value ||
    'rhythmPattern' in value ||
    'informationStrategy' in value ||
    'coreCreativeIntent' in value ||
    'writingLessons' in value
  )
}

function repairLooseJson(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
}

function extractJsonText(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced) return fenced[1].trim()
  const start = firstJsonStart(trimmed)
  if (start < 0) throw new Error('没有找到 JSON 内容。')
  const extracted = readBalancedJson(trimmed, start)
  if (!extracted) throw new Error('JSON 内容不完整，请检查粘贴格式。')
  return extracted
}

function firstJsonStart(text: string): number {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  if (objectStart < 0) return arrayStart
  if (arrayStart < 0) return objectStart
  return Math.min(objectStart, arrayStart)
}

function readBalancedJson(text: string, start: number): string | null {
  const opening = text[start]
  const closing = opening === '{' ? '}' : opening === '[' ? ']' : ''
  if (!closing) return null
  const stack = [closing]
  let inString = false
  let escaped = false
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') stack.push('}')
    if (char === '[') stack.push(']')
    if (char === '}' || char === ']') {
      if (stack.at(-1) !== char) return null
      stack.pop()
      if (!stack.length) return text.slice(start, index + 1)
    }
  }
  return null
}

function normalizeMacroAnalysis(value?: Partial<MacroAnalysis>): MacroAnalysis | undefined {
  if (!value) return undefined
  if (
    !value.overallStructure &&
    !value.narrativeStrategy &&
    !value.rhythmPattern &&
    !value.informationStrategy &&
    !value.coreCreativeIntent &&
    !value.writingLessons?.length
  ) {
    return undefined
  }
  return {
    overallStructure: value.overallStructure ?? '',
    narrativeStrategy: value.narrativeStrategy ?? '',
    rhythmPattern: value.rhythmPattern ?? '',
    informationStrategy: value.informationStrategy ?? '',
    coreCreativeIntent: value.coreCreativeIntent ?? '',
    writingLessons: Array.isArray(value.writingLessons) ? value.writingLessons.map(String) : [],
    confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
  }
}

function normalizeSegment(project: Project, segment: ImportedSegment): Segment | null {
  const now = new Date().toISOString()
  const startTime = clampTime(parseAiTime(segment.startTime ?? segment.start), project.duration)
  const endTime = clampTime(parseAiTime(segment.endTime ?? segment.end, startTime), project.duration)
  const start = Math.min(startTime, endTime)
  const end = Math.max(startTime, endTime)
  if (end - start < Math.max(1, project.frameInterval * 0.5)) return null
  const startFrame = nearestFrame(project, start)
  const endFrame = nearestFrame(project, end)
  const type = normalizeSegmentType(segment.type)

  return {
    id: crypto.randomUUID(),
    startFrameId: startFrame.id,
    endFrameId: endFrame.id,
    startTime: start,
    endTime: end,
    type,
    title: stringOr(segment.title, '未命名段落'),
    color: segmentColors[type],
    narrativeOrder: normalizeNarrativeOrder(segment.narrativeOrder),
    segmentFunction: stringOr(segment.segmentFunction),
    keyBeats: stringOr(segment.keyBeats),
    screenplayDraft: stringOr(segment.screenplayDraft),
    screenplayBlocks: normalizeScreenplayBlocks(project, segment.screenplayBlocks),
    creativeIntent: stringOr(segment.creativeIntent),
    informationControl: stringOr(segment.informationControl),
    rhythmDesign: stringOr(segment.rhythmDesign),
    techniques: stringOr(segment.techniques),
    audienceExperience: stringOr(segment.audienceExperience),
    reusableMethod: stringOr(segment.reusableMethod),
    notes: stringOr(segment.notes),
    primaryLine: stringOr(segment.primaryLine) || undefined,
    isShared: typeof segment.isShared === 'boolean' ? segment.isShared : undefined,
    sharedLines: normalizeSharedLines(segment.sharedLines, segment.primaryLine),
    importance: normalizeImportance(segment.importance),
    structureRole: stringOr(segment.structureRole) || undefined,
    aiGenerated: true,
    confidence: typeof segment.confidence === 'number' ? segment.confidence : 0.5,
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeScreenplayBlocks(project: Project, value: unknown): Segment['screenplayBlocks'] {
  if (!Array.isArray(value)) return undefined
  const blocks = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const text = stringOr(record.text)
      if (!text) return null
      return {
        id: stringOr(record.id, crypto.randomUUID()),
        type: normalizeScreenplayBlockType(record.type),
        time: typeof record.time === 'number' ? clampTime(record.time, project.duration) : undefined,
        text,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  return blocks.length ? blocks : undefined
}

function normalizeScreenplayBlockType(value: unknown): NonNullable<Segment['screenplayBlocks']>[number]['type'] {
  if (value === '手语/字幕') return '旁白/字幕'
  if (value === '场景' || value === '动作' || value === '对白' || value === '旁白/字幕' || value === '备注') return value
  return '动作'
}

function normalizeAudienceCurvePoints(points: ImportedAudienceCurvePoint[], duration: number): AudienceCurvePoint[] {
  const normalized: AudienceCurvePoint[] = []
  points
    .map((point) => {
      const time = clampTime(parseAiTime(point.time), duration)
      const title = stringOr(point.title)
      if (!title) return null
      const intensity = clampNumber(Number(point.intensity), 0, 100, 50)
      const valence = point.valence === undefined ? undefined : clampNumber(Number(point.valence), -100, 100, 0)
      const importance = normalizeCurveImportance(point.importance, point.isKeyPoint)
      const normalizedPoint: AudienceCurvePoint = {
        id: stringOr(point.id, crypto.randomUUID()),
        time,
        intensity,
        valence,
        emotionType: normalizeEmotionType(point.emotionType),
        rhythmRole: normalizeRhythmRole(point.rhythmRole),
        title,
        description: stringOr(point.description) || undefined,
        relatedBlockIds: normalizeStringArray(point.relatedBlockIds),
        importance,
        showLabel: typeof point.showLabel === 'boolean' ? point.showLabel : importance !== 'normal' ? true : undefined,
        source: point.source === 'manual' ? 'manual' : 'ai',
        locked: typeof point.locked === 'boolean' ? point.locked : undefined,
      }
      return normalizedPoint
    })
    .forEach((point) => {
      if (point) normalized.push(point)
    })
  return normalized.sort((a, b) => a.time - b.time)
}

function normalizeEmotionType(value: unknown): AudienceEmotionType {
  const allowed: AudienceEmotionType[] = ['curiosity', 'humor', 'warmth', 'romance', 'tension', 'anxiety', 'sadness', 'conflict', 'hope', 'release', 'inspiration', 'aftertaste']
  return typeof value === 'string' && allowed.includes(value as AudienceEmotionType) ? value as AudienceEmotionType : 'curiosity'
}

function normalizeCurveImportance(value: unknown, isKeyPoint?: boolean): AudienceCurvePointImportance {
  if (value === 'normal' || value === 'key' || value === 'peak' || value === 'low') return value
  return isKeyPoint ? 'key' : 'normal'
}

function normalizeRhythmRole(value: unknown): AudienceRhythmRole | undefined {
  const allowed: AudienceRhythmRole[] = ['setup', 'rise', 'drop', 'pressure', 'release', 'cooldown', 'suspense', 'peak', 'low', 'aftertaste']
  return typeof value === 'string' && allowed.includes(value as AudienceRhythmRole) ? value as AudienceRhythmRole : undefined
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = [...new Set(value.map((item) => stringOr(item)).filter(Boolean))]
  return items.length ? items : undefined
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function normalizeSharedLines(value: unknown, primaryLine: unknown): string[] | undefined {
  const lines = Array.isArray(value) ? value.map((item) => stringOr(item)).filter(Boolean) : []
  const primary = stringOr(primaryLine)
  const merged = [...new Set([primary, ...lines].filter(Boolean))]
  return merged.length ? merged : undefined
}

function normalizeImportance(value: unknown): Segment['importance'] {
  if (value === 'key' || value === 'pivot' || value === 'normal') return value
  return undefined
}

function normalizeSegmentType(value?: SegmentType): SegmentType {
  return value && segmentTypes.includes(value) ? value : '推进'
}

function normalizeNarrativeOrder(value?: NarrativeOrder): NarrativeOrder {
  return value && narrativeOrders.includes(value) ? value : '顺叙'
}

function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function nearestFrame(project: Project, time: number) {
  return project.frames.reduce((nearest, frame) =>
    Math.abs(frame.time - time) < Math.abs(nearest.time - time) ? frame : nearest,
  )
}
