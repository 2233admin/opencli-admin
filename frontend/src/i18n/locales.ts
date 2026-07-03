import type { InitOptions } from 'i18next'
import type { Translations } from './zh'
import zh from './zh'
import en from './en'

interface LocaleMeta {
  code: string
  label: string
  nativeLabel: string
  rtl: boolean
  enabled: boolean
  translation: Translations
}

export const DEFAULT_LOCALE = 'zh'
export const LOCALE_KEY = 'lang'

export const LOCALE_CATALOG: LocaleMeta[] = [
  {
    code: 'zh',
    label: '中文',
    nativeLabel: '简体中文',
    rtl: false,
    enabled: true,
    translation: zh,
  },
  {
    code: 'en',
    label: 'English',
    nativeLabel: 'English',
    rtl: false,
    enabled: true,
    translation: en,
  },
  {
    code: 'ja',
    label: '日本語',
    nativeLabel: '日本語',
    rtl: false,
    enabled: false,
    translation: en,
  },
]

export const ENABLED_LOCALES = LOCALE_CATALOG.filter((item) => item.enabled)

type LocaleResources = NonNullable<InitOptions['resources']>

export const LOCALE_RESOURCE_MAP: LocaleResources = ENABLED_LOCALES.reduce(
  (acc, item) => {
    acc[item.code] = { translation: item.translation }
    return acc
  },
  {} as LocaleResources,
)

export function getLocaleMeta() {
  return LOCALE_CATALOG
}

export function getEnabledLocales(): LocaleMeta[] {
  return ENABLED_LOCALES
}

export function isEnabledLocale(code: string): code is string {
  return ENABLED_LOCALES.some((item) => item.code === code)
}

export function i18nInitOptions(initialLanguage: string): InitOptions {
  return {
    resources: LOCALE_RESOURCE_MAP,
    lng: isEnabledLocale(initialLanguage) ? initialLanguage : DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: ENABLED_LOCALES.map((locale) => locale.code),
    interpolation: { escapeValue: false },
  }
}
