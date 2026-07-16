import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AudienceCurvePoint, Frame, MacroAnalysis, Segment, StoryLine, Subtitle } from '../types'
import { getDialogueDensity, maxDensity } from '../lib/dialogueDensity'
import { getMacroProgress } from '../lib/macroProgress'
import { getSegmentCoverage } from '../lib/segmentCoverage'
import { getSegmentProgress } from '../lib/segmentProgress'
import { AUDIENCE_LINE_ID, lineColor, normalizeLineId } from '../lib/storyLines'
import { buildStoryStructure, segmentStorySummary, segmentStructuralRole } from '../lib/storyStructure'
import { secondsToTimecode } from '../lib/timecode'
import type { ExtractProgress } from '../lib/videoFrames'

type ExtractPhase = 'idle' | 'transcode' | 'subtitle' | 'metadata' | 'frames' | 'cache' | 'done' | 'canceled' | 'error'

type StoryCard = {
  id: string
  time: string
  endTime?: string
  startTime: number
  endTimeSeconds: number
  title: string
  event: string
  primaryLane: string
  function: string
  pressure?: string
  conflict?: string
  audienceEmotion?: string
  informationEffect?: string
  tags: string[]
  relatedLaneIds: string[]
  importance: 1 | 2 | 3 | 4 | 5
  isKeyTurn?: boolean
  isClimax?: boolean
  isSetup?: boolean
  isPayoff?: boolean
  source?: string
  note?: string
  segment: Segment
}

type StoryCardReference = {
  id: string
  sourceCardId: string
  laneId: string
  time: string
  startTime: number
  title: string
  referenceReason: string
}

type StructureBand = {
  start: string
  end: string
  title: string
  function: string
}

interface FrameTimelineProps {
  hasVideo: boolean
  duration: number
  frames: Frame[]
  storyLines: StoryLine[]
  macroAnalysis?: MacroAnalysis
  audienceCurvePoints?: AudienceCurvePoint[]
  extractProgress: ExtractProgress | null
  extractError?: string
  extractPhase?: ExtractPhase
  analysisInProgress: boolean
  onCancelExtract?: () => void
  segments: Segment[]
  subtitles: Subtitle[]
  selectedFrameId?: string
  selectedSegmentId?: string
  selectedRange: { start: number; end: number } | null
  onCreateSegmentFromRange: () => void
  onClearRange: () => void
  onGapSelect: (startTime: number, endTime: number) => void
  onFrameClick: (frame: Frame, shiftKey: boolean) => void
  onSegmentClick: (segmentId: string) => void
  onSeekTo?: (time: number, stopAt?: number) => void
  onDropVideo?: (file: File, handle?: FileSystemFileHandle) => void
  onResumeExtract?: () => void
}

// 拖放的 DataTransferItem 拿文件句柄(Chromium 86+),旧浏览器没有这个方法
type DataTransferItemWithHandle = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
}

