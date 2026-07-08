import type { Project } from '../types'
import { compactProjectForPersistence, hasMeaningfulProjectContent, normalizeLoadedProject } from './project'
import { clearProjectFrameImages } from './frameStore'

// 项目库:所有电影项目自动保存在 IndexedDB,换电影不丢历史,随时切回。
// 帧图仍在 frameStore 按 projectId 隔离,这里只存文本数据(compact 后每部约几百 KB)。

const dbName = 'lapian-notes-project-store'
const dbVersion = 1
const storeName = 'projects'

export interface ProjectSummary {
  id: string
  title: string
  sourceVideoName?: string
  duration: number
  frameCount: number
  segmentCount: number
  updatedAt: string
}

export async function saveProjectToLibrary(project: Project): Promise<void> {
  if (!hasMeaningfulProjectContent(project)) return
  const db = await openDb()
  await runTransaction(db, 'readwrite', (store) => {
    store.put(compactProjectForPersistence(project))
  })
}

export async function listLibraryProjects(): Promise<ProjectSummary[]> {
  const db = await openDb()
  const projects = await new Promise<Project[]>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
    request.onsuccess = () => resolve(request.result as Project[])
    request.onerror = () => reject(request.error)
  })
  return projects
    .map((project) => ({
      id: project.id,
      title: project.projectTitle || project.filmTitle || '未命名项目',
      sourceVideoName: project.sourceVideoName,
      duration: project.duration ?? 0,
      frameCount: project.frames?.length ?? 0,
      segmentCount: project.segments?.length ?? 0,
      updatedAt: project.updatedAt ?? '',
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function loadLibraryProject(id: string): Promise<Project | null> {
  const db = await openDb()
  const raw = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  if (!raw) return null
  try {
    return normalizeLoadedProject(raw)
  } catch {
    return null
  }
}

export async function deleteLibraryProject(id: string): Promise<void> {
  const db = await openDb()
  await runTransaction(db, 'readwrite', (store) => {
    store.delete(id)
  })
  await clearProjectFrameImages(id).catch(() => undefined)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function runTransaction(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    work(transaction.objectStore(storeName))
  })
}
