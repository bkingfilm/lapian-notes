import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

// aiImport 是导回环节的第一道闸:输入来自各家 AI 的手写 JSON,格式千奇百怪。
// 这里固化住"包裹文本剥离、宽松 JSON 修复、英文枚举映射、片名闸门"这几类
// 已经在真实用户手里炸过或修过的行为,防止后续改动悄悄回退。

async function loadModule() {
  const server = await createServer({ root: process.cwd(), logLevel: 'silent', server: { middlewareMode: true } })
  return { server, module: await server.ssrLoadModule('/src/lib/aiImport.ts') }
}

function makeProject(overrides = {}) {
  const frames = Array.from({ length: 121 }, (_, index) => ({
    id: `frame_${String(index).padStart(5, '0')}`,
    index,
    time: index,
    src: '',
  }))
  return {
    id: 'proj-test',
    projectTitle: '盗梦空间',
    filmTitle: '盗梦空间',
    sourceVideoName: 'Inception.2010.1080p.mkv',
    sourceVideoPath: '',
    duration: 120,
    frameInterval: 1,
    frames,
    segments: [],
    ...overrides,
  }
}

test('aiImport handles messy real-world AI output', async (t) => {
  const { server, module } = await loadModule()
  const { importAiAnalysis, previewAiAnalysisImport } = module
  try {
    await t.test('extracts JSON from fenced code block surrounded by chatter', () => {
      const text = [
        '好的，这是我的分析结果：',
        '```json',
        '{ "overallStructure": "经典三幕结构", "writingLessons": ["开场即冲突"] }',
        '```',
        '希望对你有帮助！',
      ].join('\n')
      const result = importAiAnalysis(makeProject(), text)
      assert.equal(result.macroAnalysis?.overallStructure, '经典三幕结构')
      assert.deepEqual(result.macroAnalysis?.writingLessons, ['开场即冲突'])
    })

    await t.test('repairs full-width quotes and trailing commas', () => {
      const text = '{“overallStructure”: “双线并进”, }'
      const result = importAiAnalysis(makeProject(), text)
      assert.equal(result.macroAnalysis?.overallStructure, '双线并进')
    })

    await t.test('maps English enum synonyms back to Chinese enums', () => {
      const payload = JSON.stringify({
        segments: [
          {
            title: 'the peak',
            type: 'Climax',
            startTime: 10,
            endTime: 30,
            narrativeOrder: 'Flashback',
            screenplayBlocks: [{ type: 'Dialogue', text: 'hello there' }],
          },
          { title: 'build up', type: 'rising_action', start: 40, end: 60 },
        ],
      })
      const result = importAiAnalysis(makeProject(), payload)
      assert.equal(result.segments.length, 2)
      assert.equal(result.segments[0].type, '高潮')
      assert.equal(result.segments[0].narrativeOrder, '倒叙')
      assert.equal(result.segments[0].screenplayBlocks?.[0].type, '对白')
      // start/end 别名要等价于 startTime/endTime
      assert.equal(result.segments[1].startTime, 40)
      assert.equal(result.segments[1].endTime, 60)
      assert.equal(result.segments[1].type, '推进')
    })

    await t.test('counts unmappable segment types instead of silently defaulting', () => {
      const payload = JSON.stringify({
        segments: [
          { title: 'a', type: '高潮', startTime: 0, endTime: 10 },
          { title: 'b', type: 'setup', startTime: 10, endTime: 20 },
          { title: 'c', type: 'mystery-box', startTime: 20, endTime: 30 },
          { title: 'd', startTime: 30, endTime: 40 },
        ],
      })
      const preview = previewAiAnalysisImport(makeProject(), payload)
      assert.equal(preview.segmentCount, 4)
      // 中文枚举和可映射英文不算;没给 type 走默认也不算;只有认不出的算
      assert.equal(preview.unknownTypeCount, 1)
    })

    await t.test('rejects results that belong to a different movie unless skipped', () => {
      const payload = JSON.stringify({
        movieIdentity: { filmTitle: '教父' },
        overallStructure: '家族史诗',
      })
      assert.throws(() => importAiAnalysis(makeProject(), payload), (error) => error.name === 'MovieMismatchError')
      const result = importAiAnalysis(makeProject(), payload, { skipMovieCheck: true })
      assert.equal(result.macroAnalysis?.overallStructure, '家族史诗')
    })

    await t.test('accepts matching movie despite release-tag noise in names', () => {
      const payload = JSON.stringify({
        movieIdentity: { filmTitle: '盗梦空间（2010）中英双字 1080P' },
        overallStructure: '嵌套梦境',
      })
      const result = importAiAnalysis(makeProject(), payload)
      assert.equal(result.macroAnalysis?.overallStructure, '嵌套梦境')
    })

    await t.test('unwraps payload nested under result/data wrapper keys', () => {
      const payload = JSON.stringify({
        result: {
          segments: [{ title: 'wrapped', type: '开场', startTime: 0, endTime: 15 }],
        },
      })
      const result = importAiAnalysis(makeProject(), payload)
      assert.equal(result.segments.length, 1)
      assert.equal(result.segments[0].title, 'wrapped')
    })

    await t.test('refuses segment import before a timeline exists', () => {
      const empty = makeProject({ frames: [] })
      const payload = JSON.stringify([{ title: 'x', startTime: 0, endTime: 10 }])
      assert.throws(() => importAiAnalysis(empty, payload, { skipMovieCheck: true }), /时间轴/)
    })

    await t.test('normalizes audience curve points: clamp, drop untitled, sort', () => {
      const payload = JSON.stringify({
        audienceCurvePoints: [
          { time: 50, intensity: 250, title: 'late spike' },
          { time: 10, intensity: -5, title: 'early dip', valence: 999 },
          { time: 20, intensity: 60 },
        ],
      })
      const result = importAiAnalysis(makeProject(), payload)
      const points = result.audienceCurvePoints ?? []
      assert.equal(points.length, 2)
      assert.deepEqual(points.map((point) => point.title), ['early dip', 'late spike'])
      assert.equal(points[0].intensity, 0)
      assert.equal(points[0].valence, 100)
      assert.equal(points[1].intensity, 100)
    })

    await t.test('emotionPoints alias works like audienceCurvePoints', () => {
      const payload = JSON.stringify({
        emotionPoints: [{ time: 30, intensity: 70, title: 'via alias' }],
      })
      const result = importAiAnalysis(makeProject(), payload)
      assert.equal(result.audienceCurvePoints?.length, 1)
      assert.equal(result.audienceCurvePoints?.[0].title, 'via alias')
    })

    await t.test('segment deep dive: maps blocks, ignores empty patches', () => {
      const payload = JSON.stringify({
        segmentDeepDive: {
          segmentId: 'seg-1',
          title: '天台对峙',
          screenplayBlocks: [
            { type: 'Scene', text: 'INT. ROOFTOP - NIGHT' },
            { text: '' },
          ],
        },
      })
      const result = importAiAnalysis(makeProject(), payload, { skipMovieCheck: true })
      assert.equal(result.segmentDeepDive?.patch.title, '天台对峙')
      assert.equal(result.segmentDeepDive?.patch.screenplayBlocks?.length, 1)
      assert.equal(result.segmentDeepDive?.patch.screenplayBlocks?.[0].type, '场景')

      const emptyPayload = JSON.stringify({ segmentDeepDive: { segmentId: 'seg-1' } })
      const emptyResult = importAiAnalysis(makeProject(), emptyPayload, { skipMovieCheck: true })
      assert.equal(emptyResult.segmentDeepDive, undefined)
    })

    await t.test('throws a readable error on unparseable input', () => {
      assert.throws(() => importAiAnalysis(makeProject(), '这里一个 JSON 都没有'), /JSON/)
    })
  } finally {
    await server.close()
  }
})
