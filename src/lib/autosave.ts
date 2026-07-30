import type { Project } from '../types'
import { hasMeaningfulProjectContent, normalizeLoadedProject } from './project'
import { loadLibraryProject, saveProjectToLibrary } from './projectStore'

// 自动保存的真身在 IndexedDB 项目库(projectStore),localStorage 只存一个几十字节的指针
// (哪个项目、什么时候存的)。旧版把整个项目 JSON 塞 localStorage 单 key,长片+深拆笔记
// 会顶到 ~5MB 配额,超限后自动保存静默失效;指针永远塞得下,恢复入口不再受配额威胁。

const legacyStorageKey = 'lapian-notes.autosave.v1'
const pointerStorageKey = 'lapian-notes.autosave-pointer.v2'

export interface AutosaveState {
  project: Project
  savedAt: string
}

interface AutosavePointer {
  projectId: string
  savedAt: string
}

export async function loadAutosave(): Promise<AutosaveState | null> {
  const migrated = await migrateLegacyAutosave()
  if (migrated) return migrated

  const pointer = readPointer()
  if (!pointer) return null
  try {
    const project = await loadLibraryProject(pointer.projectId)
    if (!project || !hasMeaningfulProjectContent(project)) {
      clearAutosave()
      return null
    }
    return { project, savedAt: pointer.savedAt }
  } catch {
    return null
  }
}

// 自动保存成功写入项目库后调用,记录"下次启动恢复哪个项目"
export function markAutosaveSaved(projectId: string, savedAt: string): void {
  const pointer: AutosavePointer = { projectId, savedAt }
  try {
    window.localStorage.setItem(pointerStorageKey, JSON.stringify(pointer))
  } catch {
    // 指针写不进去只影响"刷新后自动恢复",项目本体已在 IndexedDB,不打断主流程
  }
}

export function clearAutosave() {
  window.localStorage.removeItem(pointerStorageKey)
  window.localStorage.removeItem(legacyStorageKey)
}

// 老用户升级路径:旧版整项目 JSON 还在 localStorage 里,搬进项目库后换成指针。
// 搬失败(IndexedDB 不可用)时保留旧数据下次再试,本次仍返回项目照常恢复。
async function migrateLegacyAutosave(): Promise<AutosaveState | null> {
  const raw = readLocalStorage(legacyStorageKey)
  if (!raw) return null
  try {
    const state = JSON.parse(raw) as Partial<AutosaveState>
    const project = normalizeLoadedProject(state.project)
    if (!hasMeaningfulProjectContent(project)) {
      window.localStorage.removeItem(legacyStorageKey)
      return null
    }
    const savedAt = typeof state.savedAt === 'string' ? state.savedAt : new Date().toISOString()
    try {
      await saveProjectToLibrary(project)
      markAutosaveSaved(project.id, savedAt)
      window.localStorage.removeItem(legacyStorageKey)
    } catch {
      // 项目库暂时写不进去:旧数据原地保留,等下一次启动再迁
    }
    return { project, savedAt }
  } catch {
    window.localStorage.removeItem(legacyStorageKey)
    return null
  }
}

function readPointer(): AutosavePointer | null {
  const raw = readLocalStorage(pointerStorageKey)
  if (!raw) return null
  try {
    const pointer = JSON.parse(raw) as Partial<AutosavePointer>
    if (typeof pointer.projectId !== 'string' || !pointer.projectId) return null
    return {
      projectId: pointer.projectId,
      savedAt: typeof pointer.savedAt === 'string' ? pointer.savedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// 极端隐私模式下 localStorage 访问本身会抛 SecurityError,一律当没存过
function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
