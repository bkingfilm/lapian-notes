import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

async function loadPlugin() {
  const server = await createServer({ root: process.cwd(), logLevel: 'silent', server: { middlewareMode: true } })
  return { server, module: await server.ssrLoadModule('/subtitle-server-plugin.ts') }
}

test('subtitle finder pure helpers', async (t) => {
  const { server, module } = await loadPlugin()
  try {
    await t.test('extractKeywords splits Chinese and Latin tokens and drops noise', () => {
      const mixed = module.extractKeywords('盗梦空间.Inception.2010.1080p.BluRay.x264.mkv')
      assert.equal(mixed.assrt, '盗梦空间')
      assert.equal(mixed.english, 'Inception')
      assert.equal(mixed.hasChinese, true)

      const latinOnly = module.extractKeywords('The.Godfather.Part.II.720p.mp4')
      assert.equal(latinOnly.hasChinese, false)
      assert.equal(latinOnly.assrt, latinOnly.english)
      assert.equal(latinOnly.english, 'The Godfather Part')

      const chineseOnly = module.extractKeywords('霸王别姬.蓝光.mkv')
      assert.equal(chineseOnly.assrt, '霸王别姬')
      assert.equal(chineseOnly.english, '')
    })

    await t.test('providerOrder routes by title language and API key presence', () => {
      assert.deepEqual(module.providerOrder(true, false), ['assrt', 'opensubtitles-legacy'])
      assert.deepEqual(module.providerOrder(false, false), ['opensubtitles-legacy', 'assrt'])
      assert.deepEqual(module.providerOrder(false, true), ['opensubtitles-api', 'opensubtitles-legacy', 'assrt'])
      assert.deepEqual(module.providerOrder(true, true), ['assrt', 'opensubtitles-api', 'opensubtitles-legacy'])
    })

    await t.test('pruneAdBlocks removes ad cues but keeps dialogue and non-srt text', () => {
      const srt = [
        '1\n00:00:01,000 --> 00:00:05,000\nDo you want subtitles for any video?\n-=[ ai.OpenSubtitles.com ]=-',
        '2\n00:00:06,000 --> 00:00:08,000\nReal dialogue line',
        '3\n01:58:00,000 --> 01:58:04,000\nSupport us and become VIP member',
      ].join('\n\n')
      const pruned = module.pruneAdBlocks(srt)
      assert.ok(pruned.includes('Real dialogue line'))
      assert.ok(!pruned.includes('OpenSubtitles.com'))
      assert.ok(!pruned.includes('VIP member'))

      const clean = '1\n00:00:01,000 --> 00:00:02,000\nHello'
      assert.equal(module.pruneAdBlocks(clean), clean)

      const ass = '[Script Info]\nTitle: opensubtitles mention without timeline'
      assert.equal(module.pruneAdBlocks(ass), ass)
    })

    await t.test('decodeSubtitleText honors encoding hint and falls back sanely', () => {
      const cp1252 = Buffer.from([0x63, 0x61, 0x66, 0xe9])
      assert.equal(module.decodeSubtitleText(cp1252, 'CP1252'), 'café')
      // 没有 hint 时,西欧字节流不该被误判成 gb18030/big5
      assert.equal(module.decodeSubtitleText(cp1252), 'café')

      const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('你好', 'utf-8')])
      assert.equal(module.decodeSubtitleText(utf8Bom), '你好')

      // gb18030 编码的「中文字幕」,验证无 hint 时中文回退路径未被西欧分支挤掉
      const gbBytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xd7, 0xd6, 0xc4, 0xbb])
      assert.equal(module.decodeSubtitleText(gbBytes), '中文字幕')
    })

    await t.test('scoreLegacyEntry prefers srt, single CD, popular and version-matched subs', () => {
      const strong = module.scoreLegacyEntry(
        { SubFormat: 'srt', SubSumCD: '1', SubDownloadsCnt: '500000', MovieReleaseName: 'Movie.2010.1080p.BluRay.x264' },
        'Movie.2010.1080p.BluRay.x264.mkv',
      )
      const weak = module.scoreLegacyEntry(
        { SubFormat: 'vtt', SubSumCD: '2', SubDownloadsCnt: '3', MovieReleaseName: 'Movie.CAM' },
        'Movie.2010.1080p.BluRay.x264.mkv',
      )
      assert.ok(strong > weak)
    })
  } finally {
    await server.close()
  }
})
