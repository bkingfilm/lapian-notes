import type { RefObject } from 'react'
import type { Frame, Project, Segment, ShotDetection, StoryLine, Subtitle } from '../types'
import { narrativeOrders, segmentTypes } from '../types'
import type { ScreenplayBlock } from '../types'
import { hasMeaningfulProjectContent, segmentColors } from '../lib/project'
import { secondsToTimecode } from '../lib/timecode'
import { getSegmentProgress } from '../lib/segmentProgress'
import { getSegmentQuality } from '../lib/segmentQuality'
import { formatShotSeconds, getSegmentShotStats } from '../lib/shotStats'
import { segmentTypeHints, narrativeOrderHints } from '../lib/glossary'
import { getProjectStoryLines, normalizeLineId } from '../lib/storyLines'

interface InspectorPanelProps {
  project: Project
  selectedFrame?: Frame
  selectedSegment?: Segment
  selectedSegmentPosition?: { index: number; total: number }
  boundaryFrame?: Frame
  frames: Frame[]
  hasFrameRangeStart: boolean
  onProjectChange: (patch: Partial<Project>) => void
  onStartSegmentRange: (frameId: string) => void
  onEndSegmentRange: (frameId: string) => void
  onClearSegmentRange: () => void
  onFrameChange: (frameId: string, patch: Partial<Frame>) => void
  onSegmentChange: (segmentId: string, patch: Partial<Segment>) => void
  onSegmentNavigate: (direction: 'prev' | 'next') => void
  onUseFrameAsSegmentBoundary: (segmentId: string, frame: Frame, boundary: 'start' | 'end') => void
  onSegmentDelete: (segmentId: string) => void
  onExportSegmentDeepDive: () => void
  onProjectDelete: () => void
  videoPlayerUrl: string | null
  playerRef: RefObject<HTMLVideoElement | null>
  onSeekTo: (time: number, stopAt?: number) => void
  onPlayerTimeUpdate: () => void
  onRelinkVideo: () => void
}

export function InspectorPanel(props: InspectorPanelProps) {
  return (
    <aside className="inspector">
      <div className="panel-title">
        <h2>编辑</h2>
      </div>

      <VideoPlayerPanel
        videoPlayerUrl={props.videoPlayerUrl}
        playerRef={props.playerRef}
        onTimeUpdate={props.onPlayerTimeUpdate}
        onRelinkVideo={props.onRelinkVideo}
      />

      {props.selectedSegment ? (
        <SegmentInspector
          frames={props.frames}
          subtitles={props.project.subtitles}
          storyLines={getProjectStoryLines(props.project)}
          shotDetection={props.project.shotDetection}
          projectDuration={props.project.duration}
          segment={props.selectedSegment}
          position={props.selectedSegmentPosition}
          boundaryFrame={props.boundaryFrame}
          onChange={(patch) => props.onSegmentChange(props.selectedSegment!.id, patch)}
          onNavigate={props.onSegmentNavigate}
          onUseFrameAsBoundary={(boundary) => {
            if (!props.boundaryFrame) return
            props.onUseFrameAsSegmentBoundary(props.selectedSegment!.id, props.boundaryFrame, boundary)
          }}
          onExportDeepDive={props.onExportSegmentDeepDive}
          onDelete={() => props.onSegmentDelete(props.selectedSegment!.id)}
          onSeekTo={props.onSeekTo}
        />
      ) : props.selectedFrame ? (
        <FrameInspector
          frame={props.selectedFrame}
          hasFrameRangeStart={props.hasFrameRangeStart}
          onStartSegmentRange={() => props.onStartSegmentRange(props.selectedFrame!.id)}
          onEndSegmentRange={() => props.onEndSegmentRange(props.selectedFrame!.id)}
          onClearSegmentRange={props.onClearSegmentRange}
          onChange={(patch) => props.onFrameChange(props.selectedFrame!.id, patch)}
          onSeekTo={props.onSeekTo}
        />
      ) : (
        <ProjectManager project={props.project} onChange={props.onProjectChange} onDelete={props.onProjectDelete} />
      )}
    </aside>
  )
}

function VideoPlayerPanel({
  videoPlayerUrl,
  playerRef,
  onTimeUpdate,
  onRelinkVideo,
}: {
  videoPlayerUrl: string | null
  playerRef: RefObject<HTMLVideoElement | null>
  onTimeUpdate: () => void
  onRelinkVideo: () => void
}) {
  return (
    <section className="video-player-panel">
      {videoPlayerUrl ? (
        <video ref={playerRef} src={videoPlayerUrl} controls preload="metadata" onTimeUpdate={onTimeUpdate} />
      ) : (
        <div className="video-player-empty">
          <span>关联影片文件后，点任意时间即可跳转播放</span>
          <button type="button" onClick={onRelinkVideo}>关联影片文件</button>
        </div>
      )}
    </section>
  )
}

