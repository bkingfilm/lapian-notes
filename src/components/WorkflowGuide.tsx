import type { ReactNode } from 'react'
import type { Project } from '../types'

type StepState = 'done' | 'current' | 'todo'

interface WorkflowGuideProps {
  project: Project
  isTaskRunning: boolean
  onImportVideo: () => void
  onRegenerateAiPackage: () => void
  onImportAiResult: () => void
  onExportMarkdown: () => void
}

interface Step {
  index: number
  title: string
  description: ReactNode
  state: StepState
  action?: { label: string; onClick: () => void; disabled?: boolean }
}

export function WorkflowGuide(props: WorkflowGuideProps) {
  const hasFrames = props.project.frames.length > 0
  const hasSegments = props.project.segments.length > 0

  const steps: Step[] = [
    {
      index: 1,
      title: '导入电影',
      description: props.isTaskRunning
        ? '正在处理：转码、抽帧、配字幕、打包全自动，等进度条走完即可。'
        : '选择电影文件。格式不兼容会自动转码，之后自动抽帧、自动配字幕、自动生成 AI 分析包。',
      state: hasFrames ? 'done' : 'current',
      action: !hasFrames
        ? { label: '导入电影', onClick: props.onImportVideo, disabled: props.isTaskRunning }
        : undefined,
    },
    {
      index: 2,
      title: '把分析包发给 AI',
      description: (
        <>
          把下载的 ZIP 传给 ChatGPT 等任意 AI：<em className="guide-highlight">先粘贴指令</em>（已自动复制到剪贴板），再上传 ZIP。
        </>
      ),
      state: hasSegments ? 'done' : hasFrames ? 'current' : 'todo',
      action:
        hasFrames && !hasSegments
          ? { label: '生成 AI 分析包', onClick: props.onRegenerateAiPackage, disabled: props.isTaskRunning }
          : undefined,
    },
    {
      index: 3,
      title: '导回 AI 结果',
      description: 'AI 返回 JSON 文件后，从这里导入，自动生成剧情时间轴、结构树和情绪曲线。',
      state: hasSegments ? 'done' : hasFrames ? 'current' : 'todo',
      action:
        hasFrames && !hasSegments
          ? { label: '导入 AI 结果', onClick: props.onImportAiResult }
          : undefined,
    },
    {
      index: 4,
      title: '拉片精修',
      description:
        '点时间轴上的段落写笔记。想拆得更细：在右侧编辑面板点「只导出本段给 AI」，把这一段单独发给 AI 深拆，返回的 JSON 照第 3 步导回，会自动填进该段。完成后导出 Markdown。换下一部电影：直接点顶部「更换电影」。',
      state: hasSegments ? 'current' : 'todo',
      action: hasSegments
        ? { label: '导出 Markdown', onClick: props.onExportMarkdown }
        : undefined,
    },
  ]

  return (
    <nav className={`workflow-guide ${hasSegments ? 'compact' : ''}`} aria-label="使用流程">
      {steps.map((step) => (
        <div key={step.index} className={`workflow-step ${step.state}`}>
          <span className="workflow-step-number">{step.state === 'done' ? '✓' : step.index}</span>
          <div className="workflow-step-body">
            <strong>{step.title}</strong>
            <span>{step.description}</span>
            {step.action ? (
              <button type="button" disabled={step.action.disabled} onClick={step.action.onClick}>
                {step.action.label}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </nav>
  )
}
