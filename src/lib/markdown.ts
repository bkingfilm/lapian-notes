import type { Frame, Project, ScreenplayBlockType, Segment, Subtitle } from '../types'
import { getMacroProgress } from './macroProgress'
import { getSegmentCoverage } from './segmentCoverage'
import { getSegmentProgress } from './segmentProgress'
import { buildStoryStructure, segmentStorySummary, segmentStructuralRole, storyLineLabelForSegment } from './storyStructure'
import { formatShotSeconds, getCutDensity, getShotStats } from './shotStats'
import { secondsToTimecode } from './timecode'
import { frameFileName } from './frameFileName'
import { normalizeTimelineBlock } from './timelineBlock'

const timelineLineLabels: Record<string, string> = {
  main: '主线 / 核心选择',
  music: '目标 / 行动线',
  romance: '关系副线',
  livelihood: '外部压力线',
  family: '人物关系线',
  emotion: '情绪线',
  information: '观众信息线',
}

const audienceEmotionLabels = {
  curiosity: '好奇',
  humor: '幽默',
  warmth: '温暖',
  romance: '心动',
  tension: '紧张',
  anxiety: '焦虑',
  sadness: '伤感',
  conflict: '冲突',
  hope: '希望',
  release: '释放',
  inspiration: '振奋',
  aftertaste: '余韵',
} as const

const audienceImportanceLabels = {
  normal: '普通',
  key: '关键变化',
  peak: '峰值',
  low: '低谷',
} as const

const audienceRhythmRoleLabels = {
  setup: '铺垫',
  rise: '抬升',
  drop: '回落',
  pressure: '加压',
  release: '释放',
  cooldown: '冷却',
  suspense: '悬置',
  peak: '峰值',
  low: '低谷',
  aftertaste: '余韵',
} as const

