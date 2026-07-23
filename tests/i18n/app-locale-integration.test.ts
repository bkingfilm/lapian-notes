import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

test('App passes the active locale to every locale-aware export and import boundary', () => {
  assert.match(source, /const \{ locale, t \} = useI18n\(\)/)
  assert.match(source, /exportAiAnalysisPackage\(sourceProject, locale\)/)
  assert.match(source, /exportAiAnalysisPackage\(working, locale\)/)
  assert.match(source, /exportProjectPackage\(project, locale\)/)
  assert.match(source, /importProjectPackage\(file, locale\)/)
  assert.match(source, /exportMarkdown\(project, locale\)/)
  assert.match(source, /exportScreenplayText\(project, locale\)/)
  assert.match(source, /exportSegmentDeepDivePackage\(project, selectedSegment, locale\)/)
  assert.equal((source.match(/buildAiChatMessage\(locale\)/g) ?? []).length, 2)
})

test('generated download suffixes localize without translating authored project titles', () => {
  assert.match(source, /project\.projectTitle \|\| t\(DEFAULT_PROJECT_TITLE\)/)
  assert.match(source, /t\('\u7ed3\u6784\u56fe'\)/)
  assert.match(source, /t\('\u5b8c\u6574\u62c9\u7247\u957f\u56fe'\)/)
  assert.match(source, /t\('\u5267\u672c\u6b63\u6587'\)/)
})
