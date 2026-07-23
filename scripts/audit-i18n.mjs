import { readFileSync, existsSync } from 'node:fs'
import process from 'node:process'

const failures = []
const catalogPath = 'src/i18n/catalog.en.ts'
const catalogSource = readFileSync(catalogPath, 'utf8')
const entryPattern = /^\s*("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*"),?\s*$/gm
const entries = []
let match
while ((match = entryPattern.exec(catalogSource))) {
  entries.push([JSON.parse(match[1]), JSON.parse(match[2])])
}

function fail(message) {
  failures.push(message)
}

if (entries.length < 850) fail(`Catalog unexpectedly small: ${entries.length} entries.`)

const seen = new Set()
for (const [key] of entries) {
  if (seen.has(key)) fail(`Duplicate catalog key: ${JSON.stringify(key)}`)
  seen.add(key)
}

const badKeyFragments = ['useState', 'readBalancedJson', 'function extractJsonText', '.replace(/']
const badValuePatterns = [
  /movie pulling/i,
  /pulling notes/i,
  /\bparagraphs?\b/i,
  /\[UNTRANSLATED\]/,
  /\uFFFD/,
  /pull tab/i,
  /pull slice/i,
  /\bbedding\b/i,
  /\bswim lane\b/i,
  /\u200B/,
]
const placeholderPattern = /\$\{([^{}]+)\}/g
const hanPattern = /[\u3400-\u4dbf\u4e00-\u9fff]/

function placeholders(value) {
  return [...value.matchAll(placeholderPattern)].map((item) => item[1]).sort()
}

for (const [key, value] of entries) {
  for (const fragment of badKeyFragments) {
    if (key.includes(fragment)) fail(`Scanner source fragment in catalog key: ${JSON.stringify(key)}`)
  }
  for (const pattern of badValuePatterns) {
    if (pattern.test(value)) fail(`Disallowed English catalog value: ${JSON.stringify(value)}`)
  }

  const keyPlaceholders = placeholders(key)
  const valuePlaceholders = placeholders(value)
  if (key.includes('${') && keyPlaceholders.length !== key.split('${').length - 1) {
    fail(`Unparseable placeholder in key: ${JSON.stringify(key)}`)
  }
  if (value.includes('${') && valuePlaceholders.length !== value.split('${').length - 1) {
    fail(`Unparseable placeholder in value: ${JSON.stringify(value)}`)
  }
  if (JSON.stringify(keyPlaceholders) !== JSON.stringify(valuePlaceholders)) {
    fail(`Placeholder mismatch for key: ${JSON.stringify(key)}`)
  }

  const prose = value.replace(placeholderPattern, '')
  if (hanPattern.test(prose)) {
    fail(`Han text remains outside a placeholder in English value: ${JSON.stringify(value)}`)
  }
}

const catalog = new Map(entries)
const required = new Map([
  ['\u62c9\u7247\u7b14\u8bb0', 'Lapian Notes'],
  ['\u672a\u547d\u540d\u6bb5\u843d', 'unnamed segment'],
  ['\u5f00\u59cb\u62bd\u5e27...', 'Start extracting frames...'],
  ['AI\u5206\u6790\u5305', 'AI analysis package'],
  ['ZIP \u6587\u4ef6', 'ZIP file'],
])
for (const [key, expected] of required) {
  if (catalog.get(key) !== expected) {
    fail(`Critical translation mismatch for ${JSON.stringify(key)}: ${JSON.stringify(catalog.get(key))}`)
  }
}

const requiredFiles = [
  'src/i18n/generated.ts',
  'tests/components/i18n-boundaries.test.ts',
  'tests/lib/export-runtime.test.mjs',
  'docs/localization.md',
]
for (const path of requiredFiles) {
  if (!existsSync(path)) fail(`Required localization artifact is missing: ${path}`)
}

const runtimeSource = readFileSync('src/i18n/index.tsx', 'utf8')
if (!runtimeSource.includes('lapian-notes.locale') && !readFileSync('src/i18n/core.ts', 'utf8').includes('lapian-notes.locale')) {
  fail('Persisted locale key is missing.')
}
if (!runtimeSource.includes('data-i18n-ignore')) fail('Runtime does not honor data-i18n-ignore boundaries.')

const generatedSource = readFileSync('src/i18n/generated.ts', 'utf8')
if (!generatedSource.includes('__LAPIAN_AUTHORED_TEXT_')) fail('Generated-output authored-text tokens are missing.')
if (!generatedSource.includes('protectProjectAuthoredText')) fail('Generated-output project protection is missing.')

const packageSource = readFileSync('src/lib/framePackage.ts', 'utf8')
if (!packageSource.includes("locale: Locale = 'zh-CN'")) fail('Package APIs lack a backward-compatible locale default.')
if (packageSource.includes('localizer.localize(JSON.stringify')) fail('Compatibility JSON must not be blanket-translated.')

// README.md 是中文主 README(项目决策:中文用户为主),不做英文纯净检查;
// README.en.md 允许出现少量中文(术语解释/中文版导航),只查过时声明
for (const path of ['README.en.md', 'docs/localization.md']) {
  const text = readFileSync(path, 'utf8')
  if (path !== 'README.en.md' && hanPattern.test(text)) fail(`Unexpected Han text in English documentation: ${path}`)
  if (/UI is currently Chinese-only/i.test(text)) fail(`Stale Chinese-only statement in ${path}`)
}

if (failures.length) {
  console.error(`Localization audit failed with ${failures.length} issue(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Localization audit passed: ${entries.length} catalog entries, placeholder parity verified.`)
