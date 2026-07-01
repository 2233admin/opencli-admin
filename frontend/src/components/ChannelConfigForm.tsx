import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteSourceCredential, listSourceCredentials, storeSourceCredential } from '../api/endpoints'

// ── helpers ──────────────────────────────────────────────────────────────────

const input =
  'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
const label = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
const hint = 'mt-1 text-xs text-gray-400'

function formFieldName(seed: string | undefined, fallback: string) {
  const slug = (seed ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `channel-config-${slug || fallback}`
}

function Field({
  label: l,
  hint: h,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className={label}>
        {l}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {h && <p className={hint}>{h}</p>}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  required,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  ariaLabel?: string
}) {
  return (
    <input
      aria-label={ariaLabel ?? placeholder ?? '配置文本'}
      name={formFieldName(placeholder, 'text')}
      className={input}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
    />
  )
}

function NumberInput({
  value,
  onChange,
  placeholder,
  min,
  ariaLabel,
}: {
  value: number | ''
  onChange: (v: number | '') => void
  placeholder?: string
  min?: number
  ariaLabel?: string
}) {
  return (
    <input
      aria-label={ariaLabel ?? placeholder ?? '配置数字'}
      name={formFieldName(placeholder, 'number')}
      type="number"
      className={input}
      value={value}
      min={min}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      placeholder={placeholder}
    />
  )
}

function SelectInput({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  ariaLabel?: string
}) {
  return (
    <select
      aria-label={ariaLabel ?? '配置选项'}
      name={formFieldName(ariaLabel ?? options[0]?.label, 'select')}
      className={input}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// Key-value pair list (for selectors / headers / params / args / defaults)
type KVPair = { key: string; value: string }

function KVList({
  pairs,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  pairs: KVPair[]
  onChange: (pairs: KVPair[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  const update = (i: number, field: 'key' | 'value', v: string) =>
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, [field]: v } : p)))

  const remove = (i: number) => onChange(pairs.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-2">
      {pairs.map((p, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            aria-label={keyPlaceholder ?? 'key'}
            name={`channel-config-key-${i}`}
            className={`${input} flex-1`}
            value={p.key}
            onChange={(e) => update(i, 'key', e.target.value)}
            placeholder={keyPlaceholder ?? 'key'}
          />
          <input
            aria-label={valuePlaceholder ?? 'value'}
            name={`channel-config-value-${i}`}
            className={`${input} flex-1`}
            value={p.value}
            onChange={(e) => update(i, 'value', e.target.value)}
            placeholder={valuePlaceholder ?? 'value'}
          />
          <button
            type="button"
            aria-label="删除参数行"
            onClick={() => remove(i)}
            className="p-1.5 text-red-400 hover:text-red-600 flex-shrink-0"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...pairs, { key: '', value: '' }])}
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mt-1"
      >
        <Plus size={12} /> Add row
      </button>
    </div>
  )
}

function kvToObj(pairs: KVPair[]): Record<string, string> {
  return Object.fromEntries(pairs.filter((p) => p.key).map((p) => [p.key, p.value]))
}

function objToKv(obj: Record<string, unknown> | undefined): KVPair[] {
  if (!obj) return []
  return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }))
}

