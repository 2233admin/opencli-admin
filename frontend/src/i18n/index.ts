import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LOCALE, LOCALE_KEY, i18nInitOptions } from './locales'
import { getThemePreference, applyThemePreference } from '../lib/preferences'

const savedLanguage = (() => {
  try {
    return localStorage.getItem(LOCALE_KEY) ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
})()

i18n.use(initReactI18next).init(i18nInitOptions(savedLanguage))

if (typeof document !== 'undefined') {
  applyThemePreference(getThemePreference())
}

export { LOCALE_KEY, DEFAULT_LOCALE }

export default i18n
