import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

// 抽帧全黑探测:浏览器解不出画面时 drawImage 静默画出纯黑,一路抽到几千帧才发现白等一场。
// 起因是 2026-08-06 V2EX 主贴 14 楼的反馈「并不行,抽帧都是全黑的」。
// 判定按最亮像素走而不是平均亮度,否则黑底白字的片头 logo 会被当成解码失败。

async function loadModule() {
  const server = await createServer({ root: process.cwd(), logLevel: 'silent', server: { middlewareMode: true } })
  return { server, module: await server.ssrLoadModule('/src/lib/videoFrames.ts') }
}

const width = 320
const height = 180

function makeFrame(fill = 0) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill
    data[i + 1] = fill
    data[i + 2] = fill
    data[i + 3] = 255
  }
  return data
}

test('black frame detection', async (t) => {
  const { server, module } = await loadModule()
  try {
    await t.test('decode failure paints an all-zero frame', () => {
      assert.equal(module.isBlackPixelData(makeFrame(0)), true)
    })

    await t.test('near-zero noise from a lossy black frame still counts as black', () => {
      assert.equal(module.isBlackPixelData(makeFrame(2)), true)
    })

    await t.test('a genuinely dark but decoded frame is not black', () => {
      assert.equal(module.isBlackPixelData(makeFrame(3)), false)
    })

    await t.test('white-on-black title card is not treated as a decode failure', () => {
      const data = makeFrame(0)
      // 一行白字横穿画面中部,连续 40 个像素
      const start = (height / 2) * width * 4
      for (let i = start; i < start + 40 * 4; i += 4) {
        data[i] = 255
        data[i + 1] = 255
        data[i + 2] = 255
      }
      assert.equal(module.isBlackPixelData(data), false)
    })

    await t.test('an ordinary lit frame is not black', () => {
      assert.equal(module.isBlackPixelData(makeFrame(128)), false)
    })

    await t.test('a single bright channel is enough to clear the frame', () => {
      const data = makeFrame(0)
      // 只有蓝通道亮起来,按最亮像素判就该放过
      data[2] = 200
      assert.equal(module.isBlackPixelData(data), false)
    })
  } finally {
    await server.close()
  }
})
