import type { Project } from '../types'
import { hasMeaningfulProjectContent } from '../lib/project'

interface ToolbarProps {
  project: Project
  isTaskRunning: boolean
  onOpenLibrary: () => void
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
          <span>① 电影</span>
          <button
            disabled={props.isTaskRunning}
            title={props.project.sourceVideoName ? '换一部电影会开始一个新项目' : '选择电影文件,之后转码、抽帧、字幕、AI 分析包全自动'}
            onClick={props.onVideoPath}
          >
            {props.project.sourceVideoName ? '更换电影' : '导入电影'}
          </button>
          <button onClick={props.onSubtitle}>{props.project.subtitlePath ? '更换字幕' : '导入字幕'}</button>
          <button onClick={props.onScreenplayResearch}>{props.project.screenplayResearch ? '更换剧情资料' : '导入剧情资料'}</button>
        </div>

        <div className="tool-section">
          <span>② AI 分析</span>
          <button disabled={!canGenerateAiPackage} onClick={props.onGenerateAiPackage}>
            生成 AI 分析包
          </button>
          <button disabled={!hasExportableContent || props.isTaskRunning} onClick={props.onImportAiResult}>导入 AI 结果</button>
        </div>

        <div className="tool-section">
          <span>③ 导出</span>
          <button disabled={!hasExportableContent} onClick={props.onExportMarkdown}>导出 Markdown</button>
          <button disabled={!props.project.segments.length} onClick={props.onExportScreenplay}>导出剧本正文</button>
        </div>

        <div className="tool-section tool-section-secondary">
          <span>项目</span>
          <button title="查看所有电影项目,一键切换;也可以从 ZIP 导入" onClick={props.onOpenLibrary}>我的项目</button>
          <button disabled={!hasExportableContent} title="把当前项目导出为自包含 ZIP(笔记+截图),备份或换电脑用" onClick={props.onSaveProjectPackage}>
            备份 ZIP
          </button>
        </div>
      </div>
    </header>
  )
}
