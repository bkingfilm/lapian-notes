import { useEffect, useState } from 'react'
import { DIRECT_AI_PROVIDERS, loadDirectAiConfig, saveDirectAiConfig } from '../lib/directAi'
import type { DirectAiConfig } from '../lib/directAi'

// AI 直连(BYOK)配置弹窗:选服务商、填 key、选是否附带画面拼图。
// 真正的分析流程在 App.handleRunDirectAi 里,这里只负责收配置。

interface DirectAiModalProps {
  hasSubtitles: boolean
  running: boolean
  statusText: string
  onRun: (config: DirectAiConfig) => void
  onCancel: () => void
  onClose: () => void
}

export function DirectAiModal(props: DirectAiModalProps) {
  const [config, setConfig] = useState<DirectAiConfig>(() => loadDirectAiConfig())
  // 配置每次变化都落 localStorage,下次打开不用重填
  useEffect(() => {
    saveDirectAiConfig(config)
  }, [config])

  const provider = DIRECT_AI_PROVIDERS.find((item) => item.id === config.providerId)
  const isCustom = config.providerId === 'custom'
  const canRun =
    !props.running &&
    Boolean(config.apiKey.trim()) &&
    Boolean(config.baseUrl.trim()) &&
    Boolean(config.model.trim()) &&
    (config.sendFrames || props.hasSubtitles)

  function handleProviderChange(providerId: string) {
    const next = DIRECT_AI_PROVIDERS.find((item) => item.id === providerId)
    if (!next) return
    setConfig((prev) => ({
      ...prev,
      providerId,
      baseUrl: next.id === 'custom' ? prev.baseUrl : next.baseUrl,
      model: next.id === 'custom' ? prev.model : next.defaultModel,
      sendFrames: next.vision,
    }))
  }

  return (
    <section className="markdown-preview">
      <div className="markdown-preview-panel direct-ai-panel">
        <div className="markdown-preview-header">
          <strong>AI 直连分析</strong>
          <div>
            {props.running ? (
              <button onClick={props.onCancel}>停止</button>
            ) : (
              <button disabled={!canRun} onClick={() => props.onRun(config)}>开始分析</button>
            )}
            <button disabled={props.running} onClick={props.onClose}>关闭</button>
          </div>
        </div>
        <p className="ai-import-note">
          填一次你自己的 AI key，点「开始分析」自动完成全片分析，不用再打包上传。key 只存在这台电脑的浏览器里，不会上传到任何服务器。
        </p>
        <div className="direct-ai-form">
          <label>
            <span>服务商</span>
            <select
              value={config.providerId}
              disabled={props.running}
              onChange={(event) => handleProviderChange(event.target.value)}
            >
              {DIRECT_AI_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>API 地址</span>
            <input
              type="text"
              value={config.baseUrl}
              disabled={props.running || !isCustom}
              placeholder="https://api.example.com/v1"
              data-i18n-ignore
              onChange={(event) => setConfig((prev) => ({ ...prev, baseUrl: event.target.value }))}
            />
          </label>
          <label>
            <span>模型</span>
            <input
              type="text"
              value={config.model}
              disabled={props.running}
              data-i18n-ignore
              onChange={(event) => setConfig((prev) => ({ ...prev, model: event.target.value }))}
            />
          </label>
          <label>
            <span>API key</span>
            <input
              type="password"
              value={config.apiKey}
              disabled={props.running}
              autoComplete="off"
              data-i18n-ignore
              onChange={(event) => setConfig((prev) => ({ ...prev, apiKey: event.target.value }))}
            />
          </label>
          <label className="direct-ai-checkbox">
            <input
              type="checkbox"
              checked={config.sendFrames}
              disabled={props.running}
              onChange={(event) => setConfig((prev) => ({ ...prev, sendFrames: event.target.checked }))}
            />
            <span>附带画面拼图（需要模型支持看图；不勾则只按字幕分析）</span>
          </label>
          {!provider?.vision && config.sendFrames ? (
            <p className="direct-ai-hint">这个服务商的默认模型不支持看图，附带画面会报错；请取消勾选或换支持视觉的模型。</p>
          ) : null}
          {!config.sendFrames && !props.hasSubtitles ? (
            <p className="direct-ai-hint">纯字幕分析需要先导入字幕；本片还没有字幕，请勾选附带画面拼图。</p>
          ) : null}
        </div>
        {props.statusText ? (
          <div className={`ai-import-preview ${props.running ? 'ready' : 'warn'}`}>
            <span>{props.statusText}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
