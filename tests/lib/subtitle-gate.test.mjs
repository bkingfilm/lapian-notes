import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

// 字幕超长闸门:内嵌提取/手动导入的字幕明显长过影片时判定异常并支持修剪。
// 起因是 2026-08-06 实测:2 分钟片段封了全片 26 分钟字幕,台词密度和时间轴显示全被拉花。

async function loadModule() {
  const server = await createServer({ root: process.cwd(), logLevel: 'silent', server: { middlewareMode: true } })
  return { server, module: await server.ssrLoadModule('/src/lib/subtitleGate.ts') }
}

function makeSubs(pairs) {
  return pairs.map(([startTime, endTime], index) => ({ id: `s${index}`, startTime, endTime, text: `line ${index}` }))
}

test('subtitle overhang gate', async (t) => {
  const { server, module } = await loadModule()
  try {
    await t.test('clip with full-film subtitles is flagged', () => {
      const subs = makeSubs([[0, 4], [60, 65], [1590, 1595]])
      const overhang = module.subtitleOverhangSeconds(subs, 120)
      assert.ok(overhang !== null && overhang > 1400)
    })

    await t.test('feature film with wrong-version subtitles overrunning 7 minutes is flagged', () => {
      const subs = makeSubs([[0, 4], [5400 + 420 - 5, 5400 + 420]])
      assert.notEqual(module.subtitleOverhangSeconds(subs, 5400), null)
    })

    await t.test('normal tail credits overhang is tolerated', () => {
      const subs = makeSubs([[0, 4], [5400 + 90 - 5, 5400 + 90]])
      assert.equal(module.subtitleOverhangSeconds(subs, 5400), null)
    })

    await t.test('short clip small overhang is tolerated, proportional threshold', () => {
      // 60 秒片,字幕到 100 秒:超出 40 秒未过 min(360, 60) 阈值
      assert.equal(module.subtitleOverhangSeconds(makeSubs([[0, 100]]), 60), null)
      // 60 秒片,字幕到 130 秒:超出 70 秒过阈值
      assert.notEqual(module.subtitleOverhangSeconds(makeSubs([[0, 130]]), 60), null)
    })

    await t.test('empty subtitles or unknown duration never flag', () => {
      assert.equal(module.subtitleOverhangSeconds([], 120), null)
      assert.equal(module.subtitleOverhangSeconds(makeSubs([[0, 900]]), 0), null)
      assert.equal(module.subtitleOverhangSeconds(makeSubs([[0, 900]]), Number.NaN), null)
    })

    await t.test('trim keeps cues starting within duration', () => {
      const subs = makeSubs([[0, 4], [118, 123], [400, 405]])
      const trimmed = module.trimSubtitlesToDuration(subs, 120)
      assert.equal(trimmed.length, 2)
      assert.equal(trimmed[1].startTime, 118)
    })

    await t.test('lastSubtitleEndSeconds handles out-of-order cues', () => {
      const subs = makeSubs([[100, 105], [0, 4]])
      assert.equal(module.lastSubtitleEndSeconds(subs), 105)
    })
  } finally {
    await server.close()
  }
})
