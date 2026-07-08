import type { ProjectSummary } from '../lib/projectStore'
import { secondsToTimecode } from '../lib/timecode'

interface ProjectLibraryProps {
  projects: ProjectSummary[]
  currentProjectId: string
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onImportZip: () => void
  onClose: () => void
}

export function ProjectLibrary(props: ProjectLibraryProps) {
  return (
    <section className="markdown-preview">
      <div className="markdown-preview-panel project-library-panel">
        <div className="markdown-preview-header">
          <strong>我的项目</strong>
          <div>
            <button onClick={props.onImportZip} title="打开之前用「保存」导出的项目 ZIP">从 ZIP 导入</button>
            <button onClick={props.onClose}>关闭</button>
          </div>
        </div>
        <p className="project-library-note">
          每部电影的项目都自动保存在这台电脑的浏览器里，换电影不会丢，点「打开」即可切回。
          「保存」导出的 ZIP 用于备份或换电脑。
        </p>
        {props.projects.length ? (
          <ul className="project-library-list">
            {props.projects.map((item) => (
              <li key={item.id} className={item.id === props.currentProjectId ? 'current' : ''}>
                <div className="project-library-info">
                  <strong>{item.title}</strong>
                  <span>
                    {item.duration ? `片长 ${secondsToTimecode(item.duration)}｜` : ''}
                    段落 {item.segmentCount}｜时间点 {item.frameCount}
                    {item.updatedAt ? `｜最后编辑 ${formatDate(item.updatedAt)}` : ''}
                  </span>
                </div>
                <div className="project-library-actions">
                  {item.id === props.currentProjectId ? (
                    <em>当前项目</em>
                  ) : (
                    <button onClick={() => props.onOpen(item.id)}>打开</button>
                  )}
                  <button className="danger-button" onClick={() => props.onDelete(item.id)}>删除</button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="project-library-empty">还没有保存过的项目。导入电影后，项目会自动出现在这里。</p>
        )}
      </div>
    </section>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
