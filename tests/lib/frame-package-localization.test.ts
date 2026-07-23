import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../../src/lib/framePackage.ts', import.meta.url), 'utf8')

test('package APIs accept optional locale parameters with Chinese defaults', () => {
  for (const name of [
    'exportProjectPackage',
    'buildAiChatMessage',
    'exportAiAnalysisPackage',
    'exportSegmentDeepDivePackage',
    'importProjectPackage',
  ]) {
    const start = source.indexOf(`function ${name}`)
    assert.notEqual(start, -1, `${name} must be exported`)
    const header = source.slice(start, source.indexOf('{', start))
    assert.ok(header.includes("locale: Locale = 'zh-CN'"), `${name} must default to zh-CN`)
  }
})

test('generated package prose protects authored values before localization', () => {
  assert.match(source, /protectProjectAuthoredText\(project, localizer\.protect\)/)
  assert.match(source, /protectSegmentAuthoredText\(segment, localizer\.protect\)/)
  assert.match(source, /localizer\.localize\(buildAiPromptSource\(protectedProject\)\)/)
  assert.match(source, /buildSegmentDeepDivePromptSource\(protectedProject, protectedSegment/)
})

test('schemas and package JSON remain compatibility data rather than translated prose', () => {
  assert.doesNotMatch(source, /localizer\.localize\(JSON\.stringify/)
  assert.match(source, /createTextEntry\('schema\.json', JSON\.stringify\(buildAiSchema\(\), null, 2\)\)/)
  assert.match(source, /createTextEntry\('project\.json', JSON\.stringify\(projectJson, null, 2\)\)/)
})

test('package filenames and picker labels use the selected locale', () => {
  assert.match(source, /translateText\(DEFAULT_PROJECT_NAME, locale\)/)
  assert.match(source, /translateText\(ZIP_FILE_LABEL, locale\)/)
  assert.match(source, /translateText\('AI\u5206\u6790\u5305', locale\)/)
})
