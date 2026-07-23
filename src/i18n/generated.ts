import type { Project, Segment } from '../types.ts'
import type { Locale } from './core.ts'
import { translateText } from './translate.ts'

const tokenPrefix = '__LAPIAN_AUTHORED_TEXT_'

export type GeneratedTextLocalizer = {
  protect: (value: string | null | undefined) => string
  localize: (source: string) => string
}

export function createGeneratedTextLocalizer(locale: Locale = 'zh-CN'): GeneratedTextLocalizer {
  const replacements: Array<{ token: string; value: string }> = []

  const protect = (value: string | null | undefined): string => {
    if (!value) return value ?? ''
    const token = `${tokenPrefix}${String(replacements.length).padStart(4, '0')}__`
    replacements.push({ token, value })
    return token
  }

  const localize = (source: string): string => {
    let localized = locale === 'zh-CN'
      ? source
      : source
          .split('\n')
          .map((line) => translateText(line, locale))
          .join('\n')

    localized = localized.replace(/^(#{1,6})(?!#|\s)/gm, '$1 ')
    for (const { token, value } of replacements) {
      localized = localized.replaceAll(token, value)
    }
    return localized
  }

  return { protect, localize }
}

function protectSegment(segment: Segment, protect: GeneratedTextLocalizer['protect']): Segment {
  return {
    ...segment,
    id: protect(segment.id),
    startFrameId: protect(segment.startFrameId),
    endFrameId: protect(segment.endFrameId),
    title: protect(segment.title),
    color: protect(segment.color),
    segmentFunction: segment.segmentFunction ? protect(segment.segmentFunction) : segment.segmentFunction,
    keyBeats: segment.keyBeats ? protect(segment.keyBeats) : segment.keyBeats,
    screenplayDraft: segment.screenplayDraft ? protect(segment.screenplayDraft) : segment.screenplayDraft,
    screenplayBlocks: segment.screenplayBlocks?.map((block) => ({
      ...block,
      id: protect(block.id),
      text: protect(block.text),
    })),
    creativeIntent: segment.creativeIntent ? protect(segment.creativeIntent) : segment.creativeIntent,
    informationControl: segment.informationControl ? protect(segment.informationControl) : segment.informationControl,
    rhythmDesign: segment.rhythmDesign ? protect(segment.rhythmDesign) : segment.rhythmDesign,
    techniques: segment.techniques ? protect(segment.techniques) : segment.techniques,
    audienceExperience: segment.audienceExperience ? protect(segment.audienceExperience) : segment.audienceExperience,
    reusableMethod: segment.reusableMethod ? protect(segment.reusableMethod) : segment.reusableMethod,
    notes: segment.notes ? protect(segment.notes) : segment.notes,
    primaryLine: segment.primaryLine ? protect(segment.primaryLine) : segment.primaryLine,
    sharedLines: segment.sharedLines?.map((line) => protect(line)),
    structureRole: segment.structureRole ? protect(segment.structureRole) : segment.structureRole,
  }
}

export function protectProjectAuthoredText(
  project: Project,
  protect: GeneratedTextLocalizer['protect'],
): Project {
  return {
    ...project,
    id: protect(project.id),
    projectTitle: protect(project.projectTitle),
    filmTitle: protect(project.filmTitle),
    sourceVideoPath: protect(project.sourceVideoPath),
    sourceVideoName: project.sourceVideoName ? protect(project.sourceVideoName) : project.sourceVideoName,
    subtitlePath: project.subtitlePath ? protect(project.subtitlePath) : project.subtitlePath,
    learningGoal: project.learningGoal ? protect(project.learningGoal) : project.learningGoal,
    aiSummary: project.aiSummary ? protect(project.aiSummary) : project.aiSummary,
    frames: project.frames.map((frame) => ({
      ...frame,
      id: protect(frame.id),
      note: frame.note ? protect(frame.note) : frame.note,
    })),
    subtitles: project.subtitles.map((subtitle) => ({
      ...subtitle,
      id: protect(subtitle.id),
      text: protect(subtitle.text),
    })),
    segments: project.segments.map((segment) => protectSegment(segment, protect)),
    storyLines: project.storyLines?.map((line) => ({
      ...line,
      id: protect(line.id),
      title: protect(line.title),
      subtitle: line.subtitle ? protect(line.subtitle) : line.subtitle,
      description: line.description ? protect(line.description) : line.description,
    })),
    macroAnalysis: project.macroAnalysis
      ? {
          ...project.macroAnalysis,
          overallStructure: protect(project.macroAnalysis.overallStructure),
          narrativeStrategy: protect(project.macroAnalysis.narrativeStrategy),
          rhythmPattern: protect(project.macroAnalysis.rhythmPattern),
          informationStrategy: protect(project.macroAnalysis.informationStrategy),
          coreCreativeIntent: protect(project.macroAnalysis.coreCreativeIntent),
          writingLessons: project.macroAnalysis.writingLessons.map((lesson) => protect(lesson)),
        }
      : project.macroAnalysis,
    audienceCurvePoints: project.audienceCurvePoints?.map((point) => ({
      ...point,
      id: protect(point.id),
      title: protect(point.title),
      description: point.description ? protect(point.description) : point.description,
      relatedBlockIds: point.relatedBlockIds?.map((id) => protect(id)),
    })),
  }
}

export function protectSegmentAuthoredText(
  segment: Segment,
  protect: GeneratedTextLocalizer['protect'],
): Segment {
  return protectSegment(segment, protect)
}