export function exportMarkdown(project: Project): string {
  const macro = project.macroAnalysis
  const sortedSegments = [...project.segments].sort((a, b) => a.startTime - b.startTime)
  const coverage = getSegmentCoverage(sortedSegments, project.duration)
  const macroProgress = getMacroProgress(macro)
  const averageSegmentProgress = sortedSegments.length
    ? Math.round(sortedSegments.reduce((sum, segment) => sum + getSegmentProgress(segment).percent, 0) / sortedSegments.length)
    : 0
  const hasMacro = Boolean(macro)
  const hasTimeline = project.frames.length > 0 || sortedSegments.length > 0 || project.subtitles.length > 0
  const screenplayStats = getScreenplayBlockStats(sortedSegments)

  return [
    `# ${project.projectTitle || '拉片笔记'}`,
    '',
    '> 一份按时间轴组织的电影文字剧本拆解，重点呈现每个段落的剧情文本、剧本功能、关键节拍和人工修订空间。',
    project.frames.some((frame) => frame.src) ? '> 如果与保存的项目 ZIP 一起查看，代表帧文件位于 `frames/` 文件夹。' : '',
    '',
    '## 基本信息',
    '',
    `- 影片名：${project.filmTitle || project.projectTitle || '未填写'}`,
    project.sourceVideoName ? `- 视频文件：${project.sourceVideoName}` : '',
    project.subtitlePath ? `- 字幕文件：${project.subtitlePath}` : '',
    hasTimeline ? `- 片长：${secondsToTimecode(project.duration)}` : '',
    hasTimeline ? `- 抽帧间隔：${project.frameInterval}s` : '',
    hasTimeline ? `- 时间点数量：${project.frames.length}` : '',
    project.subtitles.length ? `- 字幕数量：${project.subtitles.length}` : '',
    sortedSegments.length ? `- 段落数量：${project.segments.length}` : '',
    sortedSegments.length ? `- 时间轴覆盖：${coverage.percent}%` : '',
    hasMacro ? `- 全片分析完成度：${macroProgress.percent}%` : '',
    hasMacro ? `- 全片分析待补：${macroProgress.missing.length ? macroProgress.missing.join('、') : '无'}` : '',
    sortedSegments.length ? `- 段落平均完成度：${averageSegmentProgress}%` : '',
    hasTimeline ? `- 时间轴缺口：${coverage.gaps.length ? coverage.gaps.map((gap) => `${secondsToTimecode(gap.startTime)} - ${secondsToTimecode(gap.endTime)}`).join('；') : '无明显缺口'}` : '',
    project.learningGoal ? `- 拆解目标：${project.learningGoal}` : '',
    '',
    ...(hasTimeline || sortedSegments.length || hasMacro
      ? renderRevisionChecklist(project, sortedSegments, coverage, macroProgress)
      : []),
    ...(hasMacro
      ? [
          '## 全片结构与节奏分析',
          '',
          '### 结构模型判断',
          textOrBlank(macro?.overallStructure),
          '',
          '### 主角目标 / 阻力 / 利害',
          textOrBlank(macro?.narrativeStrategy),
          '',
          '### 关键转折 / 高潮 / 解决',
          textOrBlank(macro?.rhythmPattern),
          '',
          '### 信息释放 / 悬念 / 反转',
          textOrBlank(macro?.informationStrategy),
          '',
          '### 人物变化 / 主题选择',
          textOrBlank(macro?.coreCreativeIntent),
          '',
          '### 可复用方法',
          ...(macro?.writingLessons.length ? macro.writingLessons.map((item, index) => `${index + 1}. ${item}`) : ['（待补充）']),
          '',
        ]
      : []),
    ...(project.audienceCurvePoints?.length
      ? renderAudienceCurveMarkdown(project)
      : []),
    ...renderShotRhythmMarkdown(project, sortedSegments),
    ...(sortedSegments.length
      ? [
          ...renderStoryStructure(sortedSegments, project.subtitles),
          ...(screenplayStats.total ? renderScreenplayRhythmSummary(sortedSegments) : []),
          '## 文字剧本正文',
          '',
          ...sortedSegments.flatMap((segment, index) => renderScreenplayBody(segment, index)),
          '',
          '## 文字剧本时间轴',
          '',
          '| 时间范围 | 时长 | 剧情线 | 类型 | 标题 | 完成度 | 待补字段 | 段落作用 | 关键节拍 | 观众体验 |',
          '|---|---:|---|---|---|---|---|---|---|---|',
          ...sortedSegments.map((segment) => {
            const progress = getSegmentProgress(segment)
            return `| ${secondsToTimecode(segment.startTime)} - ${secondsToTimecode(segment.endTime)} | ${formatDuration(segment)} | ${escapeCell(storyLineLabelForSegment(segment))} | ${escapeCell(segment.type)} | ${escapeCell(segment.title)} | ${progress.percent}% | ${escapeCell(progress.missing.join('、') || '无')} | ${escapeCell(segmentStructuralRole(segment))} | ${escapeCell(segment.keyBeats)} | ${escapeCell(segment.audienceExperience)} |`
          }),
          '',
          '## 剧本还原提纲',
          '',
          ...sortedSegments.flatMap((segment, index) => renderScreenplayOutline(segment, index)),
          '',
          '## 分段笔记',
          '',
          ...sortedSegments.flatMap((segment) => renderSegment(project.frames, project.subtitles, segment)),
        ]
      : []),
  ].filter((line) => line !== '').join('\n')
}

export function exportScreenplayText(project: Project): string {
  const sortedSegments = [...project.segments].sort((a, b) => a.startTime - b.startTime)
  return [
    `# ${project.projectTitle || project.filmTitle || '文字剧本正文'}`,
    '',
    `> ${project.filmTitle || project.projectTitle || '未命名影片'}｜按时间轴整理的剧本正文草稿。`,
    '',
    sortedSegments.length
      ? sortedSegments.flatMap((segment, index) => renderScreenplayBody(segment, index))
      : ['（暂无剧情段落，请先导入电影并生成时间轴。）'],
    ...(project.audienceCurvePoints?.length ? renderAudienceCurveText(project) : []),
  ].flat().filter((line) => line !== '').join('\n')
}

