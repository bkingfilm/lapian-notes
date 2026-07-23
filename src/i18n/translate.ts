import { englishCatalog } from './catalog.en'
import { createTranslator, type Locale } from './core'

const translateEnglish = createTranslator(englishCatalog)

export function translateText(source: string, locale: Locale): string {
  return locale === 'en' ? translateEnglish(source) : source
}