function ProjectManager({ project, onChange, onDelete }: { project: Project; onChange: (patch: Partial<Project>) => void; onDelete: () => void }) {
  const mergedTitle = project.projectTitle || project.filmTitle

  return (
    <section className="inspector-section">
      <label className="field compact">
        <span>项目名 / 影片名</span>
        <input
          value={mergedTitle}
          onChange={(event) => onChange({ projectTitle: event.target.value, filmTitle: event.target.value })}
        />
      </label>
      <label className="field">
        <span>拆解目标<small className="optional-tag">选填</small></span>
        <input
          value={project.learningGoal ?? ''}
          placeholder="比如：把这部电影拆成按时间轴排列的文字剧本，并分析结构和节奏"
          onChange={(event) => onChange({ learningGoal: event.target.value })}
        />
      </label>
      <div className="project-manage-footer">
        <p>换一部电影：直接点顶部「更换电影」，会自动开始新项目。当前项目想留档就先点「保存」导出 ZIP。</p>
        {hasMeaningfulProjectContent(project) ? (
          <button className="danger-button" onClick={onDelete}>删除当前项目</button>
        ) : null}
      </div>
    </section>
  )
}

function FrameInspector({
  frame,
  hasFrameRangeStart,
  onStartSegmentRange,
  onEndSegmentRange,
  onClearSegmentRange,
  onChange,
  onSeekTo,
}: {
  frame: Frame
  hasFrameRangeStart: boolean
  onStartSegmentRange: () => void
  onEndSegmentRange: () => void
  onClearSegmentRange: () => void
  onChange: (patch: Partial<Frame>) => void
  onSeekTo: (time: number) => void
}) {
  return (
    <section className="inspector-section">
      <h3>
        时间点 {secondsToTimecode(frame.time)}
        <button type="button" className="seek-button" onClick={() => onSeekTo(frame.time)}>▶ 从此处播放</button>
      </h3>
      {frame.src ? (
        <img className="preview-image" src={frame.src} alt="frame" />
      ) : (
        <div className="preview-image missing-preview">
          <strong>{secondsToTimecode(frame.time)}</strong>
          <span>当前帧暂无截图，需要重新选择电影后生成 AI 分析包。</span>
        </div>
      )}
      <label className="field">
        <span>备注</span>
        <textarea value={frame.note ?? ''} onChange={(event) => onChange({ note: event.target.value })} />
      </label>
      <div className="frame-range-actions">
        {hasFrameRangeStart ? (
          <>
            <button onClick={onEndSegmentRange}>设为段落终点并创建</button>
            <button onClick={onClearSegmentRange}>清除起点</button>
          </>
        ) : (
          <button onClick={onStartSegmentRange}>设为新段落起点</button>
        )}
      </div>
    </section>
  )
}