function renderRevisionChecklist(
  project: Project,
  segments: Segment[],
  coverage: ReturnType<typeof getSegmentCoverage>,
  macroProgress: ReturnType<typeof getMacroProgress>,
): string[] {
  const incompleteSegments = segments
    .map((segment, index) => ({ segment, index, progress: getSegmentProgress(segment) }))
    .filter((item) => item.progress.percent < 100)
  const lowConfidenceSegments = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => typeof segment.confidence === 'number' && segment.confidence < 0.6)
  const checklist: string[] = []

  if (!project.subtitles.length) {
    checklist.push('- 未导入字幕：对白、旁白/字幕和信息释放判断需要结合画面人工核对。')
  }
  if (macroProgress.missing.length) {
    checklist.push(`- 全片结构待补：${macroProgress.missing.join('、')}`)
  }
  if (coverage.gaps.length) {
    checklist.push(...coverage.gaps.map((gap) => `- 时间轴缺口：${secondsToTimecode(gap.startTime)} - ${secondsToTimecode(gap.endTime)}`))
  }
  if (incompleteSegments.length) {
    checklist.push(
      ...incompleteSegments.map(({ segment, index, progress }) =>
        `- 第 ${index + 1} 段待补：${secondsToTimecode(segment.startTime)} - ${secondsToTimecode(segment.endTime)}｜${segment.title || segment.type}｜缺 ${progress.missing.join('、')}`,
      ),
    )
  }
  if (lowConfidenceSegments.length) {
    checklist.push(
      ...lowConfidenceSegments.map(({ segment, index }) =>
        `- 第 ${index + 1} 段置信度低：${Math.round((segment.confidence ?? 0) * 100)}%｜${segment.title || segment.type}`,
      ),
    )
  }
  return [
    '## 人工校对清单',
    '',
    ...(checklist.length ? checklist : ['- 当前没有明显待补项，可继续逐段精修文字和节奏判断。']),
    '',
  ]
}

function renderScreenplayOutline(segment: Segment, index: number): string[] {
  return [
    `### ${String(index + 1).padStart(2, '0')}｜${secondsToTimecode(segment.startTime)} - ${secondsToTimecode(segment.endTime)}｜${segment.title || segment.type}`,
    '',
    `- 剧情线：${storyLineLabelForSegment(segment)}`,
    `- 段落作用：${segmentStructuralRole(segment)}`,
    ...renderSharedModuleExport(segment),
    `- 剧本还原：${inlineText(segment.screenplayDraft)}`,
    `- 小节密度：${formatBlockStats(segment)}`,
    `- 观众体验：${inlineText(segment.audienceExperience)}`,
    '',
  ]
}

function renderStoryStructure(segments: Segment[], subtitles: Subtitle[]): string[] {
  const structure = buildStoryStructure(segments, subtitles)
  if (!structure.length) return []
  return [
    '## 结构树 / 剧情线',
    '',
    ...structure.flatMap((line) => [
      `### ${line.label}`,
      '',
      line.description,
      '',
      ...line.children.flatMap((branch) => [
        `#### ${branch.label}`,
        '',
        ...branch.segments.flatMap((segment) => [
          `- ${secondsToTimecode(segment.startTime)} - ${secondsToTimecode(segment.endTime)}｜${segment.title || segment.type}`,
          `  - 故事：${segmentStorySummary(segment, subtitles)}`,
          `  - 作用：${segmentStructuralRole(segment)}`,
        ]),
        '',
      ]),
    ]),
  ]
}

function renderSharedModuleExport(segment: Segment): string[] {
  const block = normalizeTimelineBlock(segment, segment.primaryLine || 'main')
  if (!block.isShared && block.importance === 'normal' && !block.structureRole) return []
  return [
    `- 主归属线：${formatTimelineLine(block.primaryLine)}`,
    `- 复用线索：${block.sharedLines.map(formatTimelineLine).join(' / ')}`,
    `- 重要性：${formatImportance(block.importance)}`,
    block.structureRole ? `- 结构作用：${block.structureRole}` : '',
  ].filter(Boolean)
}

