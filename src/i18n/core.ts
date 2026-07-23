export type Locale = 'en' | 'zh-CN'

export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_STORAGE_KEY = 'lapian-notes.locale'

export type TranslationCatalog = Readonly<Record<string, string>>

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase().replace('_', '-')
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  return null
}

export function detectLocale(
  storedLocale?: string | null,
  browserLocales: readonly string[] = [],
): Locale {
  const stored = normalizeLocale(storedLocale)
  if (stored) return stored

  for (const candidate of browserLocales) {
    const locale = normalizeLocale(candidate)
    if (locale === 'zh-CN') return locale
    if (locale === 'en') return locale
  }

  return DEFAULT_LOCALE
}

export function interpolate(
  template: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

type DynamicPattern = {
  parts: string[]
  replacement: string
  placeholders: string[]
}

function compileDynamicPattern(source: string, target: string): DynamicPattern | null {
  const parts: string[] = []
  const placeholders: string[] = []
  let cursor = 0

  while (true) {
    const start = source.indexOf('${', cursor)
    if (start < 0) break
    const end = source.indexOf('}', start + 2)
    if (end < 0 || end === start + 2) return null
    parts.push(source.slice(cursor, start))
    placeholders.push(source.slice(start, end + 1))
    cursor = end + 1
  }

  if (!placeholders.length) return null
  parts.push(source.slice(cursor))
  // Adjacent placeholders have no reliable boundary in a rendered string.
  if (parts.slice(1, -1).some((part) => !part)) return null
  return { parts, replacement: target, placeholders }
}

function literalLength(pattern: DynamicPattern): number {
  return pattern.parts.reduce((sum, part) => sum + part.length, 0)
}

function matchDynamicPattern(source: string, pattern: DynamicPattern): string[] | null {
  let cursor = 0
  const values: string[] = []

  for (let index = 0; index < pattern.placeholders.length; index += 1) {
    const prefix = pattern.parts[index]
    if (!source.startsWith(prefix, cursor)) return null
    cursor += prefix.length

    const suffix = pattern.parts[index + 1]
    if (!suffix) {
      values.push(source.slice(cursor))
      cursor = source.length
      continue
    }

    const next = source.indexOf(suffix, cursor)
    if (next < 0) return null
    values.push(source.slice(cursor, next))
    cursor = next
  }

  return source.slice(cursor) === pattern.parts.at(-1) ? values : null
}

export function createTranslator(catalog: TranslationCatalog) {
  const dynamicPatterns = Object.entries(catalog)
    .map(([source, target]) => compileDynamicPattern(source, target))
    .filter((value): value is DynamicPattern => Boolean(value))
    // 字面文字多的模式更具体,先试;否则「${n} 个分段」会抢走「全片分析、${n} 个分段」的活
    .sort((a, b) => literalLength(b) - literalLength(a))

  // 递归深度上限:捕获值和分句片段还会再翻一层,防环
  const MAX_DEPTH = 3

  function translate(source: string, depth: number): string {
    if (!source) return source

    const leading = source.match(/^\s*/)?.[0] ?? ''
    const trailing = source.match(/\s*$/)?.[0] ?? ''
    const core = source.slice(leading.length, source.length - trailing.length)
    const exact = catalog[core]
    if (exact !== undefined) return `${leading}${exact}${trailing}`

    for (const pattern of dynamicPatterns) {
      const values = matchDynamicPattern(core, pattern)
      if (!values) continue
      let translated = pattern.replacement
      pattern.placeholders.forEach((placeholder, index) => {
        // 捕获值本身常是中文片段(错误信息/枚举词),能翻则翻,翻不动原样保留
        const raw = values[index] ?? ''
        const value = depth < MAX_DEPTH ? translate(raw, depth + 1) : raw
        // Use a replacer callback so `$` in user-provided values is literal.
        translated = translated.replaceAll(placeholder, () => value)
      })
      return `${leading}${translated}${trailing}`
    }

    // 整句没词条时按句号切开逐句翻:状态栏消息是多个句子拼出来的,
    // 每个组成句各有词条。一句都没翻上就原样返回,避免瞎加空格。
    if (depth < MAX_DEPTH) {
      // 句号后紧跟的闭引号/闭括号并入前句,并在闭引号之后开新句,别把“……。”从中间剖开;
      // 英文句号只在后跟空格时算句界(避开 prompt.md、小数)
      const chunks = core.split(/(?<=[。！？；])(?![”」』）])|(?<=[。！？；][”」』）])|(?<=\. )/)
      if (chunks.length > 1) {
        const translatedChunks = chunks.map((chunk) => translate(chunk, depth + 1))
        if (translatedChunks.some((chunk, index) => chunk !== chunks[index])) {
          const joined = translatedChunks.reduce((acc, chunk) => {
            if (!acc) return chunk
            // 英文句子之间补空格;中文句子(未翻上的)保持原样紧排
            const needsSpace = /[.!?;:]["”'）)\]]*$/.test(acc.trimEnd()) && !/^\s/.test(chunk)
            return acc + (needsSpace ? ' ' : '') + chunk
          }, '')
          return `${leading}${joined}${trailing}`
        }
      }
    }

    return source
  }

  return (source: string): string => translate(source, 0)
}
