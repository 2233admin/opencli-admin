import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { CircleAlert, CircleHelp, CircleX, Palette, RefreshCw } from 'lucide-react'
import Card from '../components/Card'
import PageHeader from '../components/PageHeader'
import { executeConversationNodeRun } from '../lib/nodeRunService'
import {
  clearStoredPreferences,
  SETTINGS_EVENT,
  getDensityPreference,
  getLanguagePreference,
  getThemePreference,
  setDensityPreference,
  setLanguagePreference,
  setThemePreference,
  ThemeMode,
  UiDensity,
  SkinId,
  applyThemePreference,
  applyDensityPreference,
  applySkinPreference,
  getSkinPreference,
  setSkinPreference,
  DEFAULT_THEME,
  DEFAULT_DENSITY,
  DEFAULT_SKIN,
  LANGUAGE_DEFAULT,
} from '../lib/preferences'
import { getEnabledLocales } from '../i18n/locales'
import { isTopologyLabEnabled } from '../labs/topology/flags'

const DENSITY_OPTIONS = [
  { value: 'compact' as const, token: 'settings.density.compact' },
  { value: 'comfortable' as const, token: 'settings.density.comfortable' },
  { value: 'spacious' as const, token: 'settings.density.spacious' },
] as const

const SKIN_OPTIONS: Array<{ value: SkinId; label: string; desc: string; accent: string; bg: string }> = [
  { value: 'default', label: 'OpenCLI', desc: '默认蓝 · 工程暗色', accent: '#2f7df6', bg: '#050708' },
  { value: 'spacex', label: 'SpaceX', desc: '纯黑极简 · 银白直角', accent: '#e4e4e7', bg: '#000000' },
  { value: 'nvidia', label: 'NVIDIA', desc: '黑绿科技 · 信号绿', accent: '#76b900', bg: '#080b06' },
  { value: 'binance', label: 'Binance', desc: '黑金交易 · 币安金', accent: '#f0b90b', bg: '#0b0e11' },
]

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const locales = getEnabledLocales()

  const [language, setLanguage] = useState<string>(getLanguagePreference())
  const [theme, setTheme] = useState<ThemeMode>(getThemePreference())
  const [density, setDensity] = useState<UiDensity>(getDensityPreference())
  const [skin, setSkin] = useState<SkinId>(getSkinPreference())
  const [conversationInput, setConversationInput] = useState('')
  const [conversationFeedback, setConversationFeedback] = useState('')
  const [conversationStatus, setConversationStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')

  const conversationMutation = useMutation({
    mutationFn: executeConversationNodeRun,
    onMutate: () => {
      setConversationStatus('loading')
      setConversationFeedback('')
    },
    onSuccess: (result) => {
      if (result.ok) {
        setConversationStatus('ok')
        setConversationFeedback(result.message)
        qc.invalidateQueries({ queryKey: ['sources'] })
        qc.invalidateQueries({ queryKey: ['tasks'] })
        qc.invalidateQueries({ queryKey: ['topology'] })
        toast.success(result.message)
        setConversationInput('')
      } else {
        setConversationStatus('err')
        setConversationFeedback(result.message)
        toast.error(result.message)
      }
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : t('settings.conversation.failed')
      setConversationStatus('err')
      setConversationFeedback(message)
      toast.error(message)
    },
  })

  const languageOptions = useMemo(
    () => locales.filter((locale) => locale.enabled),
    [locales],
  )

  const onLanguageChange = (next: string) => {
    setLanguage(next)
    i18n.changeLanguage(next)
    setLanguagePreference(next)
  }

  const onThemeChange = (next: ThemeMode) => {
    setTheme(next)
    setThemePreference(next)
    applyThemePreference(next)
  }

  const onDensityChange = (next: UiDensity) => {
    setDensity(next)
    setDensityPreference(next)
    applyDensityPreference(next)
  }

  const onSkinChange = (next: SkinId) => {
    setSkin(next)
    setSkinPreference(next)
    applySkinPreference(next)
  }

  const onResetPreferences = () => {
    clearStoredPreferences()
    setLanguage(LANGUAGE_DEFAULT)
    setTheme(DEFAULT_THEME)
    setDensity(DEFAULT_DENSITY)
    setSkin(DEFAULT_SKIN)
    i18n.changeLanguage(LANGUAGE_DEFAULT)
    applyThemePreference(DEFAULT_THEME)
    applyDensityPreference(DEFAULT_DENSITY)
    applySkinPreference(DEFAULT_SKIN)
  }

  useEffect(() => {
    const syncFromStorage = () => {
      setLanguage(getLanguagePreference())
      setTheme(getThemePreference())
      setDensity(getDensityPreference())
      setSkin(getSkinPreference())
    }

    syncFromStorage()

    if (typeof window !== 'undefined') {
      window.addEventListener(SETTINGS_EVENT, syncFromStorage)
      return () => window.removeEventListener(SETTINGS_EVENT, syncFromStorage)
    }
  }, [])

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
      />

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-100">{t('settings.language.title')}</h2>
          <p className="text-sm text-zinc-400">{t('settings.language.description')}</p>
          <div className="grid gap-2">
            {languageOptions.map((locale) => (
              <button
                key={locale.code}
                onClick={() => onLanguageChange(locale.code)}
                className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                  locale.code === language
                    ? 'border-primary-400/80 bg-primary-500/15 text-zinc-100'
                    : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-100'
                }`}
              >
                <span>{locale.label}</span>
                <span className="text-xs text-zinc-500">({locale.nativeLabel})</span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-100">{t('settings.theme.title')}</h2>
          <p className="text-sm text-zinc-400">{t('settings.theme.description')}</p>
          <div className="grid gap-2">
            <button
              onClick={() => onThemeChange('light')}
              className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                theme === 'light'
                  ? 'border-primary-400/80 bg-primary-500/15 text-zinc-100'
                  : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-100'
              }`}
            >
              <CircleHelp size={16} />
              {t('settings.theme.light')}
            </button>
            <button
              onClick={() => onThemeChange('dark')}
              className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                theme === 'dark'
                  ? 'border-primary-400/80 bg-primary-500/15 text-zinc-100'
                  : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-100'
              }`}
            >
              <CircleAlert size={16} />
              {t('settings.theme.dark')}
            </button>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-100">
            {t('settings.density.title')}
          </h2>
          <p className="text-sm text-zinc-400">{t('settings.density.description')}</p>
          <div className="grid gap-2">
            {DENSITY_OPTIONS.map((item) => (
              <button
                key={item.value}
                onClick={() => onDensityChange(item.value)}
                className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                  density === item.value
                    ? 'border-primary-400/80 bg-primary-500/15 text-zinc-100'
                    : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-100'
                }`}
              >
                <Palette size={16} />
                {t(item.token)}
              </button>
            ))}
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-100">设计风格</h2>
          <p className="text-sm text-zinc-400">切换整站配色皮肤，画布与控制台同步换肤。</p>
          <div className="grid grid-cols-2 gap-2">
            {SKIN_OPTIONS.map((item) => (
              <button
                key={item.value}
                onClick={() => onSkinChange(item.value)}
                className={`flex items-center gap-3 rounded border px-3 py-2.5 text-left transition ${
                  skin === item.value
                    ? 'border-primary-400/80 bg-primary-500/15'
                    : 'border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
                }`}
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded border border-white/15"
                  style={{ background: item.bg }}
                >
                  <span className="h-4 w-4 rounded-full" style={{ background: item.accent }} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-zinc-100">{item.label}</span>
                  <span className="block truncate text-xs text-zinc-500">{item.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-100">{t('settings.experimental.title')}</h2>
          <p className="text-sm text-zinc-400">{t('settings.experimental.description')}</p>
          <div className="grid gap-2 sm:flex">
            {isTopologyLabEnabled && (
              <Link
                to="/labs/topology"
                className="inline-flex items-center gap-2 rounded border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-300/20"
              >
                <RefreshCw size={16} />
                {t('settings.experimental.openTopology')}
              </Link>
            )}
            <Link
              to="/sources"
              className="inline-flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-white/20 hover:bg-white/[0.03]"
            >
              <CircleX size={16} />
              {t('settings.experimental.openSources')}
            </Link>
          </div>
        </Card>

        <Card className="space-y-4 border border-amber-400/25 bg-amber-500/5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-200">{t('settings.reset.title')}</h2>
          <p className="text-sm text-amber-200/85">{t('settings.reset.description')}</p>
          <button
            onClick={onResetPreferences}
            className="inline-flex items-center gap-2 rounded border border-amber-300/45 px-3 py-2 text-sm font-medium text-amber-100 hover:border-amber-200 hover:bg-amber-300/15"
          >
            <CircleHelp size={16} />
            {t('settings.reset.label')}
          </button>
        </Card>

        <Card className="space-y-4 border border-blue-300/25 bg-blue-500/8">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-200">{t('settings.conversation.title')}</h2>
          <p className="text-sm text-blue-200/85">{t('settings.conversation.description')}</p>
          <textarea
            value={conversationInput}
            onChange={(event) => setConversationInput(event.target.value)}
            rows={4}
            className="w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
            placeholder={t('settings.conversation.placeholder')}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">{t('settings.conversation.tip')}</p>
            <button
              type="button"
              onClick={() => conversationMutation.mutate(conversationInput.trim())}
              disabled={conversationStatus === 'loading' || !conversationInput.trim()}
              className="inline-flex items-center gap-2 rounded border border-blue-300/40 bg-blue-300/15 px-3 py-2 text-sm font-medium text-blue-100 hover:bg-blue-300/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {conversationStatus === 'loading' ? t('settings.conversation.running') : t('settings.conversation.run')}
            </button>
          </div>
          {conversationFeedback && (
            <p className={`text-xs ${conversationStatus === 'err' ? 'text-rose-300' : 'text-zinc-300'}`}>
              {conversationFeedback}
            </p>
          )}
        </Card>
      </section>
    </div>
  )
}
