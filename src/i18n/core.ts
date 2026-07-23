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

  return (source: string): string => {
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
        const value = values[index] ?? ''
        // Use a replacer callback so `$` in user-provided values is literal.
        translated = translated.replaceAll(placeholder, () => value)
      })
      return `${leading}${translated}${trailing}`
    }

    return source
  }
}
