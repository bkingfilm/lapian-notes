import type { Project } from '../types'
import { hasMeaningfulProjectContent } from '../lib/project'

interface ToolbarProps {
  project: Project
  isTaskRunning: boolean
  onOpenLibrary: () => void
  onSaveProjectPackage: () => void
  onVideoPath: () => void
  onSubtitle: () => void
  onGenerateAiPackage: () => void
  onImportAiResult: () => void
  onExportMarkdown: () => void
  onExportScreenplay: () => void
  onExportShareImage: () => void
  onOpenGuide: () => void
}

export function Toolbar(props: ToolbarProps) {
  const hasExportableContent = hasMeaningfulProjectContent(props.project)
  const canGenerateAiPackage = Boolean(props.project.sourceVideoName && !props.isTaskRunning)

  return (
    <header className="toolbar">
      <div className="brand">
        <strong>拉片笔记</strong>
        <span>{props.project.projectTitle || '未命名项目'}</span>
        <button type="button" className="guide-button" onClick={props.onOpenGuide}>? 新手怎么拉片</button>
      </div>
      <div className="tool-groups">
        <div className="tool-section">
          <span>① 电影</span>
          <button
            disabled={props.isTaskRunning}
            title={props.project.sourceVideoName ? '换一部电影会开始一个新项目' : '必选:选择电影文件,之后转码、抽帧、字幕、AI 分析包全自动'}
            onClick={props.onVideoPath}
          >
            <em className="required-star">*</em>
            {props.project.sourceVideoName ? '更换电影' : '导入电影'}
          </button>
          <button title="选填:没有会自动搜索网络字幕,搜不到也能纯画面分析" onClick={props.onSubtitle}>
            {props.project.subtitlePath ? '更换字幕' : '导入字幕'}
            <small className="optional-tag">选填</small>
          </button>
        </div>

        <div className="tool-section">
          <span>② 发给 AI</span>
          <button disabled={!canGenerateAiPackage} title="必选:打包截图和字幕,发给 ChatGPT / Gemini / Claude / Kimi 等能读压缩包和图片的 AI" onClick={props.onGenerateAiPackage}>
            <em className="required-star">*</em>
            生成 AI 分析包
          </button>
        </div>

        <div className="tool-section">
          <span>③ 导回结果</span>
          <button disabled={!hasExportableContent || props.isTaskRunning} title="必选:选择 AI 返回的 JSON,生成剧情时间轴" onClick={props.onImportAiResult}>
            <em className="required-star">*</em>
            导入 AI 结果
          </button>
        </div>

        <div className="tool-section">
          <span>导出</span>
          <button disabled={!hasExportableContent} onClick={props.onExportMarkdown}>导出 Markdown</button>
          <button disabled={!props.project.segments.length} onClick={props.onExportScreenplay}>导出剧本正文</button>
          <button disabled={!props.project.segments.length} title="把泳道时间轴、情绪曲线和结构树整体导出为一张长图,适合分享" onClick={props.onExportShareImage}>导出分享长图</button>
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
