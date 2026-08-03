import type { Plugin } from 'vite'

// dev server 本地接口:把浏览器的 AI 直连请求转发给用户自己选的 AI 服务商。
// 浏览器端因 CORS 无法直连多数 AI API(OpenAI 等不返回跨域头),只能由 Node 侧代办。
// key 由前端随请求传入、只存在用户本机 localStorage,本插件不落盘不记录。
// 协议统一走 OpenAI 兼容的 /chat/completions,DeepSeek/Kimi/OpenAI/Claude 全部兼容。

const REQUEST_TIMEOUT_MS = 10 * 60 * 1000
// 画面拼图 base64 后约几 MB,给足余量;超过按坏请求拒绝
const MAX_BODY_BYTES = 64 * 1024 * 1024

interface ChatProxyRequest {
  baseUrl?: string
  apiKey?: string
  model?: string
  messages?: unknown[]
  maxTokens?: number
}

export function aiProxyServerPlugin(): Plugin {
  return {
    name: 'lapian-ai-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ai/chat', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: '仅支持 POST' }))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        let aborted = false
        req.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_BODY_BYTES) {
            aborted = true
            res.statusCode = 413
            res.end(JSON.stringify({ error: '请求体过大' }))
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        req.on('end', () => {
          if (aborted) return
          void handleChat(Buffer.concat(chunks).toString('utf-8'), res)
        })
      })
    },
  }
}

async function handleChat(rawBody: string, res: import('node:http').ServerResponse): Promise<void> {
  let body: ChatProxyRequest
  try {
    body = JSON.parse(rawBody) as ChatProxyRequest
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: '请求体不是合法 JSON' }))
    return
  }
  const baseUrl = (body.baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!/^https:\/\//.test(baseUrl)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'baseUrl 必须是 https 地址' }))
    return
  }
  if (!body.apiKey || !body.model || !Array.isArray(body.messages)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: '缺少 apiKey、model 或 messages' }))
    return
  }

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.apiKey}`,
      },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        stream: false,
        ...(body.maxTokens ? { max_tokens: body.maxTokens } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await upstream.text()
    res.statusCode = upstream.status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(text)
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError'
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({
        error: isTimeout
          ? 'AI 服务响应超时(超过 10 分钟),请稍后重试'
          : `无法连接 AI 服务:${error instanceof Error ? error.message : String(error)}`,
      }),
    )
  }
}