// Store/rotate one secret in the encrypted credential store (backend.auth.
// AuthManager). Only usable once the source exists (sourceId set) — a
// not-yet-created source has nothing to key the store by, so the caller falls
// back to the plaintext env/inline fields until the first save.
function CredentialField({
  sourceId,
  keyName,
  label,
}: {
  sourceId: string
  keyName: string
  label: string
}) {
  const [stored, setStored] = useState(false)
  const [loading, setLoading] = useState(true)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listSourceCredentials(sourceId)
      .then((keys) => {
        if (!cancelled) setStored(keys.some((k) => k.key_name === keyName))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sourceId, keyName])

  const save = async () => {
    if (!value) return
    setBusy(true)
    try {
      await storeSourceCredential(sourceId, { key_name: keyName, secret: value })
      setStored(true)
      setValue('')
      toast.success(`${label} 已加密存储`)
    } catch {
      toast.error(`${label} 存储失败`)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await deleteSourceCredential(sourceId, keyName)
      setStored(false)
      toast.success(`${label} 已删除`)
    } catch {
      toast.error(`${label} 删除失败`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-2 items-center">
      <input
        type="password"
        aria-label={`${label}（加密存储）`}
        name={`channel-config-credential-${keyName}`}
        className={`${input} flex-1`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={loading ? '…' : stored ? '● 已加密存储 — 输入新值以覆盖' : label}
      />
      <button
        type="button"
        disabled={busy || !value}
        onClick={save}
        className="px-3 py-2 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-40 flex-shrink-0"
      >
        存储
      </button>
      {stored && (
        <button
          type="button"
          aria-label={`删除已存储的${label}`}
          disabled={busy}
          onClick={remove}
          className="p-1.5 text-red-400 hover:text-red-600 flex-shrink-0"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

// ── Per-channel config forms ──────────────────────────────────────────────────

function RSSConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <Field label={t('channelConfig.feedUrl')} required>
        <TextInput
          value={(config.feed_url as string) ?? ''}
          onChange={(v) => onChange({ ...config, feed_url: v })}
          placeholder="https://hnrss.org/frontpage"
          required
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('channelConfig.maxEntries')} hint={t('channelConfig.maxEntriesHint')}>
          <NumberInput
            value={(config.max_entries as number) ?? ''}
            onChange={(v) => onChange({ ...config, max_entries: v === '' ? undefined : v })}
            placeholder="50"
            min={1}
          />
        </Field>
        <Field label={t('channelConfig.timeout')} hint={t('channelConfig.timeoutHint')}>
          <NumberInput
            value={(config.timeout as number) ?? ''}
            onChange={(v) => onChange({ ...config, timeout: v === '' ? undefined : v })}
            placeholder="30"
            min={1}
          />
        </Field>
      </div>
    </div>
  )
}

function APIConfig({
  config,
  onChange,
  sourceId,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  sourceId?: string
}) {
  const { t } = useTranslation()
  const auth = (config.auth as Record<string, string>) ?? {}
  const authType = auth.type ?? 'none'
  const [params, setParams] = useState<KVPair[]>(objToKv(config.params as Record<string, unknown>))
  const [headers, setHeaders] = useState<KVPair[]>(objToKv(config.headers as Record<string, unknown>))

  const update = (patch: Partial<Record<string, unknown>>) => onChange({ ...config, ...patch })

  const updateParams = (pairs: KVPair[]) => {
    setParams(pairs)
    update({ params: kvToObj(pairs) })
  }

  const updateHeaders = (pairs: KVPair[]) => {
    setHeaders(pairs)
    update({ headers: kvToObj(pairs) })
  }

  const updateAuth = (patch: Partial<Record<string, string>>) =>
    update({ auth: { ...auth, ...patch } })

  return (
    <div className="space-y-3">
      <Field label={t('channelConfig.baseUrl')} required>
        <TextInput
          value={(config.base_url as string) ?? ''}
          onChange={(v) => update({ base_url: v })}
          placeholder="https://api.github.com"
          required
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('channelConfig.endpoint')} hint={t('channelConfig.endpointHint')} required>
          <TextInput
            value={(config.endpoint as string) ?? ''}
            onChange={(v) => update({ endpoint: v })}
            placeholder="/repos/owner/repo/issues"
            required
          />
        </Field>
        <Field label={t('channelConfig.method')}>
          <SelectInput
            value={(config.method as string) ?? 'GET'}
            onChange={(v) => update({ method: v })}
            options={['GET', 'POST', 'PUT', 'PATCH'].map((m) => ({ value: m, label: m }))}
          />
        </Field>
        <Field label={t('channelConfig.resultPath')} hint={t('channelConfig.resultPathHint')}>
          <TextInput
            value={(config.result_path as string) ?? ''}
            onChange={(v) => update({ result_path: v })}
            placeholder="data.items"
          />
        </Field>
      </div>

      <Field label={t('channelConfig.authType')}>
        <SelectInput
          value={authType}
          onChange={(v) => update({ auth: { type: v } })}
          options={[
            { value: 'none', label: t('channelConfig.authNone') },
            { value: 'bearer', label: t('channelConfig.authBearer') },
            { value: 'basic', label: t('channelConfig.authBasic') },
            { value: 'api_key', label: t('channelConfig.authApiKey') },
          ]}
        />
      </Field>

      {authType === 'bearer' && (
        <>
          <Field label={t('channelConfig.tokenEnvVar')} hint={t('channelConfig.tokenEnvVarHint')}>
            <TextInput
              value={auth.token_env ?? ''}
              onChange={(v) => updateAuth({ token_env: v })}
              placeholder="GITHUB_TOKEN"
            />
          </Field>
          {sourceId && (
            <Field label="或：加密存储（推荐，优先于上面的 env 配置）">
              <CredentialField sourceId={sourceId} keyName="token" label="Bearer Token" />
            </Field>
          )}
        </>
      )}
      {authType === 'basic' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('channelConfig.username')} hint={t('channelConfig.usernameHint')}>
              <TextInput
                value={auth.username ?? ''}
                onChange={(v) => updateAuth({ username: v })}
                placeholder="{{secret:API_USER}}"
              />
            </Field>
            <Field label={t('channelConfig.password')} hint={t('channelConfig.passwordHint')}>
              <TextInput
                value={auth.password ?? ''}
                onChange={(v) => updateAuth({ password: v })}
                placeholder="{{secret:API_PASS}}"
              />
            </Field>
          </div>
          {sourceId && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="或：加密存储用户名">
                <CredentialField sourceId={sourceId} keyName="username" label="用户名" />
              </Field>
              <Field label="或：加密存储密码（推荐）">
                <CredentialField sourceId={sourceId} keyName="password" label="密码" />
              </Field>
            </div>
          )}
        </>
      )}
      {authType === 'api_key' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('channelConfig.headerName')}>
              <TextInput
                value={auth.header ?? 'X-API-Key'}
                onChange={(v) => updateAuth({ header: v })}
                placeholder="X-API-Key"
              />
            </Field>
            <Field label={t('channelConfig.keyEnvVar')}>
              <TextInput
                value={auth.key_env ?? ''}
                onChange={(v) => updateAuth({ key_env: v })}
                placeholder="MY_API_KEY"
              />
            </Field>
          </div>
          {sourceId && (
            <Field label="或：加密存储（推荐，优先于上面的 env 配置）">
              <CredentialField sourceId={sourceId} keyName="key" label="API Key" />
            </Field>
          )}
        </>
      )}

      <Field label={t('channelConfig.queryParams')}>
        <KVList pairs={params} onChange={updateParams} keyPlaceholder="param" valuePlaceholder="value" />
      </Field>
      <Field label={t('channelConfig.extraHeaders')} hint={t('channelConfig.extraHeadersHint')}>
        <KVList pairs={headers} onChange={updateHeaders} keyPlaceholder="Header-Name" valuePlaceholder="value" />
      </Field>
      <Field label={t('channelConfig.timeout')}>
        <NumberInput
          value={(config.timeout as number) ?? ''}
          onChange={(v) => update({ timeout: v === '' ? undefined : v })}
          placeholder="30"
          min={1}
        />
      </Field>
    </div>
  )
}

function WebScraperConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const [selectors, setSelectors] = useState<KVPair[]>(
    objToKv(config.selectors as Record<string, unknown>),
  )

  const update = (patch: Partial<Record<string, unknown>>) => onChange({ ...config, ...patch })

  const updateSelectors = (pairs: KVPair[]) => {
    setSelectors(pairs)
    update({ selectors: kvToObj(pairs) })
  }

  return (
    <div className="space-y-3">
      <Field label={t('channelConfig.url')} required>
        <TextInput
          value={(config.url as string) ?? ''}
          onChange={(v) => update({ url: v })}
          placeholder="https://news.ycombinator.com"
          required
        />
      </Field>
      <Field
        label={t('channelConfig.listSelector')}
        hint={t('channelConfig.listSelectorHint')}
      >
        <TextInput
          value={(config.list_selector as string) ?? ''}
          onChange={(v) => update({ list_selector: v })}
          placeholder=".athing"
        />
      </Field>
      <Field label={t('channelConfig.fieldSelectors')} hint={t('channelConfig.fieldSelectorsHint')} required>
        <KVList
          pairs={selectors}
          onChange={updateSelectors}
          keyPlaceholder="field name"
          valuePlaceholder="CSS selector"
        />
      </Field>
      <Field label={t('channelConfig.timeout')}>
        <NumberInput
          value={(config.timeout as number) ?? ''}
          onChange={(v) => update({ timeout: v === '' ? undefined : v })}
          placeholder="30"
          min={1}
        />
      </Field>
    </div>
  )
}

function CLIConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const cmdArr = (config.command as string[]) ?? []
  const [cmdStr, setCmdStr] = useState(cmdArr.join(' '))
  const [defaults, setDefaults] = useState<KVPair[]>(
    objToKv(config.defaults as Record<string, unknown>),
  )
  const [envVars, setEnvVars] = useState<KVPair[]>(
    objToKv(config.env as Record<string, unknown>),
  )

  const update = (patch: Partial<Record<string, unknown>>) => onChange({ ...config, ...patch })

  const updateCmd = (v: string) => {
    setCmdStr(v)
    // Split respecting quoted strings
    const parts = v.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
    update({ command: parts })
  }

  const updateDefaults = (pairs: KVPair[]) => {
    setDefaults(pairs)
    update({ defaults: kvToObj(pairs) })
  }

  const updateEnv = (pairs: KVPair[]) => {
    setEnvVars(pairs)
    update({ env: kvToObj(pairs) })
  }

  return (
    <div className="space-y-3">
      <Field label={t('channelConfig.binary')} hint={t('channelConfig.binaryHint')} required>
        <TextInput
          value={(config.binary as string) ?? ''}
          onChange={(v) => update({ binary: v })}
          placeholder="curl"
          required
        />
      </Field>
      <Field
        label={t('channelConfig.arguments')}
        hint={t('channelConfig.argumentsHint')}
        required
      >
        <TextInput
          value={cmdStr}
          onChange={updateCmd}
          placeholder="-s https://api.example.com/data/{{page}}"
          required
        />
      </Field>
      <Field label={t('channelConfig.outputFormat')}>
        <SelectInput
          value={(config.output_format as string) ?? 'json'}
          onChange={(v) => update({ output_format: v })}
          options={[
            { value: 'json', label: t('channelConfig.outputJson') },
            { value: 'text', label: t('channelConfig.outputText') },
          ]}
        />
      </Field>
      <Field label={t('channelConfig.templateDefaults')} hint={t('channelConfig.templateDefaultsHint')}>
        <KVList pairs={defaults} onChange={updateDefaults} keyPlaceholder="key" valuePlaceholder="default value" />
      </Field>
      <Field label={t('channelConfig.envVars')}>
        <KVList pairs={envVars} onChange={updateEnv} keyPlaceholder="VAR_NAME" valuePlaceholder="value" />
      </Field>
      <Field label={t('channelConfig.timeout')}>
        <NumberInput
          value={(config.timeout as number) ?? ''}
          onChange={(v) => update({ timeout: v === '' ? undefined : v })}
          placeholder="60"
          min={1}
        />
      </Field>
    </div>
  )
}

