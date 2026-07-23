import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

function readStoredZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true)
    assert.equal(method, 0)
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength))
    entries.set(name, decoder.decode(bytes.slice(dataStart, dataStart + size)))
    offset = dataStart + size
  }
  return entries
}

test('English exports localize generated prose and preserve authored/schema data', async () => {
  const server = await createServer({ root: process.cwd(), logLevel: 'silent', server: { middlewareMode: true } })
  try {
    const markdownModule = await server.ssrLoadModule('/src/lib/markdown.ts')
    const packageModule = await server.ssrLoadModule('/src/lib/framePackage.ts')
    const projectModule = await server.ssrLoadModule('/src/lib/project.ts')
    const project = projectModule.createEmptyProject('\u57fa\u672c\u4fe1\u606f', '\u7528\u6237\u5f71\u7247')
    project.frames.push({
      id: 'frame-1', time: 0, src: 'data:image/png;base64,iVBORw0KGgo=', note: '\u7528\u6237\u7b14\u8bb0', isKeyFrame: true,
    })
    project.subtitles.push({ id: 'subtitle-1', startTime: 0, endTime: 1, text: '\u7528\u6237\u5b57\u5e55' })
    project.segments.push({
      id: 'segment-1', startFrameId: 'frame-1', endFrameId: 'frame-1', startTime: 0, endTime: 1,
      type: '\u5f00\u573a', title: '\u7528\u6237\u6bb5\u843d', color: '#000', notes: '\u7528\u6237\u7b14\u8bb0',
      createdAt: '', updatedAt: '',
    })

    const markdown = markdownModule.exportMarkdown(project, 'en')
    assert.ok(markdown.startsWith('# \u57fa\u672c\u4fe1\u606f\n'))
    assert.ok(markdown.includes('## Basic information'))
    assert.ok(markdown.includes('Film title: \u7528\u6237\u5f71\u7247'))
    assert.ok(markdown.includes('\u7528\u6237\u7b14\u8bb0'))
    assert.match(packageModule.buildAiChatMessage('en'), /^Unzip this ZIP/)

    let savedBlob
    globalThis.window = {
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async (blob) => { savedBlob = blob },
          close: async () => {},
        }),
      }),
    }
    await packageModule.exportAiAnalysisPackage(project, 'en')
    const entries = readStoredZipEntries(new Uint8Array(await savedBlob.arrayBuffer()))
    const readme = entries.get('README.md')
    const prompt = entries.get('prompt.md')
    const schema = entries.get('schema.json')

    assert.ok(readme.startsWith('# \u57fa\u672c\u4fe1\u606f AI analysis package\n'))
    assert.ok(readme.includes('## Files in the package'))
    assert.match(prompt, /^You are a film script teardown assistant\./)
    assert.ok(schema.includes('\u5f00\u573a'))
    assert.ok(entries.get('project.json').includes('\u7528\u6237\u5f71\u7247'))
  } finally {
    await server.close()
    delete globalThis.window
  }
})