function renderShotRhythmMarkdown(project: Project, segments: Segment[]): string[] {
  const detection = project.shotDetection
  if (!detection?.cuts.length) return []
  const duration = Math.max(project.duration, detection.cuts[detection.cuts.length - 1] ?? 0)
  const stats = getShotStats(detection.cuts, duration)
  if (!stats) return []
  const density = getCutDensity(detection.cuts, duration, 60)
  const fastest = density.length ? density.reduce((best, bucket) => (bucket.cutCount > best.cutCount ? bucket : best), density[0]) : null
  const lines = [
    '## 镜头节奏统计（自动检测）',
    '',
    '> 工具静音快速播放整片、按画面差分自动检测硬切得出。溶解等渐变转场不计入，数值当量级参考。',
    '',
    `- 镜头总数：约 ${stats.shotCount} 个`,
    `- 平均镜头长（ASL）：${formatShotSeconds(stats.averageShotSeconds)}`,
    `- 中位镜头长：${formatShotSeconds(stats.medianShotSeconds)}`,
    `- 最长镜头：${formatShotSeconds(stats.maxShotSeconds)}`,
    fastest && fastest.cutCount ? `- 剪辑最快的一分钟：${secondsToTimecode(fastest.startTime)} 起，切换 ${fastest.cutCount} 次` : '',
    '',
  ]
  const segmentRows = segments
    .map((segment) => ({ segment, stats: getShotStats(detection.cuts, Math.max(duration, segment.endTime), segment.startTime, segment.endTime) }))
    .filter((row) => row.stats)
  if (segmentRows.length) {
    lines.push('| 段落 | 时间范围 | 镜头数 | 平均镜头长 |', '|---|---|---:|---:|')
    for (const row of segmentRows) {
      lines.push(
        `| ${escapeCell(row.segment.title || row.segment.type)} | ${secondsToTimecode(row.segment.startTime)} - ${secondsToTimecode(row.segment.endTime)} | ${row.stats!.shotCount} | ${formatShotSeconds(row.stats!.averageShotSeconds)} |`,
      )
    }
    lines.push('')
  }
  return lines
}

function renderAudienceCurveMarkdown(project: Project): string[] {
  const points = [...(project.audienceCurvePoints ?? [])].sort((a, b) => a.time - b.time)
  if (!points.length) return []
  return [
    '## 观众体验曲线',
    '',
    ...points.flatMap((point, index) => [
      `### ${secondsToTimecode(point.time)} ${point.title}`,
      `- 观众体验：${audienceEmotionLabels[point.emotionType]}`,
      `- 节奏作用：${formatAudienceRhythmRole(point)}`,
      `- 投入强度：${point.intensity} / 100`,
      point.valence !== undefined ? `- 情绪方向：${point.valence}` : '',
      `- 较上一个节点变化：${formatAudienceDelta(points, index)}`,
      `- 重要性：${audienceImportanceLabels[point.importance ?? 'normal']}`,
      `- 关联段落：${relatedAudienceBlockTitles(point.relatedBlockIds, project.segments).join('、') || '无'}`,
      point.description ? `- 说明：${point.description}` : '',
      '',
    ]),
  ]
}

function renderAudienceCurveText(project: Project): string[] {
  const points = [...(project.audienceCurvePoints ?? [])].sort((a, b) => a.time - b.time)
  if (!points.length) return []
  return [
    '',
    '【观众体验曲线】',
    '',
    ...points.flatMap((point, index) => [
      `${secondsToTimecode(point.time)} ${point.title}`,
      `观众体验：${audienceEmotionLabels[point.emotionType]}`,
      `节奏作用：${formatAudienceRhythmRole(point)}`,
      `投入强度：${point.intensity}/100`,
      point.valence !== undefined ? `情绪方向：${point.valence}` : '',
      `较上一个节点变化：${formatAudienceDelta(points, index)}`,
      `重要性：${audienceImportanceLabels[point.importance ?? 'normal']}`,
      `关联段落：${relatedAudienceBlockTitles(point.relatedBlockIds, project.segments).join('、') || '无'}`,
      point.description ? `说明：${point.description}` : '',
      '',
    ]),
  ]
}

