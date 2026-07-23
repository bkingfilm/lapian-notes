import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeneratedTextLocalizer, protectProjectAuthoredText } from '../../src/i18n/generated.ts'
import { createEmptyProject } from '../../src/lib/project.ts'

test('generated labels localize while identical authored text remains unchanged', () => {
  const authoredTitle = '\u57fa\u672c\u4fe1\u606f'
  const localizer = createGeneratedTextLocalizer('en')
  const source = `## \u57fa\u672c\u4fe1\u606f\n- \u5f71\u7247\u540d\uff1a${localizer.protect(authoredTitle)}`

  assert.equal(localizer.localize(source), `## Basic information\n- Film title: ${authoredTitle}`)
})

test('protected project preserves authored text but leaves semantic enum values translatable', () => {
  const project = createEmptyProject('\u7528\u6237\u9879\u76ee', '\u7528\u6237\u5f71\u7247')
  project.segments.push({
    id: 'segment-1',
    startFrameId: '',
    endFrameId: '',
    startTime: 0,
    endTime: 10,
    type: '\u5f00\u573a',
    title: '\u7528\u6237\u6bb5\u843d',
    color: '#000000',
    notes: '\u7528\u6237\u7b14\u8bb0',
    createdAt: '',
    updatedAt: '',
  })
  const localizer = createGeneratedTextLocalizer('en')
  const protectedProject = protectProjectAuthoredText(project, localizer.protect)
  const source = [
    `## \u57fa\u672c\u4fe1\u606f`,
    `- \u5f71\u7247\u540d\uff1a${protectedProject.filmTitle}`,
    `- \u6bb5\u843d\u7c7b\u578b\uff1a${protectedProject.segments[0].type}`,
    protectedProject.segments[0].title,
    protectedProject.segments[0].notes,
  ].join('\n')
  const localized = localizer.localize(source)

  assert.match(localized, /Film title: \u7528\u6237\u5f71\u7247/)
  assert.ok(localized.includes('\u7528\u6237\u6bb5\u843d'))
  assert.ok(localized.includes('\u7528\u6237\u7b14\u8bb0'))
  assert.equal(protectedProject.segments[0].type, '\u5f00\u573a')
})

test('generated Markdown headings retain required spacing', () => {
  const localizer = createGeneratedTextLocalizer('en')
  const authoredTitle = '\u57fa\u672c\u4fe1\u606f'
  assert.equal(localizer.localize(`# ${localizer.protect(authoredTitle)}`), `# ${authoredTitle}`)
  assert.equal(localizer.localize('## \u57fa\u672c\u4fe1\u606f'), '## Basic information')
})
