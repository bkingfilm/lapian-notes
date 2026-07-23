import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../../src/lib/markdown.ts', import.meta.url), 'utf8')

test('Markdown and screenplay exports accept a backward-compatible locale', () => {
  assert.match(source, /export function exportMarkdown\(project: Project, locale: Locale = 'zh-CN'\)/)
  assert.match(source, /export function exportScreenplayText\(project: Project, locale: Locale = 'zh-CN'\)/)
})

test('exports protect authored project data before localizing generated text', () => {
  assert.equal((source.match(/protectProjectAuthoredText\(project, localizer\.protect\)/g) ?? []).length, 2)
  assert.match(source, /localizer\.localize\(exportMarkdownSource\(protectedProject\)\)/)
  assert.match(source, /localizer\.localize\(exportScreenplayTextSource\(protectedProject\)\)/)
})