export function FrameTimeline(props: FrameTimelineProps) {
  // 拖入影片的悬停高亮:进出子元素会连发 enter/leave,用计数器防闪烁
  const [isDragOver, setIsDragOver] = useState(false)
  const dragDepthRef = useRef(0)
  const timelineDuration = Math.max(
    ...props.frames.map((frame) => frame.time),
    ...props.segments.map((segment) => segment.endTime),
    ...props.subtitles.map((subtitle) => subtitle.endTime),
    props.duration,
    1,
  )
  const sortedSegments = [...props.segments].sort((a, b) => a.startTime - b.startTime)
  const storyStructure = buildStoryStructure(sortedSegments, props.subtitles)
  const selectedFrame = props.frames.find((frame) => frame.id === props.selectedFrameId)
  const selectedSegment = props.segments.find((segment) => segment.id === props.selectedSegmentId)
  const selectedRangeText = props.selectedRange
    ? `${secondsToTimecode(props.frames[props.selectedRange.start].time)} - ${secondsToTimecode(props.frames[props.selectedRange.end].time)}`
    : ''
  const selectedRangeHasDuration = props.selectedRange
    ? props.frames[props.selectedRange.start].id !== props.frames[props.selectedRange.end].id
    : false
  const selectedRangeDurationText =
    props.selectedRange && selectedRangeHasDuration
      ? secondsToTimecode(Math.abs(props.frames[props.selectedRange.end].time - props.frames[props.selectedRange.start].time))
      : ''
  const coverage = getSegmentCoverage(sortedSegments, timelineDuration)
  const macroProgress = getMacroProgress(props.macroAnalysis)
  const segmentProgressList = sortedSegments.map(getSegmentProgress)
  const averageSegmentProgress = segmentProgressList.length
    ? Math.round(segmentProgressList.reduce((sum, progress) => sum + progress.percent, 0) / segmentProgressList.length)
    : 0
  const overallAnalysisProgress = sortedSegments.length
    ? Math.round((macroProgress.percent + averageSegmentProgress) / 2)
    : macroProgress.percent
  const unfinishedSegments = segmentProgressList.filter((progress) => progress.percent < 100).length
  const timelineStatsText = `片长 ${secondsToTimecode(timelineDuration)}｜时间点 ${props.frames.length}｜段落 ${props.segments.length}｜覆盖 ${coverage.percent}%｜文本完成度 ${overallAnalysisProgress}%`
  const hasContextStatus = Boolean(
    macroProgress.percent < 100 ||
    unfinishedSegments ||
    coverage.gaps.length ||
    selectedSegment ||
    selectedFrame ||
    selectedRangeText,
  )
  const extractPercent = props.extractProgress?.total
    ? Math.min(100, Math.round((props.extractProgress.current / props.extractProgress.total) * 100))
    : 0
  const extractIsCanceled = props.extractPhase === 'canceled'
  const extractIsFailed = Boolean(props.extractError) || props.extractPhase === 'error'
  const extractIsActive = Boolean(
    props.hasVideo &&
      !extractIsCanceled &&
      !extractIsFailed &&
      ['transcode', 'subtitle', 'metadata', 'frames', 'cache'].includes(props.extractPhase ?? 'idle'),
  )
  // 有影片名、没有帧、也没有任务在跑:典型场景是抽帧中途刷新了页面,
  // 项目从自动保存恢复但任务不会自动续跑,必须明说,不能假装"正在生成"
  const extractIsStalled = Boolean(props.hasVideo && !extractIsCanceled && !extractIsFailed && !extractIsActive)
  const emptyGuideTitle = !props.hasVideo
    ? '请先导入电影'
    : extractIsCanceled
      ? '已取消生成时间轴'
      : extractIsFailed
        ? '生成时间轴失败'
        : extractIsStalled
          ? '项目已恢复，但时间轴还没生成'
          : '已导入电影，正在生成时间轴'
  const isTranscoding = props.extractPhase === 'transcode'
  const extractProgressText = isTranscoding
    ? `本地转码中｜${extractPercent}%`
    : props.extractProgress?.total
      ? `${extractPercent}%｜${props.extractProgress.current}/${props.extractProgress.total} 帧`
      : extractIsCanceled
        ? '已取消'
        : props.extractError
        ? '读取失败'
        : extractPhaseLabel(props.extractPhase)
  const extractDetailText = isTranscoding
    ? extractPhaseDetail('transcode')
    : props.extractProgress?.total
      ? `当前时间点 ${secondsToTimecode(props.extractProgress.time)}，正在按 1 秒提取截图。`
      : extractIsCanceled
        ? '任务已取消，没有继续读取影片或生成时间轴。'
        : props.extractError || extractPhaseDetail(props.extractPhase)

  function handleDragEnter(event: React.DragEvent) {
    if (!props.onDropVideo || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragOver(true)
  }

  function handleDragOver(event: React.DragEvent) {
    if (!props.onDropVideo || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleDragLeave(event: React.DragEvent) {
    if (!props.onDropVideo) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragOver(false)
  }

  function handleDrop(event: React.DragEvent) {
    if (!props.onDropVideo) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    const onDropVideo = props.onDropVideo
    // 句柄要在 drop 事件里同步取,拿到了刷新后就能一键接回影片
    const item = event.dataTransfer.items?.[0] as DataTransferItemWithHandle | undefined
    const handlePromise = item?.getAsFileSystemHandle?.() ?? Promise.resolve(null)
    handlePromise
      .then((handle) => onDropVideo(file, handle?.kind === 'file' ? (handle as FileSystemFileHandle) : undefined))
      .catch(() => onDropVideo(file, undefined))
  }

  return (
    <section className="timeline-panel">
      {props.frames.length === 0 ? (
        <div
          className={`empty-guide ${isDragOver ? 'drag-over' : ''}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <strong>{isDragOver ? '松手导入这部影片' : emptyGuideTitle}</strong>
          {props.hasVideo && extractIsStalled ? (
            <div className="extract-stalled">
              <span>
                上次的抽帧没有完成，常见原因是中途刷新或关闭了页面，任务不会自动续跑。
                点下面的按钮继续：会先接回影片文件（必要时让你重新选一次），然后重新抽帧。
                也可以直接拖一部新影片进来换电影。
              </span>
              {props.onResumeExtract ? (
                <button type="button" onClick={props.onResumeExtract}>继续生成时间轴</button>
              ) : null}
            </div>
          ) : null}
          {props.hasVideo && !extractIsStalled ? (
            <div className={`extract-progress ${extractIsFailed ? 'has-error' : ''} ${extractIsCanceled ? 'is-canceled' : ''}`}>
              <div className="extract-progress-header">
                <b>{extractProgressText}</b>
                {props.onCancelExtract && extractIsActive ? <button onClick={props.onCancelExtract}>取消任务</button> : null}
              </div>
              <progress value={props.extractProgress?.current ?? 0} max={props.extractProgress?.total || 1} />
              <span>{extractDetailText}</span>
              <small>
                {extractIsCanceled
                  ? '可以重新导入影片，或换用浏览器兼容版 MP4 再试。'
                  : extractIsFailed
                    ? '建议换成 H.264/AAC 编码的 MP4，或先用转码工具转换后重新导入。'
                    : '完成后会显示电影时间轴，并可生成 AI 分析包。'}
              </small>
            </div>
          ) : null}
          {!props.hasVideo ? (
            <span>
              把影片文件直接拖进这个虚线框，或按上方流程点「导入电影」。之后转码、抽帧、字幕和 AI 分析包都会自动完成。
            </span>
          ) : null}
        </div>
      ) : (
        <div className="story-map">
          {props.analysisInProgress ? (
            <div className="analysis-progress-banner">
              <div>
                <strong>正在准备 AI 分析素材</strong>
                <span>系统正在提取截图并缓存素材，不会自动生成剧情理解。</span>
              </div>
              {props.onCancelExtract ? <button onClick={props.onCancelExtract}>取消任务</button> : null}
            </div>
          ) : null}

          <div className="story-map-header">
            <div>
              <strong>{props.segments.length ? '文字剧本时间轴' : '电影时间轴'}</strong>
              <span>{timelineStatsText}｜字幕 {props.subtitles.length}</span>
            </div>
            <b>点击段落编辑</b>
          </div>

          {hasContextStatus ? (
            <div className="timeline-context">
              {macroProgress.percent < 100 ? <span className="context-warn">全片分析待补</span> : null}
              {unfinishedSegments ? <span className="context-warn">待补段落 {unfinishedSegments}</span> : null}
              {coverage.gaps.length ? <span className="context-warn">缺口 {coverage.gaps.length}</span> : null}
              {selectedSegment ? <strong>当前段落：{selectedSegment.type} · {selectedSegment.title}</strong> : null}
              {selectedFrame ? <strong>当前时间点：{secondsToTimecode(selectedFrame.time)}</strong> : null}
              {selectedRangeText ? <strong>选择范围：{selectedRangeText}</strong> : null}
            </div>
          ) : null}

          {props.selectedRange ? (
            <div className="range-actions">
              <div>
                <strong>{selectedRangeHasDuration ? '已选择段落范围' : '已选择段落起点'}</strong>
                <span>{selectedRangeDurationText ? `${selectedRangeText}｜时长 ${selectedRangeDurationText}` : selectedRangeText}</span>
              </div>
              <button disabled={!selectedRangeHasDuration} onClick={props.onCreateSegmentFromRange}>
                {selectedRangeHasDuration ? '创建段落' : '等待终点'}
              </button>
              <button onClick={props.onClearRange}>清除选择</button>
            </div>
          ) : null}

          <TimelineSwimlane
            segments={sortedSegments}
            subtitles={props.subtitles}
            storyLines={props.storyLines}
            audienceCurvePoints={props.audienceCurvePoints ?? []}
            duration={timelineDuration}
            selectedSegmentId={props.selectedSegmentId}
            gaps={coverage.gaps}
            onGapSelect={props.onGapSelect}
            onSegmentClick={props.onSegmentClick}
            onSeekTo={props.onSeekTo}
          />

          {sortedSegments.length ? (
            <section className="segment-flow" aria-label="剧情拆解文本">
              <div className="segment-flow-header">
                <strong>结构树</strong>
                <div>
                  <span>
                    {unfinishedSegments
                      ? `段落平均完成度 ${averageSegmentProgress}%，还有 ${unfinishedSegments} 段待补`
                      : `段落平均完成度 ${averageSegmentProgress}%，可导出文字剧本`}
                  </span>
                </div>
              </div>
              <div className="screenplay-rhythm-map" aria-label="剧本小节节奏概览">
                {sortedSegments.map((segment) => (
                  <button
                    key={segment.id}
                    className={props.selectedSegmentId === segment.id ? 'selected' : ''}
                    style={{ width: `${Math.max(5, ((segment.endTime - segment.startTime) / timelineDuration) * 100)}%` }}
                    title={`${secondsToTimecode(segment.startTime)} - ${secondsToTimecode(segment.endTime)}｜${formatBlockStats(segment)}`}
                    onClick={() => props.onSegmentClick(segment.id)}
                  >
                    {blockDensity(segment).map((part) => (
                      <span
                        key={part.type}
                        className={`density-${part.type.replace('/', '-')}`}
                        style={{ width: `${part.percent}%` }}
                      />
                    ))}
                  </button>
                ))}
              </div>
              <section className="structure-tree" aria-label="结构树">
                <div className="structure-tree-header">
                  <strong>结构树</strong>
                  <span>按剧情线梳理段落作用，适合检查双线、多线和节奏功能。</span>
                </div>
                <div className="structure-tree-list">
                  {storyStructure.map((line) => (
                    <article key={line.id} className="structure-line">
                      <div className="structure-line-title">
                        <strong>{line.label}</strong>
                        <span>{line.description}</span>
                      </div>
                      <div className="structure-branches">
                        {line.children.map((branch) => (
                          <div key={branch.id} className="structure-branch">
                            <div className="structure-branch-title">
                              <b>{branch.label}</b>
                              <span>{branch.segments.length} 段</span>
                            </div>
                            <div className="structure-segments">
                              {branch.segments.map((segment) => (
                                <button
                                  key={segment.id}
                                  type="button"
                                  className={props.selectedSegmentId === segment.id ? 'selected' : ''}
                                  onClick={() => props.onSegmentClick(segment.id)}
                                >
                                  <span className="structure-segment-text">
                                    <time>{secondsToTimecode(segment.startTime)}</time>
                                    <strong>{segment.title || segment.type}</strong>
                                    <span className="structure-segment-story">
                                      <b>故事</b>
                                      <span>{segmentStorySummary(segment, props.subtitles)}</span>
                                    </span>
                                    <span className="structure-segment-role">
                                      <b>作用</b>
                                      <span>{segmentStructuralRole(segment)}</span>
                                    </span>
                                  </span>
                                  <span className="structure-segment-frames">
                                    {pickRepresentativeFrames(props.frames, segment, sortedSegments[0]?.id === segment.id).map((frame, index) => (
                                      <span key={`${segment.id}-${frame.id}-${index}`} className="structure-segment-frame">
                                        {frame.src ? <img src={frame.src} alt={secondsToTimecode(frame.time)} /> : null}
                                        <time>{secondsToTimecode(frame.time)}</time>
                                      </span>
                                    ))}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </section>
          ) : null}

          <div className="timeline-caption">
            <span>时间线是当前核心：剧情文本、字幕与时间点统一展示。</span>
            <span>点击段落，在右侧查看/编辑剧情文本与结构节奏分析。</span>
          </div>
        </div>
      )}
    </section>
  )
}

function TimelineSwimlane({
  segments,
  subtitles,
  storyLines,
  audienceCurvePoints,
  duration,
  selectedSegmentId,
  gaps,
  onGapSelect,
  onSegmentClick,
  onSeekTo,
}: {
  segments: Segment[]
  subtitles: Subtitle[]
  storyLines: StoryLine[]
  audienceCurvePoints: AudienceCurvePoint[]
  duration: number
  selectedSegmentId?: string
  gaps: Array<{ startTime: number; endTime: number }>
  onGapSelect: (startTime: number, endTime: number) => void
  onSegmentClick: (segmentId: string) => void
  onSeekTo?: (time: number, stopAt?: number) => void
}) {
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null)
  const [highlightedMainId, setHighlightedMainId] = useState<string | null>(null)
  const [highlightedReferenceSourceId, setHighlightedReferenceSourceId] = useState<string | null>(null)
  const mainCardRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const timelineDuration = Math.max(duration, 1)
  const ticks = createTimeTicks(timelineDuration)
  const cardHeight = 116
  const referenceHeight = 72
  const stackGap = 8
  const lanePadding = 8
  const stackStep = cardHeight + stackGap
  const cards = segments.map((segment) => normalizeStoryCard(segment, subtitles, storyLines))
  const visibleAudienceCurvePoints = audienceCurvePoints
  const structureBands = buildStructureBands(timelineDuration)
  const hoveredCard = hoveredBlockId ? cards.find((card) => card.id === hoveredBlockId) : undefined
  const highlightedLaneIds = hoveredCard ? [hoveredCard.primaryLane, ...hoveredCard.relatedLaneIds] : []
  const laneRows = storyLines.map((lane) => {
    if (lane.id === AUDIENCE_LINE_ID) {
      return {
        ...lane,
        stackedCards: [],
        stackedReferences: [],
        height: 320,
      }
    }

    const mainCards = cards.filter((card) => card.primaryLane === lane.id)
    const referenceCards = cards
      .filter((card) => card.primaryLane !== lane.id && card.relatedLaneIds.includes(lane.id))
      .map((card) => ({
        id: `${card.id}-${lane.id}-ref`,
        sourceCardId: card.id,
        laneId: lane.id,
        time: card.time,
        startTime: card.startTime,
        title: `引用：${card.title}`,
        referenceReason: getReferenceReason(lane),
      }))
    const stackedCards = stackStoryCards(mainCards, timelineDuration)
    const stackedReferences = stackReferenceCards(referenceCards, timelineDuration, stackedCards)
    const stackCount = Math.max(1, ...stackedCards.map((item) => item.stack + 1), ...stackedReferences.map((item) => item.stack + 1))
    return {
      ...lane,
      stackedCards,
      stackedReferences,
      height: lanePadding * 2 + stackCount * cardHeight + Math.max(0, stackCount - 1) * stackGap,
    }
  })
  const visibleLaneCount = storyLines.length

  function flashMainCard(cardId: string) {
    setHighlightedMainId(cardId)
    mainCardRefs.current[cardId]?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    window.setTimeout(() => setHighlightedMainId((current) => (current === cardId ? null : current)), 1500)
  }

  function flashReferences(cardId: string) {
    setHighlightedReferenceSourceId(cardId)
    window.setTimeout(() => setHighlightedReferenceSourceId((current) => (current === cardId ? null : current)), 1500)
  }

  return (
    <div className="swimlane-module">
      <div className="swimlane-legend" aria-label="多线复用图例">
        <span><b className="legend-normal" />饱和色：主卡片，只显示在主归属线</span>
        <span><b className="legend-reference" />浅色虚线：引用卡，点击定位主卡</span>
        <span><b className="legend-pivot" />加粗边框：关键转折 / 高潮</span>
        <span>复用 ×N：影响 N 条其它线索，点击高亮引用</span>
      </div>
    <div className="timeline-swimlane" style={{ '--visible-lanes': visibleLaneCount } as React.CSSProperties}>
      <div className="swimlane-left">
        <span className="swimlane-corner">时间</span>
        <span className="swimlane-label structure-band-label">
          <small>宏观结构</small>
          <b>结构段落带</b>
        </span>
        {laneRows.map((lane) => (
          <span
            key={lane.id}
            className={`swimlane-label ${highlightedLaneIds.includes(lane.id) ? 'shared-highlight' : ''}`}
            style={{ height: `${lane.height}px` }}
            title={[lane.subtitle, lane.description].filter(Boolean).join('｜')}
          >
            {lane.subtitle ? <small>{lane.subtitle}</small> : null}
            <b>{lane.title}</b>
          </span>
        ))}
      </div>
      <div className="swimlane-scroll">
        <div className="swimlane-canvas">
          <div className="swimlane-ticks" aria-label="时间刻度">
            {ticks.map((tick) => (
              <span key={tick} style={{ left: `${(tick / timelineDuration) * 100}%` }}>
                {formatTickTime(tick)}
              </span>
            ))}
          </div>
          <div className="structure-band-row" aria-label="结构段落带">
            {structureBands.map((band) => {
              const start = timecodeToSeconds(band.start)
              const end = timecodeToSeconds(band.end)
              const left = (start / timelineDuration) * 100
              const width = Math.max(2, ((end - start) / timelineDuration) * 100)
              return (
                <span
                  key={`${band.start}-${band.title}`}
                  className="structure-band-item"
                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                  title={`${band.title}｜${band.function}`}
                >
                  {band.title}
                </span>
              )
            })}
          </div>
          <div className="swimlane-body">
            {segments.length
              ? gaps.map((gap) => {
                  const left = (gap.startTime / timelineDuration) * 100
                  const width = ((gap.endTime - gap.startTime) / timelineDuration) * 100
                  return (
                    <button
                      key={`${gap.startTime}-${gap.endTime}`}
                      className="timeline-gap swimlane-gap"
                      style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                      onClick={() => onGapSelect(gap.startTime, gap.endTime)}
                      title={`待补时间段：${secondsToTimecode(gap.startTime)} - ${secondsToTimecode(gap.endTime)}`}
                    />
                  )
                })
              : null}
            {laneRows.map((lane) => {
              return (
              <div
                key={lane.id}
                className={`swimlane-row ${highlightedLaneIds.includes(lane.id) ? 'shared-highlight' : ''}`}
                style={{ height: `${lane.height}px` }}
              >
                {lane.id === AUDIENCE_LINE_ID ? (
                  <EmotionCurveLane
                    points={visibleAudienceCurvePoints}
                    cards={cards}
                    subtitles={subtitles}
                    duration={timelineDuration}
                    hoveredPointId={hoveredPointId}
                    onHoverPoint={setHoveredPointId}
                    onPointClick={(point) => {
                      const targetId = point.relatedBlockIds?.[0]
                      if (targetId) {
                        onSegmentClick(targetId)
                        flashMainCard(targetId)
                      }
                    }}
                  />
                ) : null}
                {lane.stackedCards.map(({ card, stack }) => {
                  const left = (card.startTime / timelineDuration) * 100
                  const width = Math.max(5, ((card.endTimeSeconds - card.startTime) / timelineDuration) * 100)
                  const isHighlighted = highlightedMainId === card.id || hoveredBlockId === card.id || selectedSegmentId === card.id
                  return (
                    <button
                      key={card.id}
                      ref={(element) => {
                        mainCardRefs.current[card.id] = element
                      }}
                      className={`timeline-segment swimlane-segment story-main-card importance-${card.importance} ${card.isKeyTurn ? 'is-key-turn' : ''} ${card.isClimax ? 'is-climax' : ''} ${card.isSetup ? 'is-setup' : ''} ${card.isPayoff ? 'is-payoff' : ''} ${isHighlighted ? 'same-block-highlighted selected' : ''}`}
                      style={{
                        left: `${left}%`,
                        width: `${Math.min(width, 100 - left)}%`,
                        top: `${lanePadding + stack * stackStep}px`,
                        background: lineColor(card.primaryLane, storyLines).main,
                      }}
                      onClick={() => onSegmentClick(card.id)}
                      onDoubleClick={() => onSeekTo?.(card.startTime, card.endTimeSeconds)}
                      onMouseOver={() => setHoveredBlockId(card.id)}
                      onMouseLeave={() => setHoveredBlockId(null)}
                      title={[
                        card.title,
                        `${card.time} - ${card.endTime}`,
                        `主功能：${card.function}`,
                        card.pressure ? `压力：${card.pressure}` : '',
                        card.conflict ? `冲突：${card.conflict}` : '',
                        card.audienceEmotion ? `观众体验：${card.audienceEmotion}` : '',
                        card.informationEffect ? `信息效果：${card.informationEffect}` : '',
                        card.tags.length ? `标签：${card.tags.join(' / ')}` : '',
                        card.relatedLaneIds.length ? `关联线：${card.relatedLaneIds.map((id) => lineLabel(id, storyLines)).join(' / ')}` : '',
                      ].filter(Boolean).join('｜')}
                    >
                      <strong>{card.title}</strong>
                      <time>{card.time} - {card.endTime}</time>
                      <span>主功能：{card.function}</span>
                      {card.pressure || card.conflict ? <small>压力：{card.pressure || card.conflict}</small> : null}
                      {card.audienceEmotion ? <small>观众：{card.audienceEmotion}</small> : null}
                      <span className="story-tags">
                        {card.isSetup ? <b>铺垫</b> : null}
                        {card.isKeyTurn ? <b>转折</b> : null}
                        {card.isClimax ? <b>高潮</b> : null}
                        {card.isPayoff ? <b>回收</b> : null}
                        {card.tags.slice(0, 2).map((tag) => <b key={tag}>{tag}</b>)}
                      </span>
                      {card.relatedLaneIds.length ? (
                        <em
                          className="reuse-badge"
                          title={`复用 ×${card.relatedLaneIds.length}\n${card.relatedLaneIds.map((id) => lineLabel(id, storyLines)).join('\n')}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            flashReferences(card.id)
                          }}
                        >
                          复用 ×{card.relatedLaneIds.length}
                        </em>
                      ) : null}
                    </button>
                  )
                })}
                {lane.stackedReferences.map(({ reference, stack }) => {
                  const left = (reference.startTime / timelineDuration) * 100
                  const source = cards.find((card) => card.id === reference.sourceCardId)
                  const colors = lineColor(reference.laneId, storyLines)
                  const highlighted = highlightedReferenceSourceId === reference.sourceCardId || hoveredBlockId === reference.sourceCardId
                  return (
                    <button
                      key={reference.id}
                      type="button"
                      className={`timeline-segment swimlane-segment story-reference-card ${highlighted ? 'same-block-highlighted' : ''}`}
                      style={{
                        left: `${left}%`,
                        width: '8%',
                        minWidth: '96px',
                        top: `${lanePadding + stack * stackStep}px`,
                        background: colors.light,
                        borderColor: colors.border,
                        color: colors.text,
                        maxHeight: `${referenceHeight}px`,
                      }}
                      onMouseEnter={() => setHoveredBlockId(reference.sourceCardId)}
                      onMouseLeave={() => setHoveredBlockId(null)}
                      onClick={() => {
                        onSegmentClick(reference.sourceCardId)
                        flashMainCard(reference.sourceCardId)
                        setHighlightedReferenceSourceId(reference.sourceCardId)
                      }}
                      title={[
                        '这是引用卡',
                        `原始卡片：${source?.title ?? reference.title.replace(/^引用：/, '')}`,
                        `引用原因：${reference.referenceReason}`,
                        '点击可定位原始卡片',
                      ].join('\n')}
                    >
                      <em>引用</em>
                      <strong>{reference.title}</strong>
                      <time>{reference.time}</time>
                      <span>作用：{reference.referenceReason}</span>
                    </button>
                  )
                })}
              </div>
            )})}
            {!segments.length ? (
              <div className="timeline-empty-band">等待 AI 分析结果。请先生成 AI 分析包，再导入 AI 返回的 JSON。</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}

function lineLabel(lineId: string, lines: StoryLine[]): string {
  return lines.find((line) => line.id === lineId)?.title ?? lineId
}

function normalizeStoryCard(segment: Segment, subtitles: Subtitle[], lines: StoryLine[]): StoryCard {
  const text = segmentLaneText(segment)
  const primaryLane = normalizeLineId(segment.primaryLine, lines) ?? lines[0]?.id ?? ''
  const relatedLaneIds = resolveRelatedLineIds(segment, primaryLane, lines)
  const importance = segment.importance === 'pivot' ? 5 : segment.importance === 'key' ? 4 : inferImportance(segment)
  const tags = [
    segment.type,
    segment.narrativeOrder,
    ...relatedLaneIds.map((id) => lineLabel(id, lines)),
  ].filter(Boolean) as string[]

  return {
    id: segment.id,
    time: secondsToTimecode(segment.startTime),
    endTime: secondsToTimecode(segment.endTime),
    startTime: segment.startTime,
    endTimeSeconds: segment.endTime,
    title: getFunctionalTitle(segment),
    event: segmentStorySummary(segment, subtitles),
    primaryLane,
    function: segment.segmentFunction || segmentStructuralRole(segment) || '待补充剧本功能',
    pressure: extractSentence(segment.keyBeats || segment.rhythmDesign || '', ['压力', '威胁', '危机', '倒计时', '控制']),
    conflict: segment.rhythmDesign || segment.informationControl,
    audienceEmotion: segment.audienceExperience || extractAudienceEmotion(text),
    informationEffect: segment.informationControl,
    tags: [...new Set(tags)].slice(0, 5),
    relatedLaneIds,
    importance,
    isKeyTurn: segment.type === '转折' || segment.type === '升级' || importance >= 4,
    isClimax: segment.type === '高潮' || importance === 5,
    isSetup: segment.type === '开场' || segment.type === '背景',
    isPayoff: segment.type === '结尾' || segment.type === '结论',
    source: segment.aiGenerated ? 'AI' : '手动',
    note: segment.notes,
    segment,
  }
}

function resolveRelatedLineIds(segment: Segment, primaryLane: string, lines: StoryLine[]): string[] {
  const related = new Set<string>()
  for (const raw of segment.sharedLines ?? []) {
    const id = normalizeLineId(raw, lines)
    if (id) related.add(id)
  }
  if (segment.audienceExperience?.trim() && lines.some((line) => line.id === AUDIENCE_LINE_ID)) {
    related.add(AUDIENCE_LINE_ID)
  }
  related.delete(primaryLane)
  return [...related]
}

function getReferenceReason(lane: StoryLine): string {
  return lane.description
    ? `这个事件同时影响「${lane.title}」：${lane.description}`
    : `这个事件与「${lane.title}」存在结构关联`
}

function inferImportance(segment: Segment): 1 | 2 | 3 | 4 | 5 {
  if (segment.type === '高潮') return 5
  if (segment.type === '转折' || segment.type === '升级' || segment.type === '低谷') return 4
  if (segment.type === '开场' || segment.type === '结尾') return 3
  return 3
}

function extractAudienceEmotion(text: string): string | undefined {
  const words = ['紧张', '焦虑', '震惊', '希望', '爽感', '恐惧', '愤怒', '悲伤', '反转', '释放']
  return words.find((word) => text.includes(word))
}

function extractSentence(text: string, keywords: string[]): string | undefined {
  if (!text) return undefined
  return text
    .split(/[。；;.!?\n]/)
    .map((item) => item.trim())
    .find((item) => keywords.some((keyword) => item.includes(keyword)))
}

function stackStoryCards(cards: StoryCard[], duration: number): Array<{ card: StoryCard; stack: number }> {
  const stackEnds: number[] = []
  return [...cards]
    .sort((a, b) => a.startTime - b.startTime || a.endTimeSeconds - b.endTimeSeconds)
    .map((card) => {
      const left = (card.startTime / duration) * 100
      const width = Math.max(5, ((card.endTimeSeconds - card.startTime) / duration) * 100)
      const right = left + width
      const stack = stackEnds.findIndex((end) => left >= end + 0.8)
      const targetStack = stack >= 0 ? stack : stackEnds.length
      stackEnds[targetStack] = right
      return { card, stack: targetStack }
    })
}

function stackReferenceCards(
  references: StoryCardReference[],
  duration: number,
  mainStacks: Array<{ card: StoryCard; stack: number }>,
): Array<{ reference: StoryCardReference; stack: number }> {
  const stackEnds: number[] = []
  mainStacks.forEach(({ card, stack }) => {
    const left = (card.startTime / duration) * 100
    const width = Math.max(5, ((card.endTimeSeconds - card.startTime) / duration) * 100)
    stackEnds[stack] = Math.max(stackEnds[stack] ?? 0, left + width)
  })
  return [...references]
    .sort((a, b) => a.startTime - b.startTime)
    .map((reference) => {
      const left = (reference.startTime / duration) * 100
      const right = left + 8
      const stack = stackEnds.findIndex((end) => left >= end + 0.8)
      const targetStack = stack >= 0 ? stack : stackEnds.length
      stackEnds[targetStack] = right
      return { reference, stack: targetStack }
    })
}

function buildStructureBands(duration: number): StructureBand[] {
  const total = Math.max(duration, 1)
  return [
    { start: '00:00:00', end: secondsToTimecode(total * 0.2), title: '建立世界与人物', function: '交代人物处境、规则和初始目标' },
    { start: secondsToTimecode(total * 0.2), end: secondsToTimecode(total * 0.45), title: '冲突启动与升级', function: '让主角进入主要危机，并持续增加阻力' },
    { start: secondsToTimecode(total * 0.45), end: secondsToTimecode(total * 0.7), title: '中段反复施压', function: '通过选择、代价和信息差维持张力' },
    { start: secondsToTimecode(total * 0.7), end: secondsToTimecode(total * 0.88), title: '高潮解决', function: '主角面对最大阻力，完成关键行动' },
    { start: secondsToTimecode(total * 0.88), end: secondsToTimecode(total), title: '余韵收束', function: '释放压力，完成主题落点' },
  ]
}

function EmotionCurveLane({
  points,
  cards,
  subtitles,
  duration,
  hoveredPointId,
  onHoverPoint,
  onPointClick,
}: {
  points: AudienceCurvePoint[]
  cards: StoryCard[]
  subtitles: Subtitle[]
  duration: number
  hoveredPointId: string | null
  onHoverPoint: (pointId: string | null) => void
  onPointClick: (point: AudienceCurvePoint) => void
}) {
  const laneRef = useRef<HTMLDivElement | null>(null)
  const [laneWidth, setLaneWidth] = useState(1000)
  // 台词密度背景是否显示,记住用户选择
  const [showDialogueDensity, setShowDialogueDensity] = useState(() => localStorage.getItem('lapian.dialogue-density') !== 'off')
  const sorted = [...points].sort((a, b) => a.time - b.time)
  const height = 300
  const topPadding = 64
  const bottomPadding = 58
  const usable = height - topPadding - bottomPadding
  const densityPoints = useMemo(() => getDialogueDensity(subtitles, duration), [subtitles, duration])
  const densityPeak = maxDensity(densityPoints)
  const hasDensity = densityPoints.length > 1 && densityPeak > 0

  function toggleDialogueDensity(next: boolean) {
    setShowDialogueDensity(next)
    localStorage.setItem('lapian.dialogue-density', next ? 'on' : 'off')
  }

  useLayoutEffect(() => {
    const element = laneRef.current
    if (!element) return
    const update = () => setLaneWidth(element.clientWidth || 1000)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const plotted = sorted.map((point) => {
    const intensity10 = Math.max(1, Math.min(10, Math.round(point.intensity / 10)))
    const xPercent = (Math.max(0, Math.min(duration, point.time)) / duration) * 100
    const y = topPadding + (1 - intensity10 / 10) * usable
    return { point, xPercent, y, intensity10 }
  })
  const curveSegments = plotted.slice(0, -1).map((current, index) => {
    const next = plotted[index + 1]
    const currentX = (current.xPercent / 100) * laneWidth
    const nextX = (next.xPercent / 100) * laneWidth
    const dx = nextX - currentX
    const dy = next.y - current.y
    const length = Math.sqrt(dx * dx + dy * dy)
    const angle = Math.atan2(dy, dx) * 180 / Math.PI
    return {
      id: `${current.point.id}-${next.point.id}`,
      left: currentX,
      top: current.y,
      length,
      angle,
    }
  })

  return (
    <div ref={laneRef} className="emotion-curve-lane" style={{ height }}>
      <div className="emotion-curve-grid">
        {[1, 5, 10].map((level) => (
          <span key={level} style={{ top: `${topPadding + (1 - level / 10) * usable}px` }}>
            {level}
          </span>
        ))}
      </div>
      {hasDensity && showDialogueDensity ? (
        <svg
          className="dialogue-density-area"
          style={{ top: `${topPadding}px`, height: `${usable}px` }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon
            points={`0,100 ${densityPoints
              .map((point) => `${((point.time / duration) * 100).toFixed(2)},${(100 - (point.charsPerMinute / densityPeak) * 100).toFixed(2)}`)
              .join(' ')} 100,100`}
          />
        </svg>
      ) : null}
      {hasDensity ? (
        <label
          className="dialogue-density-toggle"
          title={`按字幕统计的每分钟台词量,峰值约 ${Math.round(densityPeak)} 字/分钟。和情绪曲线对照,能看出高潮靠台词还是靠画面`}
        >
          <input
            type="checkbox"
            checked={showDialogueDensity}
            onChange={(event) => toggleDialogueDensity(event.target.checked)}
          />
          <span>台词密度</span>
        </label>
      ) : null}
      <div className="emotion-curve-lines" aria-hidden="true">
        {curveSegments.map((segment) => (
            <span
              key={segment.id}
              className="emotion-curve-segment"
              style={{
                left: `${segment.left}px`,
                top: `${segment.top}px`,
                width: `${segment.length}px`,
                transform: `rotate(${segment.angle}deg)`,
              }}
            />
          ))}
      </div>
      {plotted.map(({ point, xPercent, y, intensity10 }, index) => {
        const active = hoveredPointId === point.id
        const related = cards.find((card) => point.relatedBlockIds?.includes(card.id))
        const labelSide = y < height * 0.36 ? 'below' : 'above'
        const labelShift = (index % 4) - 1.5
        return (
          <button
            key={point.id}
            type="button"
            className={`emotion-curve-point label-${labelSide} ${active ? 'active' : ''}`}
            style={{ left: `${xPercent}%`, top: `${y}px`, '--label-shift': `${labelShift * 18}px` } as React.CSSProperties}
            onMouseEnter={() => onHoverPoint(point.id)}
            onMouseLeave={() => onHoverPoint(null)}
            onClick={() => onPointClick(point)}
            title={[
              point.title,
              `时间：${secondsToTimecode(point.time)}`,
              `情绪强度：${intensity10} / 10`,
              point.description,
              related ? `关联主卡：${related.title}` : '',
            ].filter(Boolean).join('\n')}
          >
            <span />
            <b>{shortLabel(point.title)}</b>
          </button>
        )
      })}
    </div>
  )
}


function extractPhaseLabel(phase: ExtractPhase = 'idle'): string {
  if (phase === 'transcode') return '转码中｜正在转换为浏览器支持的格式'
  if (phase === 'subtitle') return '准备中｜正在读取内嵌字幕'
  if (phase === 'metadata') return '准备中｜正在读取影片信息'
  if (phase === 'frames') return '生成中｜正在抽帧'
  if (phase === 'cache') return '保存中｜正在缓存截图'
  if (phase === 'canceled') return '已取消'
  if (phase === 'error') return '读取失败'
  if (phase === 'done') return '已完成'
  return '准备中'
}

function extractPhaseDetail(phase: ExtractPhase = 'idle'): string {
  if (phase === 'transcode') return '浏览器不能直接读取这个格式，正在用本机 ffmpeg 转成 H.264 MP4。转码完成后会自动继续抽帧，同一个文件下次导入会直接用缓存。'
  if (phase === 'subtitle') return '正在检查影片里是否带有可读取字幕。若影片格式不支持，这一步最多等待 8 秒。'
  if (phase === 'metadata') return '正在读取影片时长和画面信息。若浏览器不支持该格式，这一步最多等待 15 秒。'
  if (phase === 'frames') return '正在按 1 秒提取截图，完成后会生成电影时间轴。'
  if (phase === 'cache') return '抽帧已经完成，正在把截图缓存到本机，便于下次恢复项目。'
  if (phase === 'canceled') return '任务已取消，可以重新导入影片或换用浏览器兼容版 MP4。'
  if (phase === 'error') return '读取失败，请查看上方错误信息。'
  if (phase === 'done') return '生成已完成。'
  return '正在准备生成时间轴。'
}

function getFunctionalTitle(segment: Segment): string {
  const genericTypes = ['开场', '起', '承', '转', '合', '冲突', '推进', '转折', '升级', '低谷', '高潮', '结尾', '支线', '过渡', '背景', '说明', '结论']
  if (segment.title && !genericTypes.includes(segment.title)) return segment.title
  return segment.title || segment.segmentFunction || segment.keyBeats || segment.type || '未命名段落'
}

function segmentLaneText(segment: Segment): string {
  const flexibleSegment = segment as Segment & {
    category?: string
    functionType?: string
    function?: string
    role?: string
    tags?: string[] | string
    summary?: string
  }
  const tags = Array.isArray(flexibleSegment.tags) ? flexibleSegment.tags.join(' ') : flexibleSegment.tags
  return [
    segment.type,
    flexibleSegment.category,
    flexibleSegment.functionType,
    flexibleSegment.function,
    flexibleSegment.role,
    tags,
    segment.narrativeOrder,
    segment.segmentFunction,
    segment.keyBeats,
    segment.creativeIntent,
    segment.informationControl,
    segment.rhythmDesign,
    segment.audienceExperience,
    flexibleSegment.summary,
    segment.title,
  ].filter(Boolean).join(' ')
}

function createTimeTicks(duration: number): number[] {
  const targetCount = Math.min(10, Math.max(6, Math.ceil(duration / 900) + 1))
  if (targetCount <= 1) return [0]
  return Array.from({ length: targetCount }, (_, index) => Math.round((duration / (targetCount - 1)) * index))
}

function formatTickTime(seconds: number): string {
  const timecode = secondsToTimecode(seconds)
  return timecode.startsWith('00:') ? timecode.slice(3) : timecode
}

function timecodeToSeconds(timecode: string): number {
  const parts = timecode.split(':').map((part) => Number(part))
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number(timecode) || 0
}

function shortLabel(title: string): string {
  return title.length > 16 ? `${title.slice(0, 16)}...` : title
}

function formatBlockStats(segment: Segment): string {
  const blocks = segment.screenplayBlocks ?? []
  const sceneCount = blocks.filter((block) => block.type === '场景').length
  const actionCount = blocks.filter((block) => block.type === '动作').length
  const dialogueCount = blocks.filter((block) => block.type === '对白' || block.type === '旁白/字幕' || block.type === '手语/字幕').length
  const noteCount = blocks.filter((block) => block.type === '备注').length
  return [
    `${blocks.length} 条小节`,
    sceneCount ? `场景 ${sceneCount}` : '',
    actionCount ? `动作 ${actionCount}` : '',
    dialogueCount ? `对白 ${dialogueCount}` : '',
    noteCount ? `备注 ${noteCount}` : '',
  ].filter(Boolean).join('｜')
}

type ScreenplayBlockFilter = '场景' | '动作' | '对白' | '旁白/字幕' | '手语/字幕' | '备注'

function blockDensity(segment: Segment): Array<{ type: ScreenplayBlockFilter; percent: number }> {
  const blocks = segment.screenplayBlocks ?? []
  if (!blocks.length) return [{ type: '备注', percent: 100 }]
  const types: ScreenplayBlockFilter[] = ['场景', '动作', '对白', '旁白/字幕', '手语/字幕', '备注']
  return types
    .map((type) => ({
      type,
      percent: (blocks.filter((block) => block.type === type).length / blocks.length) * 100,
    }))
    .filter((item) => item.percent > 0)
}

function pickRepresentativeFrames(frames: Frame[], segment: Segment, avoidOpeningBlackFrame = false): Frame[] {
  if (!frames.length) return []
  const segmentFrames = frames.filter((frame) => frame.time >= segment.startTime && frame.time <= segment.endTime)
  const source = segmentFrames.length ? segmentFrames : frames
  const firstTarget = avoidOpeningBlackFrame && segment.startTime <= 5
    ? Math.min(Math.max(60, segment.startTime), segment.endTime)
    : segment.startTime
  const targets = [firstTarget, (segment.startTime + segment.endTime) / 2, segment.endTime]
  return targets
    .map((target) =>
      source.reduce((nearest, frame) =>
        Math.abs(frame.time - target) < Math.abs(nearest.time - target) ? frame : nearest,
      ),
    )
    .filter((frame, index, list) => list.findIndex((item) => item.id === frame.id) === index)
}
