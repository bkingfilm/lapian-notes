import test from 'node:test'

import assert from 'node:assert/strict'
import { englishCatalog } from '../../src/i18n/catalog.en.ts'

import { createTranslator, detectLocale, interpolate, normalizeLocale } from '../../src/i18n/core.ts'

test('normalizes supported locales', () => {

  assert.equal(normalizeLocale('en-US'), 'en')

  assert.equal(normalizeLocale('zh_CN'), 'zh-CN')

  assert.equal(normalizeLocale('fr-FR'), null)

})

test('persisted locale takes priority over browser locale', () => {

  assert.equal(detectLocale('zh-CN', ['en-US']), 'zh-CN')

  assert.equal(detectLocale('en', ['zh-CN']), 'en')

})

test('English is the fallback for unsupported browser locales', () => {

  assert.equal(detectLocale(null, ['de-DE']), 'en')

  assert.equal(detectLocale(null, []), 'en')

})

test('interpolates named placeholders and preserves missing values', () => {

  assert.equal(interpolate('Saved {count} frames', { count: 12 }), 'Saved 12 frames')

  assert.equal(interpolate('Saved {count} frames'), 'Saved {count} frames')

})

test('translates exact values while preserving surrounding whitespace', () => {

  const translate = createTranslator({ 保存: 'Save' })

  assert.equal(translate('  保存\n'), '  Save\n')

  assert.equal(translate('用户内容'), '用户内容')

})

test('translates template-literal-shaped dynamic messages', () => {

  const translate = createTranslator({

    '删除项目「${title}」？': 'Delete project “${title}”?',

  })

  assert.equal(translate('删除项目「Example」？'), 'Delete project “Example”?')

})

test('preserves empty and dollar-bearing dynamic values', () => {

  const translate = createTranslator({

    '删除项目「${title}」？': 'Delete project “${title}”?',

  })

  assert.equal(translate('删除项目「」？'), 'Delete project “”?')

  assert.equal(translate('删除项目「$& $1」？'), 'Delete project “$& $1”?')

})

test('replaces every occurrence of a dynamic placeholder', () => {

  const translate = createTranslator({

    '${name} 与 ${name}': '${name} and ${name}',

  })

  assert.equal(translate('甲 与 甲'), '甲 and 甲')

})

test('does not guess boundaries between adjacent dynamic placeholders', () => {

  const translate = createTranslator({ '${first}${last}': '${last}, ${first}' })

  assert.equal(translate('AdaLovelace'), 'AdaLovelace')

})

test('English catalog uses film-breakdown terminology and excludes source-code fragments', () => {
  const entries = Object.entries(englishCatalog)
  assert.equal(englishCatalog['\u5f00\u59cb\u62bd\u5e27...'], 'Start extracting frames...')
  assert.equal(englishCatalog['\u62c9\u7247\u7b14\u8bb0'], 'Lapian Notes')
  assert.equal(englishCatalog['\u672a\u547d\u540d\u6bb5\u843d'], 'unnamed segment')
  assert.equal(entries.some(([key]) => key.includes('useState') || key.includes('readBalancedJson')), false)
  assert.equal(entries.some(([, value]) => /movie pulling|pulling notes|\bparagraphs?\b/i.test(value)), false)
})
