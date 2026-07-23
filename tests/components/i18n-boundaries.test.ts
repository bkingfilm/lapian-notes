import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const component = (name: string) =>
  readFileSync(new URL(`../../src/components/${name}`, import.meta.url), 'utf8')

test('dynamic project, subtitle, story, and AI content has narrow translation boundaries', () => {
  const timeline = component('FrameTimeline.tsx')
  const inspector = component('InspectorPanel.tsx')
  const toolbar = component('Toolbar.tsx')
  const library = component('ProjectLibrary.tsx')

  assert.match(timeline, /data-i18n-ignore>\{selectedSegment\.title\}/)
  // segmentStorySummary/线名不再 ignore:它们是「枚举标签+authored 文本」混排,
  // 走动态词条捕获翻译,authored 部分原样回填(见 core.ts 递归翻译)
  assert.doesNotMatch(timeline, /data-i18n-ignore>\{segmentStorySummary/)
  assert.match(timeline, /data-i18n-ignore>\{card\.function\}/)
  assert.match(timeline, /data-i18n-ignore>\{shortLabel\(point\.title\)\}/)
  assert.match(inspector, /data-i18n-ignore>\{subtitle\.text\}/)
  assert.match(inspector, /data-i18n-ignore>\{line\.title\}/)
  assert.match(toolbar, /data-i18n-ignore>\{props\.project\.projectTitle\}/)
  assert.match(library, /data-i18n-ignore>\{item\.title\}/)
})

test('canonical interface terminology remains translatable', () => {
  const timeline = component('FrameTimeline.tsx')
  const inspector = component('InspectorPanel.tsx')
  const guide = component('BeginnerGuide.tsx')

  assert.doesNotMatch(timeline, /data-i18n-ignore>\{selectedSegment\.type\}/)
  assert.doesNotMatch(inspector, /term-hint[^>]*data-i18n-ignore/)
  assert.doesNotMatch(guide, /<(?:dt|dd) data-i18n-ignore/)
})
