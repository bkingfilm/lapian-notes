import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { detectLocale, LOCALE_STORAGE_KEY, type Locale } from './core'
import { I18nContext, useI18n } from './context'
import { translateText } from './translate'
import './i18n.css'

const textState = new WeakMap<Text, { source: string; rendered: string }>()
const attributeState = new WeakMap<Element, Map<string, { source: string; rendered: string }>>()
const translatedAttributes = ['title', 'placeholder', 'aria-label', 'alt'] as const

function isIgnoredBoundary(element: Element | null): boolean {
  return Boolean(element?.closest('[data-i18n-ignore], script, style, code, pre'))
}

function shouldIgnoreText(node: Text): boolean {
  const element = node.parentElement
  return Boolean(
    isIgnoredBoundary(element)
      || element?.closest('textarea, [contenteditable="true"]'),
  )
}

function localizeTextNode(node: Text, locale: Locale): void {
  if (shouldIgnoreText(node)) return
  const current = node.data
  const state = textState.get(node)
  const source = !state || (current !== state.rendered && current !== state.source) ? current : state.source
  const rendered = translateText(source, locale)
  textState.set(node, { source, rendered })
  if (current !== rendered) node.data = rendered
}

function localizeAttribute(element: Element, attribute: string, locale: Locale): void {
  if (isIgnoredBoundary(element) || !element.hasAttribute(attribute)) return
  const current = element.getAttribute(attribute) ?? ''
  const states = attributeState.get(element) ?? new Map<string, { source: string; rendered: string }>()
  const state = states.get(attribute)
  const source = !state || (current !== state.rendered && current !== state.source) ? current : state.source
  const rendered = translateText(source, locale)
  states.set(attribute, { source, rendered })
  attributeState.set(element, states)
  if (current !== rendered) element.setAttribute(attribute, rendered)
}

function localizeTree(root: Node, locale: Locale): void {
  if (root instanceof Text) {
    localizeTextNode(root, locale)
    return
  }
  if (root instanceof Element) {
    translatedAttributes.forEach((attribute) => localizeAttribute(root, attribute, locale))
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode()
  while (node) {
    if (node instanceof Text) localizeTextNode(node, locale)
    else if (node instanceof Element) {
      for (const attribute of translatedAttributes) {
        localizeAttribute(node, attribute, locale)
      }
    }
    node = walker.nextNode()
  }
}

function LanguageSwitcher() {
  const { locale, setLocale } = useI18n()
  return (
    <div className="language-switcher" data-i18n-ignore>
      <label htmlFor="application-language">Language</label>
      <select
        id="application-language"
        aria-label="Application language"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      </select>
    </div>
  )
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    } catch {
      // Storage can be unavailable in hardened or private browser contexts.
    }
    return detectLocale(stored, navigator.languages?.length ? navigator.languages : [navigator.language])
  })
  const localeRef = useRef(locale)

  useEffect(() => {
    localeRef.current = locale
  }, [locale])

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale)
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale)
    } catch {
      // Keep the in-memory preference when storage is unavailable.
    }
  }, [])

  const t = useCallback((source: string) => translateText(source, locale), [locale])
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = translateText('拉片笔记', locale)
    localizeTree(document.body, locale)

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') localizeTree(mutation.target, localeRef.current)
        if (mutation.type === 'attributes' && mutation.target instanceof Element && mutation.attributeName) {
          localizeAttribute(mutation.target, mutation.attributeName, localeRef.current)
        }
        mutation.addedNodes.forEach((node) => localizeTree(node, localeRef.current))
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...translatedAttributes],
    })

    return () => observer.disconnect()
  }, [locale])

  useEffect(() => {
    const originalAlert = window.alert.bind(window)
    const originalConfirm = window.confirm.bind(window)
    const originalPrompt = window.prompt.bind(window)
    window.alert = (message?: unknown) => originalAlert(translateText(String(message ?? ''), localeRef.current))
    window.confirm = (message?: string) => originalConfirm(translateText(String(message ?? ''), localeRef.current))
    window.prompt = (message?: string, defaultValue?: string) =>
      originalPrompt(translateText(String(message ?? ''), localeRef.current), defaultValue)

    return () => {
      window.alert = originalAlert
      window.confirm = originalConfirm
      window.prompt = originalPrompt
    }
  }, [])

  return (
    <I18nContext.Provider value={value}>
      {children}
      <LanguageSwitcher />
    </I18nContext.Provider>
  )
}