function formatAudienceRhythmRole(point: NonNullable<Project['audienceCurvePoints']>[number]): string {
  const role = point.rhythmRole
  if (role && role in audienceRhythmRoleLabels) return audienceRhythmRoleLabels[role]
  if (point.importance === 'peak') return audienceRhythmRoleLabels.peak
  if (point.importance === 'low') return audienceRhythmRoleLabels.low
  return '未标注'
}

function formatAudienceDelta(points: NonNullable<Project['audienceCurvePoints']>, index: number): string {
  if (index === 0) return '开场基准点'
  const delta = points[index].intensity - points[index - 1].intensity
  const prefix = delta > 0 ? '+' : ''
  if (delta >= 15) return `${prefix}${delta}，明显抬升`
  if (delta <= -15) return `${delta}，明显回落`
  return `${prefix}${delta}，基本持平`
}
function relatedAudienceBlockTitles(ids: string[] | undefined, segments: Segment[]): string[] {
  const idSet = new Set(ids ?? [])
  return segments.filter((segment) => idSet.has(segment.id)).map((segment) => segment.title || segment.type)
}

function formatTimelineLine(lineId: string): string {
  return timelineLineLabels[lineId] ?? lineId
}

function formatImportance(importance: Segment['importance']): string {
  if (importance === 'pivot') return '结构枢纽'
  if (importance === 'key') return '关键复用'
  return '普通'
}

function renderScreenplayBody(segment: Segment, index: number): string[] {
  const blocks = segment.screenplayBlocks?.filter((block) => block.text.trim()) ?? []
  return [
    `### ${String(index + 1).padStart(2, '0')}｜${segment.title || segment.type}`,
    '',
    `> ${secondsToTimecode(segment.startTime)} - ${secondsToTimecode(segment.endTime)}｜${segment.type}`,
    '',
    ...(blocks.length
      ? blocks.flatMap((block) => renderScreenplayBlock(block))
      : [
          textOrBlank(segment.screenplayDraft),
          '',
        ]),
  ]
}

function renderSegment(frames: Frame[], subtitles: Subtitle[], segment: Segment): string[] {
  const representative = pickRepresentativeFrames(frames, segment)
  const segmentSubtitles = pickSegmentSubtitles(subtitles, segment)
  const progress = getSegmentProgress(segment)
  const blockStats = getSegmentBlockStats(segment)
  return [
    `### ${secondsToTimecode(segment.startTime)} - ${secondsToTimecode(segment.endTime)}｜${segment.type}｜${segment.title || '未命名段落'}`,
    '',
    `- 时长：${formatDuration(segment)}`,
    `- 叙事顺序：${segment.narrativeOrder ?? '顺叙'}`,
    ...renderSharedModuleExport(segment),
    `- 完成度：${progress.percent}%（${progress.completed}/${progress.total}）`,
    `- 待补字段：${progress.missing.length ? progress.missing.join('、') : '无'}`,
    `- 置信度：${typeof segment.confidence === 'number' ? `${Math.round(segment.confidence * 100)}%` : '待确认'}`,
    `- 小节密度：${formatBlockStats(segment, blockStats)}`,
    '',
    '#### 代表帧',
    ...(representative.length
      ? representative.flatMap((frame) => renderFrameReference(frame))
      : ['（待补充）']),
    '',
    '#### 段落字幕',
    ...(segmentSubtitles.length
      ? segmentSubtitles.map((subtitle) => `- ${secondsToTimecode(subtitle.startTime)} ${subtitle.text.replace(/\s+/g, ' ')}`)
      : ['（无匹配字幕）']),
    '',
    '#### 段落功能',
    textOrBlank(segment.segmentFunction),
    '',
    '#### 关键节拍',
    textOrBlank(segment.keyBeats),
    '',
    '#### 剧情文本 / 剧本还原',
    textOrBlank(segment.screenplayDraft),
    '',
    '#### 剧本小节',
    ...(segment.screenplayBlocks?.length
      ? segment.screenplayBlocks.map((block) => `- ${block.time !== undefined ? `${secondsToTimecode(block.time)}｜` : ''}${block.type}：${block.text.replace(/\s+/g, ' ')}`)
      : ['（待补充）']),
    '',
    '#### 创作意图',
    textOrBlank(segment.creativeIntent),
    '',
    '#### 信息控制',
    textOrBlank(segment.informationControl),
    '',
    '#### 节奏设计',
    textOrBlank(segment.rhythmDesign),
    '',
    '#### 手法',
    textOrBlank(segment.techniques),
    '',
    '#### 观众体验',
    textOrBlank(segment.audienceExperience),
    '',
    '#### 可复用写法',
    textOrBlank(segment.reusableMethod),
    '',
    '#### 备注',
    textOrBlank(segment.notes),
    '',
  ].filter(Boolean)
}

