import { useRef, useState } from 'react'
import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import type { Project } from '../types'
import {
  VIDEO_PICKER_TYPES,
  loadVideoHandle,
  queryHandlePermission,
  requestHandlePermission,
  saveVideoHandle,
  supportsFilePicker,
} from '../lib/videoHandleStore'

// 影片文件的关联与播放:句柄接回、手动关联、播放器跳转与「播放本段」自动暂停。
// 从 App.tsx 拆出的第一块——只管"影片文件在不在手、播放器怎么动",不碰项目数据。

interface UseVideoPlaybackOptions {
  projectId: string
  expectedVideoName?: string
  setStatus: Dispatch<SetStateAction<string>>
}

export function useVideoPlayback({ projectId, expectedVideoName, setStatus }: UseVideoPlaybackOptions) {
  // File=用户直接选择的文件;string=本地转码后的 dev server 视频地址
  const videoFileRef = useRef<File | string | null>(null)
  // 系统文件选择器拿到的句柄,等新项目 id 生成后存进 IndexedDB
  const pendingVideoHandleRef = useRef<FileSystemFileHandle | null>(null)
  // 播放器用的视频地址(objectURL 或转码 URL),null=未关联影片
  const [videoPlayerUrl, setVideoPlayerUrl] = useState<string | null>(null)
  const playerRef = useRef<HTMLVideoElement>(null)
  // 「播放本段」的自动暂停点:到达后暂停一次并清除,不限制后续手动播放
  const playStopAtRef = useRef<number | null>(null)
  const relinkInputRef = useRef<HTMLInputElement>(null)

  function clearVideoFileReference() {
    videoFileRef.current = null
    setVideoPlayerUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
      return null
    })
  }

  function attachPlayableVideo(source: File | string) {
    setVideoPlayerUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
      return typeof source === 'string' ? source : URL.createObjectURL(source)
    })
  }

  function handleSeekTo(time: number, stopAt?: number) {
    const player = playerRef.current
    if (!player || !videoPlayerUrl) {
      setStatus('还没有关联影片文件:在右侧播放器面板点「关联影片文件」选择本片,即可点时间跳转播放。')
      return
    }
    playStopAtRef.current = stopAt !== undefined && stopAt > time ? stopAt : null
    player.currentTime = Math.max(0, time)
    void player.play().catch(() => undefined)
  }

  function handlePlayerTimeUpdate() {
    const stopAt = playStopAtRef.current
    const player = playerRef.current
    if (stopAt === null || !player) return
    if (player.currentTime >= stopAt) {
      player.pause()
      playStopAtRef.current = null
    }
  }

  // 「关联影片文件」:有存过的句柄就一键接回(最多点一次浏览器的"允许"),
  // 没有或失败再走文件选择;选择器选中的文件顺手把句柄存上,下次就免翻了
  async function handleRelinkClick() {
    const handle = await loadVideoHandle(projectId).catch(() => null)
    if (handle) {
      const permission = await requestHandlePermission(handle)
      if (permission === 'granted') {
        try {
          const file = await handle.getFile()
          videoFileRef.current = file
          attachPlayableVideo(file)
          setStatus(`已接回影片：${file.name}，可以播放和重新抽帧了。`)
          return
        } catch {
          // 原文件可能被移动或删除,走手动选择
        }
      }
    }
    if (supportsFilePicker()) {
      let picked: FileSystemFileHandle | undefined
      try {
        const handles = await window.showOpenFilePicker!({ types: VIDEO_PICKER_TYPES })
        picked = handles[0]
      } catch {
        return // 用户取消
      }
      if (!picked) return
      try {
        const file = await picked.getFile()
        void saveVideoHandle(projectId, picked).catch(() => undefined)
        videoFileRef.current = file
        attachPlayableVideo(file)
        setStatus(
          expectedVideoName && file.name !== expectedVideoName
            ? `已关联影片:${file.name}。注意和项目记录的「${expectedVideoName}」文件名不同,请确认是同一部电影。`
            : `已关联影片:${file.name},可以播放和重新抽帧了。`,
        )
      } catch {
        setStatus('读取所选文件失败，请重试。')
      }
      return
    }
    relinkInputRef.current?.click()
  }

  // 项目载入后尝试用存过的句柄自动接回影片:浏览器还记得授权时零点击,
  // 只剩"prompt"状态时给个提示引导去点「关联影片文件」
  async function tryRestoreVideoHandle(target: Project) {
    if (!target.sourceVideoName || videoFileRef.current) return
    const handle = await loadVideoHandle(target.id).catch(() => null)
    if (!handle) return
    const permission = await queryHandlePermission(handle)
    if (permission === 'granted') {
      try {
        const file = await handle.getFile()
        videoFileRef.current = file
        attachPlayableVideo(file)
        setStatus((current) => `${current ? `${current} ` : ''}影片已自动接回：${file.name}。`)
      } catch {
        // 原文件不在了,保持未关联状态
      }
      return
    }
    if (permission === 'prompt') {
      setStatus((current) => `${current ? `${current} ` : ''}上次的影片文件还记着,点右侧「关联影片文件」一键接回。`)
    }
  }

  // 项目恢复后重新关联影片:只接上播放和抽帧能力,不改动项目内容
  function handleRelinkVideo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    videoFileRef.current = file
    attachPlayableVideo(file)
    setStatus(
      expectedVideoName && file.name !== expectedVideoName
        ? `已关联影片:${file.name}。注意和项目记录的「${expectedVideoName}」文件名不同,请确认是同一部电影。`
        : `已关联影片:${file.name},可以播放和重新抽帧了。`,
    )
    e.target.value = ''
  }

  return {
    videoFileRef,
    pendingVideoHandleRef,
    videoPlayerUrl,
    playerRef,
    playStopAtRef,
    relinkInputRef,
    clearVideoFileReference,
    attachPlayableVideo,
    handleSeekTo,
    handlePlayerTimeUpdate,
    handleRelinkClick,
    tryRestoreVideoHandle,
    handleRelinkVideo,
  }
}
