import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

// AI 直连(BYOK)的两块纯逻辑:prompt 的 direct 分支措辞、OpenAI 兼容响应的文本提取。
// 固化住"纯字幕模式不许提 frames/、结构示例必须内联"这类措辞契约,防止后续改 prompt 时悄悄破坏直连。

async function loadModules() {
  const server = await createServer({ root: process.cwd(), logLevel: 'silent', server: { middlewareMode: true } })
  const framePackage = await server.ssrLoadModule('/src/lib/framePackage.ts')
  const directAi = await server.ssrLoadModule('/src/lib/directAi.ts')
  return { server, framePackage, directAi }
}

function makeProject(overrides = {}) {
  return {
    id: 'proj-test',
    projectTitle: '盗梦空间',
    filmTitle: '盗梦空间',
    sourceVideoName: 'Inception.2010.1080p.mkv',
    sourceVideoPath: '',
    duration: 120,
    frameInterval: 1,
    frames: [],
    segments: [],
    subtitles: [
      { id: 'sub_1', startTime: 1, endTime: 3, text: '我们得再深入一层。' },
    ],
    subtitlePath: 'inception.srt',
    audienceCurvePoints: [],
    ...overrides,
  }
}

test('direct 纯字幕模式:prompt 不提 frames/,带内联结构示例和无画面纪律', async () => {
  const { server, framePackage } = await loadModules()
  try {
    const prompt = framePackage.buildAiPrompt(makeProject(), 'zh-CN', undefined, true)
    assert.ok(prompt.includes('没有画面截图'), '开场应声明没有画面')
    assert.ok(prompt.includes('6. 没有画面'), '第 6 条应是无画面变体')
    assert.ok(!prompt.includes('frames/'), '纯字幕模式不许引用 frames/ 目录')
    assert.ok(!prompt.includes('压缩包'), '直连模式不许提压缩包')
    assert.ok(prompt.includes('movieIdentity'), '结构示例必须内联在任务说明末尾')
    assert.ok(!prompt.includes('抽帧间隔'), '纯字幕模式不该出现抽帧元数据')
  } finally {
    await server.close()
  }
})

test('direct 带拼图模式:prompt 声明拼图随消息附上并带拼图参数', async () => {
  const { server, framePackage } = await loadModules()
  try {
    const prompt = framePackage.buildAiPrompt(
      makeProject(),
      'zh-CN',
      { sheetCount: 3, tileIntervalSeconds: 40 },
      true,
    )
    assert.ok(prompt.includes('随消息附上的画面速览拼图'), '开场应声明拼图在消息里')
    assert.ok(prompt.includes('画面速览拼图：3 张'), '应带拼图数量元数据')
    assert.ok(prompt.includes('movieIdentity'), '结构示例必须内联')
    assert.ok(!prompt.includes('压缩包'), '直连模式不许提压缩包')
  } finally {
    await server.close()
  }
})

test('非 direct 路径措辞不受影响:ZIP 与免压缩包模式维持原样', async () => {
  const { server, framePackage } = await loadModules()
  try {
    const zipPrompt = framePackage.buildAiPrompt(makeProject(), 'zh-CN')
    assert.ok(zipPrompt.includes('压缩包'), 'ZIP 模式仍应提压缩包')
    assert.ok(!zipPrompt.includes('返回 JSON 的结构示例'), 'ZIP 模式结构示例仍走独立 schema.json')

    const loosePrompt = framePackage.buildAiPrompt(makeProject(), 'zh-CN', { sheetCount: 2, tileIntervalSeconds: 30 })
    assert.ok(loosePrompt.includes('我上传的文件'), '免压缩包模式仍是上传文件措辞')
    assert.ok(loosePrompt.includes('返回 JSON 的结构示例'), '免压缩包模式结构示例内联')
  } finally {
    await server.close()
  }
})

test('extractResponseText:接住字符串与分块数组两种 content', async () => {
  const { server, directAi } = await loadModules()
  try {
    assert.equal(
      directAi.extractResponseText({ choices: [{ message: { content: '{"a":1}' } }] }),
      '{"a":1}',
    )
    assert.equal(
      directAi.extractResponseText({
        choices: [{ message: { content: [{ type: 'text', text: '{"a"' }, { type: 'text', text: ':1}' }] } }],
      }),
      '{"a":1}',
    )
    // 非 text 分块(如图像回显)要被过滤而不是报错
    assert.equal(
      directAi.extractResponseText({
        choices: [{ message: { content: [{ type: 'image_url' }, { type: 'text', text: 'ok' }] } }],
      }),
      'ok',
    )
    assert.equal(directAi.extractResponseText(null), '')
    assert.equal(directAi.extractResponseText({ choices: [] }), '')
  } finally {
    await server.close()
  }
})