function renderScreenplayBlock(block: NonNullable<Segment['screenplayBlocks']>[number]): string[] {
  const time = block.time !== undefined ? ` ${secondsToTimecode(block.time)}` : ''
  const text = block.text.replace(/\s+/g, ' ').trim()
  if (block.type === '场景') return [`**${text}**`, '']
  if (block.type === '对白' || block.type === '旁白/字幕' || block.type === '手语/字幕') return [`${block.type}${time}：${text}`, '']
  if (block.type === '备注') return [`（${text}）`, '']
  return [`${time ? `${time} ` : ''}${text}`, '']
}

function pickSegmentSubtitles(subtitles: Subtitle[], segment: Segment): Subtitle[] {
  return subtitles.filter((subtitle) => subtitle.startTime <= segment.endTime && subtitle.endTime >= segment.startTime)
}

const screenplayBlockTypes: ScreenplayBlockType[] = ['场景', '动作', '对白', '旁白/字幕', '手语/字幕', '备注']

interface ScreenplayBlockStats {
  total: number
  byType: Record<ScreenplayBlockType, number>
}

function renderScreenplayRhythmSummary(segments: Segment[]): string[] {
  const stats = getScreenplayBlockStats(segments)
  return [
    '## 剧本节奏密度',
    '',
    `- 剧本小节总数：${stats.total}`,
    `- 类型分布：${screenplayBlockTypes.map((type) => `${type} ${formatCountPercent(stats.byType[type], stats.total)}`).join('｜')}`,
    `- 对白/动作比例：${formatDialogueActionRatio(stats)}`,
    '',
    '| 时间范围 | 标题 | 小节 | 场景 | 动作 | 对白/手语 | 备注 | 主要密度 | 节奏标签 |',
    '|---|---|---:|---:|---:|---:|---:|---|---|',
    ...segments.map((segment) => {
      const segmentStats = getSegmentBlockStats(segment)
      const dialogueLike = segmentStats.byType['对白'] + segmentStats.byType['手语/字幕']
      return `| ${secondsToTimecode(segment.startTime)} - ${secondsToTimecode(segment.endTime)} | ${escapeCell(segment.title || segment.type)} | ${segmentStats.total} | ${segmentStats.byType['场景']} | ${segmentStats.byType['动作']} | ${dialogueLike} | ${segmentStats.byType['备注']} | ${dominantBlockType(segmentStats)} | ${rhythmLabel(segmentStats)} |`
    }),
    '',
  ]
}

function getScreenplayBlockStats(segments: Segment[]): ScreenplayBlockStats {
  return segments.reduce((stats, segment) => {
    const segmentStats = getSegmentBlockStats(segment)
    screenplayBlockTypes.forEach((type) => {
      stats.byType[type] += segmentStats.byType[type]
    })
    stats.total += segmentStats.total
    return stats
  }, createEmptyBlockStats())
}

