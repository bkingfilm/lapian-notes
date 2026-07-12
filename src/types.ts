export interface Project {
  id: string
  projectTitle: string
  filmTitle: string
  sourceVideoPath: string
  sourceVideoName?: string
  subtitlePath?: string
  frameInterval: number
  duration: number
  frames: Frame[]
  subtitles: Subtitle[]
  segments: Segment[]
  storyLines?: StoryLine[]
  macroAnalysis?: MacroAnalysis
  audienceCurvePoints?: AudienceCurvePoint[]
  learningGoal?: string
  screenplayResearch?: string
  aiSummary?: string
  createdAt: string
  updatedAt: string
  schemaVersion: string
}

export interface StoryLine {
  id: string
  title: string
  subtitle?: string
  description?: string
}

export type AiWriteMode = 'fill-empty' | 'append' | 'replace'

export interface Frame {
  id: string
  index: number
  time: number
  src: string
  note?: string
}

export interface Subtitle {
  id: string
  startTime: number
  endTime: number
  text: string
}

export interface Segment {
  id: string
  startFrameId: string
  endFrameId: string
  startTime: number
  endTime: number
  type: SegmentType
  title: string
  color: string
  narrativeOrder?: NarrativeOrder
  segmentFunction?: string
  keyBeats?: string
  screenplayDraft?: string
  screenplayBlocks?: ScreenplayBlock[]
  screenplaySceneIds?: number[]
  screenplaySceneNote?: string
  creativeIntent?: string
  informationControl?: string
  rhythmDesign?: string
  techniques?: string
  audienceExperience?: string
  reusableMethod?: string
  notes?: string
  primaryLine?: string
  isShared?: boolean
  sharedLines?: string[]
  importance?: SegmentImportance
  structureRole?: string
  aiGenerated?: boolean
  confidence?: number
  createdAt: string
  updatedAt: string
}

export type SegmentImportance = 'normal' | 'key' | 'pivot'

export type VisualTimelineBlock = Segment & {
  visualId: string
  renderLine: string
  isPrimaryVisual: boolean
}

export type AudienceEmotionType =
  | 'curiosity'
  | 'humor'
  | 'warmth'
  | 'romance'
  | 'tension'
  | 'anxiety'
  | 'sadness'
  | 'conflict'
  | 'hope'
  | 'release'
  | 'inspiration'
  | 'aftertaste'

export type AudienceCurvePointImportance = 'normal' | 'key' | 'peak' | 'low'

export type AudienceRhythmRole =
  | 'setup'
  | 'rise'
  | 'drop'
  | 'pressure'
  | 'release'
  | 'cooldown'
  | 'suspense'
  | 'peak'
  | 'low'
  | 'aftertaste'

export interface AudienceCurvePoint {
  id: string
  time: number
  intensity: number
  valence?: number
  emotionType: AudienceEmotionType
  rhythmRole?: AudienceRhythmRole
  title: string
  description?: string
  relatedBlockIds?: string[]
  importance?: AudienceCurvePointImportance
  showLabel?: boolean
  source?: 'ai' | 'manual'
  locked?: boolean
}

export interface ScreenplayBlock {
  id: string
  type: ScreenplayBlockType
  time?: number
  text: string
}

export type ScreenplayBlockType = '场景' | '动作' | '对白' | '旁白/字幕' | '手语/字幕' | '备注'

export interface MacroAnalysis {
  overallStructure: string
  narrativeStrategy: string
  rhythmPattern: string
  informationStrategy: string
  coreCreativeIntent: string
  writingLessons: string[]
  confidence?: number
}

export type SegmentType =
  | '开场'
  | '起'
  | '承'
  | '转'
  | '合'
  | '冲突'
  | '推进'
  | '转折'
  | '升级'
  | '低谷'
  | '高潮'
  | '结尾'
  | '支线'
  | '过渡'
  | '背景'
  | '说明'
  | '结论'

export type NarrativeOrder =
  | '顺叙'
  | '倒叙'
  | '插叙'
  | '并行叙事'
  | '蒙太奇压缩'
  | '信息反转'
  | '循环叙事'
  | '主观视角'
  | '多线并行'
  | '主线'
  | '支线'
  | '回环'

export const segmentTypes: SegmentType[] = [
  '开场',
  '起',
  '承',
  '转',
  '合',
  '冲突',
  '推进',
  '转折',
  '升级',
  '低谷',
  '高潮',
  '结尾',
  '支线',
  '过渡',
  '背景',
  '说明',
  '结论',
]

export const narrativeOrders: NarrativeOrder[] = [
  '顺叙',
  '倒叙',
  '插叙',
  '并行叙事',
  '蒙太奇压缩',
  '信息反转',
  '循环叙事',
  '主观视角',
  '多线并行',
  '主线',
  '支线',
  '回环',
]