function SegmentInspector({
  frames,
  subtitles,
  storyLines,
  shotDetection,
  projectDuration,
  segment,
  position,
  boundaryFrame,
  onChange,
  onNavigate,
  onUseFrameAsBoundary,
  onExportDeepDive,
  onDelete,
  onSeekTo,
}: {
  frames: Frame[]
  subtitles: Subtitle[]
  storyLines: StoryLine[]
  shotDetection?: ShotDetection
  projectDuration: number
  segment: Segment
  position?: { index: number; total: number }
  boundaryFrame?: Frame
  onChange: (patch: Partial<Segment>) => void
  onNavigate: (direction: 'prev' | 'next') => void
  onUseFrameAsBoundary: (boundary: 'start' | 'end') => void
  onExportDeepDive: () => void
  onDelete: () => void
  onSeekTo: (time: number, stopAt?: number) => void
}) {
  const segmentSubtitles = subtitles.filter((subtitle) => subtitle.startTime <= segment.endTime && subtitle.endTime >= segment.startTime)
  const progress = getSegmentProgress(segment)
  const quality = getSegmentQuality(segment, frames, subtitles, frames.length > 1 ? frames[1].time - frames[0].time : 5)
  const segmentShotStats = getSegmentShotStats(shotDetection, segment, Math.max(projectDuration, segment.endTime))
  const primaryLine = normalizeLineId(segment.primaryLine, storyLines) ?? storyLines[0].id
  const sharedLines = normalizeSharedLineIds(segment.sharedLines, primaryLine, storyLines)
  const isShared = segment.isShared ?? sharedLines.length > 1

  function updateBoundary(field: 'startFrameId' | 'endFrameId', frameId: string) {
    const frame = frames.find((item) => item.id === frameId)
    if (!frame) return
    const patch: Partial<Segment> = { [field]: frameId }
    if (field === 'startFrameId') {
      patch.startTime = frame.time
      if (frame.time > segment.endTime) {
        patch.endFrameId = frame.id
        patch.endTime = frame.time
      }
    }
    if (field === 'endFrameId') {
      patch.endTime = frame.time
      if (frame.time < segment.startTime) {
        patch.startFrameId = frame.id
        patch.startTime = frame.time
      }
    }
    onChange(patch)
  }

  function updatePrimaryLine(nextPrimaryLine: string) {
    const nextSharedLines = normalizeSharedLineIds(sharedLines, nextPrimaryLine, storyLines)
    onChange({
      primaryLine: nextPrimaryLine,
      sharedLines: nextSharedLines,
      isShared: isShared || nextSharedLines.length > 1,
    })
  }

  function updateSharedLine(lineId: string, checked: boolean) {
    const nextSharedLines = normalizeSharedLineIds(
      checked ? [...sharedLines, lineId] : sharedLines.filter((item) => item !== lineId),
      primaryLine,
      storyLines,
    )
    onChange({
      sharedLines: nextSharedLines,
      isShared: nextSharedLines.length > 1,
    })
  }

  return (
    <section className="inspector-section segment-form">
      <div className="segment-nav">
        <button disabled={!position || position.index <= 0} onClick={() => onNavigate('prev')}>上一段</button>
        <h3>{position ? `第 ${position.index + 1}/${position.total} 段` : '当前段落'}</h3>
        <button disabled={!position || position.index >= position.total - 1} onClick={() => onNavigate('next')}>下一段</button>
      </div>
      <div className="segment-time-title">
        {secondsToTimecode(segment.startTime)} - {secondsToTimecode(segment.endTime)}
        <button type="button" className="seek-button" onClick={() => onSeekTo(segment.startTime, segment.endTime)}>▶ 播放本段</button>
      </div>
      <div className="segment-progress">
        <div>
          <strong>完成度 {progress.percent}%</strong>
          <span>{progress.completed}/{progress.total}</span>
        </div>
        <progress value={progress.completed} max={progress.total} />
        {progress.missing.length ? (
          <p>想补充可以从这些开始：{progress.missing.slice(0, 4).join('、')}{progress.missing.length > 4 ? '…' : ''}（不必全填，写你有感觉的）</p>
        ) : (
          <p>当前段落字段完整，可直接用于导出。</p>
        )}
      </div>

      <div className={`segment-quality ${quality.warnings.length ? 'warn' : 'ready'}`}>
        <div>
          <strong>段落诊断</strong>
          <span>
            {secondsToTimecode(quality.duration)}｜画面 {quality.frameCount}｜字幕 {quality.subtitleCount}
            {segmentShotStats ? `｜镜头 ${segmentShotStats.shotCount}｜均长 ${formatShotSeconds(segmentShotStats.averageShotSeconds)}` : ''}
          </span>
        </div>
        {quality.warnings.length ? (
          <ul>
            {quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        ) : (
          <p>段落范围清晰，可继续补充剧本分析。</p>
        )}
      </div>

      {boundaryFrame ? (
        <div className="boundary-actions">
          <span>当前时间点：{secondsToTimecode(boundaryFrame.time)}</span>
          <button onClick={() => onUseFrameAsBoundary('start')}>设为起点</button>
          <button onClick={() => onUseFrameAsBoundary('end')}>设为终点</button>
        </div>
      ) : null}

      <div className="segment-boundary-grid">
        <label className="field compact">
          <span>起点</span>
          <select value={segment.startFrameId} onChange={(event) => updateBoundary('startFrameId', event.target.value)}>
            {frames.map((frame) => (
              <option key={frame.id} value={frame.id}>{secondsToTimecode(frame.time)}</option>
            ))}
          </select>
        </label>
        <label className="field compact">
          <span>终点</span>
          <select value={segment.endFrameId} onChange={(event) => updateBoundary('endFrameId', event.target.value)}>
            {frames.map((frame) => (
              <option key={frame.id} value={frame.id}>{secondsToTimecode(frame.time)}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="field compact">
        <span>标题</span>
        <input value={segment.title} onChange={(event) => onChange({ title: event.target.value })} />
      </label>
      <label className="field compact">
        <span>类型</span>
        <select
          value={segment.type}
          onChange={(event) => {
            const type = event.target.value as Segment['type']
            onChange({ type, color: segmentColors[type] })
          }}
        >
          {segmentTypes.map((type) => <option key={type} value={type} title={segmentTypeHints[type]}>{type}</option>)}
        </select>
        <small className="term-hint">{segmentTypeHints[segment.type] ?? ''}</small>
      </label>
      <label className="field compact">
        <span>叙事顺序</span>
        <select value={segment.narrativeOrder ?? '顺叙'} onChange={(event) => onChange({ narrativeOrder: event.target.value as Segment['narrativeOrder'] })}>
          {narrativeOrders.map((order) => <option key={order} value={order} title={narrativeOrderHints[order]}>{order}</option>)}
        </select>
        <small className="term-hint">{segment.narrativeOrder ? narrativeOrderHints[segment.narrativeOrder] ?? '' : ''}</small>
      </label>
      <section className="shared-module-editor">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={isShared}
            onChange={(event) => onChange({ isShared: event.target.checked, sharedLines })}
          />
          <span>是否多线复用</span>
        </label>
        <label className="field compact">
          <span>主归属线</span>
          <select value={primaryLine} onChange={(event) => updatePrimaryLine(event.target.value)}>
            {storyLines.map((line) => <option key={line.id} value={line.id}>{line.title}</option>)}
          </select>
        </label>
        <div className="field">
          <span>复用线索</span>
          <div className="shared-line-options">
            {storyLines.map((line) => (
              <label key={line.id} className="checkbox-field">
                <input
                  type="checkbox"
                  checked={sharedLines.includes(line.id)}
                  disabled={line.id === primaryLine}
                  onChange={(event) => updateSharedLine(line.id, event.target.checked)}
                />
                <span>{line.title}</span>
              </label>
            ))}
          </div>
        </div>
        <label className="field compact">
          <span>重要性</span>
          <select
            value={segment.importance ?? 'normal'}
            onChange={(event) => onChange({ importance: event.target.value as Segment['importance'] })}
          >
            <option value="normal">普通</option>
            <option value="key">关键复用</option>
            <option value="pivot">结构枢纽</option>
          </select>
        </label>
        <TextArea
          label="结构作用"
          placeholder="说明这个模块为什么同时影响多条线索，或它在结构中承担的枢纽作用。"
          value={segment.structureRole}
          onChange={(structureRole) => onChange({ structureRole })}
        />
      </section>

      <section className="core-analysis-fields">
        <div className="core-analysis-title">
          <div>
            <strong>核心分析</strong>
            <span>先还原剧情文本，再拆成场景、动作、对白小节，并补结构节奏判断。</span>
          </div>
          <button
            type="button"
            title="只打包这一段的截图和字幕发给 AI，让 AI 拆到场与镜头级"
            onClick={onExportDeepDive}
          >
            只导出本段给 AI
          </button>
        </div>
        <p className="deep-dive-hint">
          不必每段都拆，挑全片你最有感觉的 2 到 3 段。想把这一段拆到镜头级：点上方按钮生成只含本段的小包发给 AI（指令自动进剪贴板），AI
          返回的 JSON 从「导入 AI 结果」导回，会自动填进这一段，不影响其它段落。
        </p>
        <TextArea
          label="段落功能"
          placeholder="这段在整部电影里承担什么作用？比如引出目标、制造冲突、升级危机、完成转折。"
          value={segment.segmentFunction}
          onChange={(segmentFunction) => onChange({ segmentFunction })}
        />
        <TextArea
          label="关键节拍"
          placeholder="按 1、2、3 写出这段发生了哪些关键动作、信息释放或情绪变化。"
          value={segment.keyBeats}
          onChange={(keyBeats) => onChange({ keyBeats })}
        />
        <TextArea
          label="剧情文本 / 剧本还原"
          placeholder="把这段还原成文字剧本：场景、人物、目标、阻碍、动作推进、结果。"
          value={segment.screenplayDraft}
          onChange={(screenplayDraft) => onChange({ screenplayDraft })}
        />
        <ScreenplayBlockEditor
          blocks={segment.screenplayBlocks ?? []}
          segment={segment}
          onChange={(screenplayBlocks) => onChange({ screenplayBlocks })}
          onSeekTo={onSeekTo}
        />
        <TextArea
          label="观众体验"
          placeholder="观众在这段应该获得什么感受？比如好奇、紧张、理解、误判、共情或释放。"
          value={segment.audienceExperience}
          onChange={(audienceExperience) => onChange({ audienceExperience })}
        />
      </section>
      <SubtitlePreview subtitles={segmentSubtitles} onSeekTo={onSeekTo} />
      <details className="advanced-segment-fields">
        <summary>高级字段（可选）</summary>
        <TextArea label="创作意图" value={segment.creativeIntent} onChange={(creativeIntent) => onChange({ creativeIntent })} />
        <TextArea label="信息控制" value={segment.informationControl} onChange={(informationControl) => onChange({ informationControl })} />
        <TextArea label="节奏设计" value={segment.rhythmDesign} onChange={(rhythmDesign) => onChange({ rhythmDesign })} />
        <TextArea label="手法" value={segment.techniques} onChange={(techniques) => onChange({ techniques })} />
        <TextArea label="复用方法" value={segment.reusableMethod} onChange={(reusableMethod) => onChange({ reusableMethod })} />
        <TextArea label="备注" value={segment.notes} onChange={(notes) => onChange({ notes })} />
      </details>
      <button className="danger-button" onClick={onDelete}>删除当前段落</button>
    </section>
  )
}

function normalizeSharedLineIds(lines: string[] | undefined, primaryLine: string, storyLines: StoryLine[]): string[] {
  const normalized = (lines ?? [])
    .map((line) => normalizeLineId(line, storyLines))
    .filter((line): line is string => Boolean(line))
  return [...new Set([primaryLine, ...normalized])]
}

function ScreenplayBlockEditor({
  blocks,
  segment,
  onChange,
  onSeekTo,
}: {
  blocks: ScreenplayBlock[]
  segment: Segment
  onChange: (blocks: ScreenplayBlock[]) => void
  onSeekTo: (time: number) => void
}) {
  function updateBlock(id: string, patch: Partial<ScreenplayBlock>) {
    onChange(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)))
  }

  function addBlock(type: ScreenplayBlock['type']) {
    onChange([
      ...blocks,
      {
        id: crypto.randomUUID(),
        type,
        time: segment.startTime,
        text: '',
      },
    ])
  }

  function removeBlock(id: string) {
    onChange(blocks.filter((block) => block.id !== id))
  }

  return (
    <section className="screenplay-block-editor">
      <div>
        <strong>剧本小节</strong>
        <span>{blocks.length ? `${blocks.length} 条；至少补动作或对白才算正文完整` : '可把段落拆成场景、动作、对白。'}</span>
      </div>
      {blocks.length ? (
        <ol>
          {blocks.map((block, index) => (
            <li key={block.id}>
              <div className="screenplay-block-row">
                <select value={block.type} onChange={(event) => updateBlock(block.id, { type: event.target.value as ScreenplayBlock['type'] })}>
                  {(['场景', '动作', '对白', '旁白/字幕', '备注'] as const).map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <input
                  type="number"
                  min={Math.floor(segment.startTime)}
                  max={Math.ceil(segment.endTime)}
                  step={1}
                  value={Math.round(block.time ?? segment.startTime)}
                  onChange={(event) => updateBlock(block.id, { time: Number(event.target.value) })}
                  aria-label={`第 ${index + 1} 条时间`}
                />
                <button type="button" className="seek-button" onClick={() => onSeekTo(block.time ?? segment.startTime)}>▶ {secondsToTimecode(block.time ?? segment.startTime)}</button>
                <button type="button" onClick={() => removeBlock(block.id)}>删除</button>
              </div>
              <textarea
                value={block.text}
                placeholder="写入场景头、动作描写、人物对白或旁白/字幕提示。"
                onChange={(event) => updateBlock(block.id, { text: event.target.value })}
              />
            </li>
          ))}
        </ol>
      ) : null}
      <div className="screenplay-block-actions">
        <button type="button" onClick={() => addBlock('场景')}>加场景</button>
        <button type="button" onClick={() => addBlock('动作')}>加动作</button>
        <button type="button" onClick={() => addBlock('对白')}>加对白</button>
      </div>
    </section>
  )
}

function SubtitlePreview({ subtitles, onSeekTo }: { subtitles: Subtitle[]; onSeekTo: (time: number) => void }) {
  return (
    <section className="subtitle-preview">
      <div>
        <span>段落内字幕</span>
        <small>{subtitles.length ? `${subtitles.length} 条字幕` : '0 条字幕'}</small>
      </div>
      {subtitles.length ? (
        <ol>
          {subtitles.map((subtitle) => (
            <li key={subtitle.id}>
              <button type="button" className="seek-button" onClick={() => onSeekTo(subtitle.startTime)}>▶ {secondsToTimecode(subtitle.startTime)}</button>
              <p>{subtitle.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p>当前段落未匹配到字幕。可导入 SRT 或先手动填写文本感知。</p>
      )}
    </section>
  )
}

function TextArea({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value?: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea placeholder={placeholder} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

