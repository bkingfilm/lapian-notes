// 影片文件句柄持久化:把 File System Access API 的句柄存进 IndexedDB,
// 刷新或切换项目后不用重新翻文件夹找电影,最多点一次"允许"就接回播放和抽帧。
// 不支持该 API 的浏览器(Safari/Firefox)自动降级回 <input type="file"> 流程。

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  multiple?: boolean
}

interface PermissionCapableHandle extends FileSystemFileHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
  }
}

const dbName = 'lapian-notes-video-handles'
const dbVersion = 1
const storeName = 'handles'

export const VIDEO_PICKER_TYPES: FilePickerAcceptType[] = [
  {
    description: '视频文件',
    accept: { 'video/*': ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.rmvb', '.rm', '.wmv', '.flv', '.ts', '.m2ts'] },
  },
]

export function supportsFilePicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
}

export async function saveVideoHandle(projectId: string, handle: FileSystemFileHandle): Promise<void> {
  const db = await openDb()
  await run(db, 'readwrite', (store) => {
    store.put(handle, projectId)
  })
}

export async function loadVideoHandle(projectId: string): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get(projectId)
      request.onsuccess = () => resolve((request.result as FileSystemFileHandle | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return null
  }
}

export async function deleteVideoHandle(projectId: string): Promise<void> {
  try {
    const db = await openDb()
    await run(db, 'readwrite', (store) => {
      store.delete(projectId)
    })
  } catch {
    // 删除失败不影响主流程
  }
}

// 返回 'granted' | 'prompt' | 'denied';老实现没有 queryPermission 时按 granted 试
export async function queryHandlePermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const capable = handle as PermissionCapableHandle
  if (typeof capable.queryPermission !== 'function') return 'granted'
  try {
    return await capable.queryPermission({ mode: 'read' })
  } catch {
    return 'denied'
  }
}

// 必须在用户手势(点击)里调用,浏览器会弹一次"允许访问文件?"
export async function requestHandlePermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const capable = handle as PermissionCapableHandle
  if (typeof capable.requestPermission !== 'function') return 'granted'
  try {
    return await capable.requestPermission({ mode: 'read' })
  } catch {
    return 'denied'
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function run(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    work(transaction.objectStore(storeName))
  })
}