// ── OpenCLI presets ──────────────────────────────────────────────────────────

type Preset = {
  label: string
  group: string
  site: string
  command: string
  args: Record<string, string>
  /** Placeholder/description shown for each arg value input */
  argHints?: Record<string, string>
}

const OPENCLI_PRESETS: Preset[] = [
  // ── 国内 (Chinese, login required) ───────────────────────────────────────
  // Fields: rank, title, author, likes, url
  { group: '🇨🇳 国内', label: '小红书 · 搜索', site: 'xiaohongshu', command: 'search',
    args: { keyword: '', limit: '20' },
    argHints: { keyword: '搜索关键词（必填）', limit: '返回条数（默认 20）' } },
  // Fields: id, title, type, likes, url
  { group: '🇨🇳 国内', label: '小红书 · 用户笔记', site: 'xiaohongshu', command: 'user',
    args: { id: '', limit: '20' },
    argHints: { id: '用户 ID（从主页 URL 获取，必填）', limit: '返回条数（默认 20）' } },
  // Fields: rank, title, author, play, danmaku
  { group: '🇨🇳 国内', label: 'Bilibili · 热门视频', site: 'bilibili', command: 'hot',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: rank, title, author, score, url
  { group: '🇨🇳 国内', label: 'Bilibili · 排行榜', site: 'bilibili', command: 'ranking',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: id, author, text, likes, url
  { group: '🇨🇳 国内', label: 'Bilibili · 关注动态', site: 'bilibili', command: 'dynamic',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: rank, title, author, plays, url
  { group: '🇨🇳 国内', label: 'Bilibili · 收藏夹', site: 'bilibili', command: 'favorite',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: rank, title, plays, likes, date, url
  { group: '🇨🇳 国内', label: 'Bilibili · 用户视频', site: 'bilibili', command: 'user-videos',
    args: { uid: '', limit: '20' },
    argHints: { uid: 'UP 主 UID（从个人主页 URL 获取，必填）', limit: '返回条数（默认 20）' } },
  // Fields: rank, title, heat, answers, url
  { group: '🇨🇳 国内', label: '知乎 · 热榜', site: 'zhihu', command: 'hot',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: rank, author, votes, content
  { group: '🇨🇳 国内', label: '知乎 · 问题回答', site: 'zhihu', command: 'question',
    args: { id: '', limit: '10' },
    argHints: { id: '问题 ID（从 URL 中获取，如 /question/123456789）', limit: '返回答案数（默认 10）' } },
  // Fields: rank, word(→title), hot_value, category, label, url
  { group: '🇨🇳 国内', label: '微博 · 热搜', site: 'weibo', command: 'hot',
    args: {},
    argHints: {} },
  // Fields: rank, title, score, author, url
  { group: '🇨🇳 国内', label: 'V2EX · 热门话题', site: 'v2ex', command: 'hot',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: rank, title, score, author, url
  { group: '🇨🇳 国内', label: 'V2EX · 最新话题', site: 'v2ex', command: 'latest',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: rank, author, text(→content), likes, url
  { group: '🇨🇳 国内', label: '雪球 · 动态', site: 'xueqiu', command: 'hot',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: rank, symbol, name(→title), price, changePercent, heat
  { group: '🇨🇳 国内', label: '雪球 · 热门股票', site: 'xueqiu', command: 'hot-stock',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20，最大 50）' } },
  // Fields: name(→title), symbol, price, changePercent, marketCap
  { group: '🇨🇳 国内', label: '雪球 · 股票行情', site: 'xueqiu', command: 'stock',
    args: { symbol: '601318' },
    argHints: { symbol: 'A 股代码（如 601318 中国平安）或港股（如 00700 腾讯）' } },
  // Fields: rank, title, price, mall, comments, url
  { group: '🇨🇳 国内', label: '什么值得买 · 搜索', site: 'smzdm', command: 'search',
    args: { keyword: '', limit: '20' },
    argHints: { keyword: '搜索关键词（必填）', limit: '返回条数（默认 20）' } },
  // Fields: name(→title), salary, company, area, experience, degree, skills, boss, url
  { group: '🇨🇳 国内', label: 'Boss直聘 · 职位搜索', site: 'boss', command: 'search',
    args: { keyword: '', city: '101010100', limit: '20' },
    argHints: { keyword: '职位名称或关键词（必填，如 "前端工程师"）', city: '城市代码（101010100=北京，101020100=上海，101280100=广州，101280600=深圳）', limit: '返回条数（默认 20）' } },
  // Fields: rank, name(→title), type, score, price, url
  { group: '🇨🇳 国内', label: '携程 · 目的地搜索', site: 'ctrip', command: 'search',
    args: { query: '', limit: '15' },
    argHints: { query: '目的地或景点名称（必填，如 "三亚"）', limit: '返回条数（默认 15）' } },
  // Fields: title, author, description(→content), subscribers, episodes, updated
  { group: '🇨🇳 国内', label: '小宇宙 · 播客信息', site: 'xiaoyuzhou', command: 'podcast',
    args: { id: '' },
    argHints: { id: '播客 ID（从 URL 获取，如 5e280fbd418a84a0463d3e3b）' } },
  // Fields: eid, title, duration, plays, date
  { group: '🇨🇳 国内', label: '小宇宙 · 单集列表', site: 'xiaoyuzhou', command: 'podcast-episodes',
    args: { id: '', limit: '15' },
    argHints: { id: '播客 ID（同上）', limit: '返回集数（最多 15，受 SSR 限制）' } },

  // ── Public (no login required) ────────────────────────────────────────────
  // Fields: rank, title, score, author, comments, url
  { group: '🌐 Public', label: 'Hacker News · top stories', site: 'hackernews', command: 'top',
    args: { limit: '20' },
    argHints: { limit: '返回条数（1–500）' } },
  // Fields: rank, title, description, url
  { group: '🌐 Public', label: 'BBC · latest news', site: 'bbc', command: 'news',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: rank, title, date, section, url
  { group: '🌐 Public', label: 'Reuters · search', site: 'reuters', command: 'search',
    args: { query: 'technology', limit: '20' },
    argHints: { query: '搜索关键词（必填）', limit: '返回条数（默认 20）' } },

  // ── Global (login required) ───────────────────────────────────────────────
  // Fields: rank, topic(→title), tweets
  { group: '🌍 Global', label: 'Twitter/X · trending', site: 'twitter', command: 'trending',
    args: {},
    argHints: {} },
  // Fields: id, author, text(→content), likes, retweets, replies, views, created_at, url
  { group: '🌍 Global', label: 'Twitter/X · timeline', site: 'twitter', command: 'timeline',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: id, author, text(→content), likes, views, url
  { group: '🌍 Global', label: 'Twitter/X · search', site: 'twitter', command: 'search',
    args: { query: '', limit: '20' },
    argHints: { query: '搜索关键词，支持运算符（必填，如 "AI lang:en"）', limit: '返回条数（默认 20）' } },
  // Fields: title, subreddit, score, comments, url
  { group: '🌍 Global', label: 'Twitter/X · bookmarks', site: 'twitter', command: 'bookmarks',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: title, subreddit, author, upvotes, comments, url
  { group: '🌍 Global', label: 'Reddit · frontpage', site: 'reddit', command: 'frontpage',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: rank, title, subreddit, score, comments, url
  { group: '🌍 Global', label: 'Reddit · hot', site: 'reddit', command: 'hot',
    args: { limit: '20' },
    argHints: { subreddit: '子版块名称（可选，留空则为全站热门，如 "programming"）', limit: '返回条数（默认 20）' } },
  // Fields: title, subreddit, score, comments, url
  { group: '🌍 Global', label: 'Reddit · saved posts', site: 'reddit', command: 'saved',
    args: { limit: '20' },
    argHints: { limit: '返回条数（默认 20）' } },
  // Fields: rank, title, channel(→author), views, duration, url
  { group: '🌍 Global', label: 'YouTube · search', site: 'youtube', command: 'search',
    args: { query: 'technology', limit: '10' },
    argHints: { query: '搜索关键词（必填）', limit: '返回条数（最多 10）' } },
  // Fields: rank, title, company, location, listed(→published_at), salary, url
  { group: '🌍 Global', label: 'LinkedIn · job search', site: 'linkedin', command: 'search',
    args: { query: 'AI engineer', limit: '20' },
    argHints: { query: '职位名称或关键词（必填）', limit: '返回条数（默认 20）' } },
  // Fields: symbol, name(→title), price, change, changePercent, open, high, low, volume, marketCap
  { group: '🌍 Global', label: 'Yahoo Finance · quote', site: 'yahoo-finance', command: 'quote',
    args: { symbol: 'AAPL' },
    argHints: { symbol: '股票代码（如 AAPL、GOOGL、TSLA、SPY）' } },
  // Fields: symbol, name(→title), price, change, changePct, peRatio, eps, marketCap
  { group: '🌍 Global', label: 'Barchart · stock quote', site: 'barchart', command: 'quote',
    args: { symbol: 'AAPL' },
    argHints: { symbol: '股票代码（如 AAPL、SPY、QQQ）' } },
]

const PRESET_DEFAULT = OPENCLI_PRESETS[0]

// ── Derived lookup structures ─────────────────────────────────────────────────

const SITE_LABELS: Record<string, string> = {
  xiaohongshu: '小红书', bilibili: 'Bilibili', zhihu: '知乎',
  weibo: '微博', v2ex: 'V2EX', xueqiu: '雪球',
  smzdm: '什么值得买', boss: 'Boss直聘', ctrip: '携程', xiaoyuzhou: '小宇宙',
  hackernews: 'Hacker News', bbc: 'BBC', reuters: 'Reuters',
  twitter: 'Twitter/X', reddit: 'Reddit', youtube: 'YouTube',
  linkedin: 'LinkedIn', 'yahoo-finance': 'Yahoo Finance', barchart: 'Barchart',
}

// site → ordered list of presets
const COMMANDS_BY_SITE: Record<string, Preset[]> = {}
for (const p of OPENCLI_PRESETS) {
  if (!COMMANDS_BY_SITE[p.site]) COMMANDS_BY_SITE[p.site] = []
  COMMANDS_BY_SITE[p.site].push(p)
}

// Groups for the site <optgroup> — order matches preset group order
const SITE_GROUPS = [
  { label: '🇨🇳 国内', sites: ['xiaohongshu','bilibili','zhihu','weibo','v2ex','xueqiu','smzdm','boss','ctrip','xiaoyuzhou'] },
  { label: '🌐 Public', sites: ['hackernews','bbc','reuters'] },
  { label: '🌍 Global', sites: ['twitter','reddit','youtube','linkedin','yahoo-finance','barchart'] },
]

// Args list with per-key hint text and dropdown for adding known parameters
function ArgsKVList({
  pairs,
  onChange,
  hints,
}: {
  pairs: KVPair[]
  onChange: (pairs: KVPair[]) => void
  hints?: Record<string, string>
}) {
  const update = (i: number, field: 'key' | 'value', v: string) =>
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, [field]: v } : p)))
  const remove = (i: number) => onChange(pairs.filter((_, idx) => idx !== i))

  // Hint keys not yet added — shown as dropdown options
  const usedKeys = new Set(pairs.map((p) => p.key))
  const availableKeys = hints ? Object.keys(hints).filter((k) => !usedKeys.has(k)) : []

  const addParam = (key: string) => {
    if (key === '__custom__') {
      onChange([...pairs, { key: '', value: '' }])
    } else {
      onChange([...pairs, { key, value: '' }])
    }
  }

  return (
    <div className="space-y-2">
      {pairs.map((p, i) => {
        const hintText = hints?.[p.key]
        return (
          <div key={i} className="space-y-0.5">
            <div className="flex gap-2 items-center">
              <input
                aria-label="参数名"
                name={`opencli-arg-key-${i}`}
                className={`${input} flex-1 font-mono`}
                value={p.key}
                onChange={(e) => update(i, 'key', e.target.value)}
                placeholder="参数名"
              />
              <input
                aria-label={hintText ?? '参数值'}
                name={`opencli-arg-value-${i}`}
                className={`${input} flex-1`}
                value={p.value}
                onChange={(e) => update(i, 'value', e.target.value)}
                placeholder={hintText ?? '参数值'}
              />
              <button
                type="button"
                aria-label="删除参数"
                onClick={() => remove(i)}
                className="p-1.5 text-red-400 hover:text-red-600 flex-shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
            {hintText && (
              <p className="text-xs text-gray-400 ml-1">{hintText}</p>
            )}
          </div>
        )
      })}
      {availableKeys.length > 0 ? (
        <select
          aria-label="添加参数"
          name="opencli-add-param"
          className="text-xs text-blue-600 bg-transparent border-none cursor-pointer hover:text-blue-700 mt-1 outline-none"
          value=""
          onChange={(e) => { if (e.target.value) addParam(e.target.value) }}
        >
          <option value="">＋ 添加参数</option>
          {availableKeys.map((k) => (
            <option key={k} value={k}>
              {k}{hints?.[k] ? ` — ${hints[k]}` : ''}
            </option>
          ))}
          <option value="__custom__">自定义参数...</option>
        </select>
      ) : (
        <button
          type="button"
          onClick={() => addParam('__custom__')}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mt-1"
        >
          <Plus size={12} /> 添加参数
        </button>
      )}
    </div>
  )
}

function OpenCLIConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const [args, setArgs] = useState<KVPair[]>(objToKv(config.args as Record<string, unknown>))

  const currentSite = (config.site as string) ?? ''
  const currentCommand = (config.command as string) ?? ''
  const siteCommands = COMMANDS_BY_SITE[currentSite] ?? []
  const currentPreset = siteCommands.find((p) => p.command === currentCommand)

  const applyPreset = (preset: Preset) => {
    const newPairs = objToKv(preset.args)
    setArgs(newPairs)
    onChange({ site: preset.site, command: preset.command, args: preset.args, format: config.format ?? 'json' })
  }

  const onSiteChange = (site: string) => {
    const cmds = COMMANDS_BY_SITE[site]
    if (cmds?.length) {
      applyPreset(cmds[0])
    } else {
      onChange({ ...config, site, command: '' })
    }
  }

  const onCommandChange = (command: string) => {
    const preset = siteCommands.find((p) => p.command === command)
    if (preset) applyPreset(preset)
  }

  const updateArgs = (pairs: KVPair[]) => {
    setArgs(pairs)
    onChange({ ...config, args: kvToObj(pairs) })
  }

  // Strip site prefix from label for command option text
  const commandOptionLabel = (p: Preset) => {
    const parts = p.label.split(' · ')
    return parts.length > 1 ? parts.slice(1).join(' · ') : p.command
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('channelConfig.site')} required>
          <select
            aria-label={t('channelConfig.site')}
            name="opencli-site"
            className={input}
            value={currentSite}
            onChange={(e) => onSiteChange(e.target.value)}
          >
            <option value="">-- 选择平台 --</option>
            {SITE_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.sites
                  .filter((s) => COMMANDS_BY_SITE[s])
                  .map((s) => (
                    <option key={s} value={s}>{SITE_LABELS[s] ?? s}</option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label={t('channelConfig.command')} required>
          <select
            aria-label={t('channelConfig.command')}
            name="opencli-command"
            className={input}
            value={currentCommand}
            onChange={(e) => onCommandChange(e.target.value)}
            disabled={!currentSite || siteCommands.length === 0}
          >
            <option value="">-- 选择命令 --</option>
            {siteCommands.map((p) => (
              <option key={p.command} value={p.command}>{commandOptionLabel(p)}</option>
            ))}
          </select>
        </Field>
      </div>

      {args.length > 0 && (
        <Field label={t('channelConfig.args')} hint={t('channelConfig.argsHint')}>
          <ArgsKVList pairs={args} onChange={updateArgs} hints={currentPreset?.argHints} />
        </Field>
      )}

      {args.length === 0 && currentCommand && (
        <p className="text-xs text-gray-400 italic">{t('channelConfig.noArgs')}</p>
      )}

      <Field label={t('channelConfig.outputFormat')}>
        <SelectInput
          value={(config.format as string) ?? 'json'}
          onChange={(v) => onChange({ ...config, format: v })}
          options={[
            { value: 'json',  label: 'JSON（推荐）' },
            { value: 'table', label: 'Table' },
            { value: 'yaml',  label: 'YAML' },
            { value: 'md',    label: 'Markdown' },
            { value: 'csv',   label: 'CSV' },
          ]}
        />
      </Field>

    </div>
  )
}

// Standard fields actually populated for each site:command
// (title/url/content/author/published_at — source_id is always injected by pipeline)
export const SITE_STANDARD_FIELDS: Record<string, string[]> = {
  'xiaohongshu:search':          ['title', 'author', 'url'],
  'xiaohongshu:user':            ['title', 'url'],
  'bilibili:hot':                ['title', 'author'],
  'bilibili:ranking':            ['title', 'author', 'url'],
  'bilibili:dynamic':            ['content', 'author', 'url'],
  'bilibili:favorite':           ['title', 'author', 'url'],
  'bilibili:user-videos':        ['title', 'url', 'published_at'],
  'zhihu:hot':                   ['title', 'url'],
  'zhihu:question':              ['content', 'author'],
  'weibo:hot':                   ['title', 'url'],
  'v2ex:hot':                    ['title', 'author', 'url'],
  'v2ex:latest':                 ['title', 'author', 'url'],
  'xueqiu:hot':                  ['content', 'author', 'url'],
  'xueqiu:hot-stock':            ['title'],
  'xueqiu:stock':                ['title'],
  'smzdm:search':                ['title', 'url'],
  'boss:search':                 ['title', 'url'],
  'ctrip:search':                ['title', 'url'],
  'xiaoyuzhou:podcast':          ['title', 'author', 'content', 'published_at'],
  'xiaoyuzhou:podcast-episodes': ['title', 'published_at'],
  'hackernews:top':              ['title', 'author', 'url'],
  'bbc:news':                    ['title', 'content', 'url'],
  'reuters:search':              ['title', 'url', 'published_at'],
  'twitter:trending':            ['title'],
  'twitter:timeline':            ['content', 'author', 'url', 'published_at'],
  'twitter:search':              ['content', 'author', 'url'],
  'twitter:bookmarks':           ['title', 'url'],
  'reddit:frontpage':            ['title', 'author', 'url'],
  'reddit:hot':                  ['title', 'url'],
  'reddit:saved':                ['title', 'url'],
  'youtube:search':              ['title', 'author', 'url'],
  'linkedin:search':             ['title', 'url', 'published_at'],
  'yahoo-finance:quote':         ['title'],
  'barchart:quote':              ['title'],
}

// Extra fields per site:command that fall through to normalized_data as extra_*
// (fields mapped to standard title/url/content/author/published_at are excluded)
export const SITE_EXTRA_FIELDS: Record<string, string[]> = {
  'xiaohongshu:search':        ['rank', 'likes'],
  'xiaohongshu:user':          ['id', 'type', 'likes'],
  'bilibili:hot':              ['rank', 'play', 'danmaku'],
  'bilibili:ranking':          ['rank', 'score'],
  'bilibili:dynamic':          ['id', 'likes'],
  'bilibili:favorite':         ['rank', 'plays'],
  'bilibili:user-videos':      ['rank', 'plays', 'likes'],
  'zhihu:hot':                 ['rank', 'heat', 'answers'],
  'zhihu:question':            ['rank', 'votes'],
  'weibo:hot':                 ['rank', 'hot_value', 'category', 'label'],
  'v2ex:hot':                  ['rank', 'score'],
  'v2ex:latest':               ['rank', 'score'],
  'xueqiu:hot':                ['rank', 'likes'],
  'xueqiu:hot-stock':          ['rank', 'symbol', 'price', 'changePercent', 'heat'],
  'xueqiu:stock':              ['symbol', 'price', 'change', 'changePercent', 'open', 'high', 'low', 'volume', 'marketCap'],
  'smzdm:search':              ['rank', 'price', 'mall', 'comments'],
  'boss:search':               ['salary', 'company', 'area', 'experience', 'degree', 'skills', 'boss'],
  'ctrip:search':              ['rank', 'type', 'score', 'price'],
  'xiaoyuzhou:podcast':        ['subscribers', 'episodes'],
  'xiaoyuzhou:podcast-episodes': ['eid', 'duration', 'plays'],
  'hackernews:top':            ['rank', 'score', 'comments'],
  'bbc:news':                  ['rank'],
  'reuters:search':            ['rank', 'section'],
  'twitter:trending':          ['rank', 'tweets'],
  'twitter:timeline':          ['id', 'likes', 'retweets', 'replies', 'views'],
  'twitter:search':            ['id', 'likes', 'views'],
  'twitter:bookmarks':         ['score', 'comments'],
  'reddit:frontpage':          ['subreddit', 'upvotes', 'comments'],
  'reddit:hot':                ['rank', 'subreddit', 'score', 'comments'],
  'reddit:saved':              ['subreddit', 'score', 'comments'],
  'youtube:search':            ['rank', 'views', 'duration'],
  'linkedin:search':           ['rank', 'company', 'location', 'salary'],
  'yahoo-finance:quote':       ['symbol', 'price', 'change', 'changePercent', 'open', 'high', 'low', 'volume', 'marketCap'],
  'barchart:quote':            ['symbol', 'price', 'change', 'changePct', 'peRatio', 'eps', 'marketCap'],
}

export { OPENCLI_PRESETS, PRESET_DEFAULT, SITE_LABELS, COMMANDS_BY_SITE }

// ── Public component ──────────────────────────────────────────────────────────

export type ChannelType = 'rss' | 'api' | 'web_scraper' | 'cli' | 'opencli'

interface Props {
  channelType: ChannelType
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
  /** The source's persisted id — undefined while creating a new (not-yet-saved)
   * source. The encrypted credential store is keyed by source id, so it's only
   * offered once the source exists; a new source keeps using env/inline auth
   * until the first save, then can migrate to it on the edit form. */
  sourceId?: string
}

export default function ChannelConfigForm({ channelType, config, onChange, sourceId }: Props) {

  switch (channelType) {
    case 'rss':
      return <RSSConfig config={config} onChange={onChange} />
    case 'api':
      return <APIConfig config={config} onChange={onChange} sourceId={sourceId} />
    case 'web_scraper':
      return <WebScraperConfig config={config} onChange={onChange} />
    case 'cli':
      return <CLIConfig config={config} onChange={onChange} />
    case 'opencli':
      return <OpenCLIConfig config={config} onChange={onChange} />
  }
}
