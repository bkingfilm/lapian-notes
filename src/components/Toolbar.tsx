import type { Project } from '../types'
import { hasMeaningfulProjectContent } from '../lib/project'

interface ToolbarProps {
  project: Project
  isTaskRunning: boolean
  onNewProject: () => void
  onDeleteProject: () => void
  onOpenProjectPackage: () => void
  onSaveProjectPackage: () => void
  onVideoPath: () => void
  onSubtitle: () => void
  onScreenplayResearch: () => void
  onGenerateAiPackage: () => void
  onImportAiResult: () => void
  onExportMarkdown: () => void
  onExportScreenplay: () => void
}

export function Toolbar(props: ToolbarProps) {
  const hasExportableContent = hasMeaningfulProjectContent(props.project)
  const canGenerateAiPackage = Boolean(props.project.sourceVideoName && !props.isTaskRunning)

  return (
    <header className="toolbar">
      <div className="brand">
        <strong>拉片笔记</strong>
        <span>{props.project.projectTitle || '未命名项目'}</span>
      </div>
      <div className="tool-groups">
        <div className="tool-section">
          <span>项目</span>
          <button onClick={props.onNewProject}>新建</button>
          <button title="打开保存的 ZIP 项目或旧 JSON 项目" onClick={props.onOpenProjectPackage}>打开项目</button>
          <button disabled={!hasExportableContent} onClick={props.onSaveProjectPackage}>
            保存项目
          </button>
          <button className="danger-button" disabled={!hasExportableContent} onClick={props.onDeleteProject}>删除项目</button>
        </div>

        <div className="tool-section">
          <span>素材</span>
          <button disabled={props.isTaskRunning} onClick={props.onVideoPath}>{props.project.sourceVideoName ? '更换电影' : '导入电影'}</button>
          <button onClick={props.onSubtitle}>{props.project.subtitlePath ? '更换字幕' : '导入字幕'}</button>
          <button onClick={props.onScreenplayResearch}>{props.project.screenplayResearch ? '更换剧本/剧情资料' : '导入剧本/剧情资料'}</button>
        </div>

        <div className="tool-section">
          <span>AI</span>
          <button disabled={!canGenerateAiPackage} onClick={props.onGenerateAiPackage}>
            生成 AI 分析包
          </button>
          <button disabled={!hasExportableContent || props.isTaskRunning} onClick={props.onImportAiResult}>导入 AI 结果</button>
        </div>

        <div className="tool-section">
          <span>导出</span>
          <button disabled={!hasExportableContent} onClick={props.onExportMarkdown}>导出 Markdown</button>
          <button disabled={!props.project.segments.length} onClick={props.onExportScreenplay}>导出剧本正文</button>
        </div>
      </div>
    </header>
  )
}
