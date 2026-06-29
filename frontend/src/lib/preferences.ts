export type ThemeMode = 'light' | 'dark'
export type UiDensity = 'compact' | 'comfortable' | 'spacious'
export type SkinId = 'default' | 'spacex' | 'nvidia' | 'binance'

export const SKIN_IDS: SkinId[] = ['default', 'spacex', 'nvidia', 'binance']

export const SETTINGS_EVENT = 'opencli:settings-changed'
export const THEME_KEY = 'theme'
export const DENSITY_KEY = 'uiDensity'
export const SKIN_KEY = 'uiSkin'
export const LANGUAGE_KEY = 'lang'
export const LANGUAGE_DEFAULT = 'zh'
export const DEFAULT_THEME: ThemeMode = 'dark'
export const DEFAULT_DENSITY: UiDensity = 'comfortable'
export const DEFAULT_SKIN: SkinId = 'default'

const STORAGE_KEYS = [THEME_KEY, DENSITY_KEY, SKIN_KEY, LANGUAGE_KEY] as const

type PreferenceKey = 'lang' | 'theme' | 'uiDensity' | 'uiSkin'

interface PreferenceChange {
  key: PreferenceKey
  value: string
}

function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value)
    }
  } catch {
    // ignore storage failures in readonly/private contexts
  }
}

function emitChanges(changes: PreferenceChange[]) {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { changes } }))
}

export function getThemePreference(): ThemeMode {
  const raw = safeGetItem(THEME_KEY)
  return raw === 'light' || raw === 'dark' ? raw : DEFAULT_THEME
}

export function getDensityPreference(): UiDensity {
  const raw = safeGetItem(DENSITY_KEY)
  return raw === 'compact' || raw === 'spacious' || raw === 'comfortable'
    ? raw
    : DEFAULT_DENSITY
}

export function getSkinPreference(): SkinId {
  const raw = safeGetItem(SKIN_KEY)
  return raw && (SKIN_IDS as string[]).includes(raw) ? (raw as SkinId) : DEFAULT_SKIN
}

export function getLanguagePreference(): string {
  return safeGetItem(LANGUAGE_KEY) ?? LANGUAGE_DEFAULT
}

export function setThemePreference(theme: ThemeMode) {
  safeSetItem(THEME_KEY, theme)
  emitChanges([{ key: 'theme', value: theme }])
}

export function setDensityPreference(density: UiDensity) {
  safeSetItem(DENSITY_KEY, density)
  emitChanges([{ key: 'uiDensity', value: density }])
}

export function setSkinPreference(skin: SkinId) {
  safeSetItem(SKIN_KEY, skin)
  emitChanges([{ key: 'uiSkin', value: skin }])
}

export function setLanguagePreference(lang: string) {
  safeSetItem(LANGUAGE_KEY, lang)
  emitChanges([{ key: 'lang', value: lang }])
}

export function clearStoredPreferences() {
  if (typeof localStorage === 'undefined') {
    return
  }
  for (const key of STORAGE_KEYS) {
    localStorage.removeItem(key)
  }
  emitChanges(STORAGE_KEYS.map((key) => ({ key, value: '' })))
}

export function applyThemePreference(theme: ThemeMode) {
  if (typeof document === 'undefined') {
    return
  }
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export function applyDensityPreference(density: UiDensity) {
  if (typeof document === 'undefined') {
    return
  }
  const attr = document.documentElement
  attr.setAttribute('data-ui-density', density)
}

export function applySkinPreference(skin: SkinId) {
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.setAttribute('data-skin', skin)
}