function getSegmentBlockStats(segment: Segment): ScreenplayBlockStats {
  return (segment.screenplayBlocks ?? []).reduce((stats, block) => {
    stats.byType[block.type] += 1
    stats.total += 1
    return stats
  }, createEmptyBlockStats())
}

function createEmptyBlockStats(): ScreenplayBlockStats {
  return {
    total: 0,
    byType: {
      场景: 0,
      动作: 0,
      对白: 0,
      '旁白/字幕': 0,
      '手语/字幕': 0,
      备注: 0,
    },
  }
}

function formatBlockStats(segment: Segment, stats = getSegmentBlockStats(segment)): string {
  if (!stats.total) return '待补充'
  const dialogueLike = stats.byType['对白'] + stats.byType['手语/字幕']
  return `场景 ${stats.byType['场景']}｜动作 ${stats.byType['动作']}｜对白/手语 ${dialogueLike}｜备注 ${stats.byType['备注']}｜主要：${dominantBlockType(stats)}｜节奏：${rhythmLabel(stats)}`
}

function formatCountPercent(count: number, total: number): string {
  if (!total) return '0'
  return `${count}（${Math.round((count / total) * 100)}%）`
}

function formatDialogueActionRatio(stats: ScreenplayBlockStats): string {
  const dialogueLike = stats.byType['对白'] + stats.byType['手语/字幕']
  const actionLike = stats.byType['动作']
  if (!dialogueLike && !actionLike) return '待补充'
  if (!actionLike) return `${dialogueLike}:0（对白/手语主导）`
  return `${dialogueLike}:${actionLike}`
}

function dominantBlockType(stats: ScreenplayBlockStats): string {
  if (!stats.total) return '待补充'
  const [type, count] = screenplayBlockTypes
    .map((type) => [type, stats.byType[type]] as const)
    .sort((left, right) => right[1] - left[1])[0]
  if (!count) return '待补充'
  return type
}

function rhythmLabel(stats: ScreenplayBlockStats): string {
  if (!stats.total) return '待补小节'
  const dialogueLike = stats.byType['对白'] + stats.byType['手语/字幕']
  const actionCount = stats.byType['动作']
  if (stats.byType['备注'] / stats.total >= 0.45) return '待核对较多'
  if (stats.byType['场景'] / stats.total >= 0.35) return '场景转换密集'
  if (dialogueLike >= actionCount * 1.5 && dialogueLike / stats.total >= 0.35) return '对白主导'
  if (actionCount >= dialogueLike * 1.5 && actionCount / stats.total >= 0.35) return '动作主导'
  return '均衡推进'
}

function pickRepresentativeFrames(frames: Frame[], segment: Segment): Frame[] {
  if (!frames.length) return []
  const targets = [segment.startTime, (segment.startTime + segment.endTime) / 2, segment.endTime]
  return targets
    .map((target) =>
      frames.reduce((nearest, frame) =>
        Math.abs(frame.time - target) < Math.abs(nearest.time - target) ? frame : nearest,
      ),
    )
    .filter((frame, index, list) => list.findIndex((item) => item.id === frame.id) === index)
}

function formatDuration(segment: Segment): string {
  return secondsToTimecode(Math.max(0, segment.endTime - segment.startTime))
}

function textOrBlank(value?: string): string {
  return value?.trim() || '（待补充）'
}

function inlineText(value?: string): string {
  return value?.trim().replace(/\s+/g, ' ') || '待补充'
}

function escapeCell(value?: string): string {
  return (value?.trim() || '').replace(/\|/g, '/').replace(/\n/g, '<br />')
}


function renderFrameReference(frame: Frame): string[] {
  const filename = `frames/${frameFileName(frame)}`
  return [
    `- ${secondsToTimecode(frame.time)}｜${filename}${frame.note ? `｜${frame.note}` : ''}`,
    `![${secondsToTimecode(frame.time)}](${filename})`,
  ]
}
