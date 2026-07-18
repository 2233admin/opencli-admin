'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Copy, Loader2, Pencil, Plug, Plus, Rss, Trash2, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'

import {
  useBuildFeedProviderWorkflowNode,
  useCreateFeedProvider,
  useDeleteFeedProvider,
  useFeedProviderCatalog,
  useFeedProviders,
  useTestFeedProvider,
  useUpdateFeedProvider,
} from '@/lib/api/hooks'
import type {
  FeedProvider,
  FeedProviderConnectionTest,
  FeedProviderInput,
  FeedProviderWorkflowNode,
} from '@/lib/api/types'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const TYPE_LABEL: Record<FeedProvider['provider_type'], string> = {
  rsshub: 'RSSHub',
  rss_bridge: 'RSS-Bridge',
}

type FeedProviderFormState = {
  name: string
  provider_type: FeedProvider['provider_type']
  base_url: string
  access_token: string
  timeout_seconds: string
  allowed_domains: string
  allow_private_network: boolean
  browser_routes: boolean
  authenticated_routes: boolean
  enabled: boolean
}

function formState(provider?: FeedProvider): FeedProviderFormState {
  return {
    name: provider?.name ?? 'Local RSSHub',
    provider_type: provider?.provider_type ?? 'rsshub',
    base_url: provider?.base_url ?? 'http://127.0.0.1:1200',
    access_token: '',
    timeout_seconds: String(provider?.config.timeout_seconds ?? 15),
    allowed_domains: (provider?.config.allowed_domains ?? ['127.0.0.1']).join(', '),
    allow_private_network: provider?.config.allow_private_network ?? true,
    browser_routes: provider?.config.browser_routes ?? false,
    authenticated_routes: provider?.config.authenticated_routes ?? false,
    enabled: provider?.enabled ?? true,
  }
}

function FeedProviderDialog({ provider }: { provider?: FeedProvider }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FeedProviderFormState>(() => formState(provider))
  const createMutation = useCreateFeedProvider()
  const updateMutation = useUpdateFeedProvider()
  const pending = createMutation.isPending || updateMutation.isPending

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) setForm(formState(provider))
  }

  const handleTypeChange = (providerType: FeedProvider['provider_type']) => {
    setForm((current) => ({
      ...current,
      provider_type: providerType,
      name: providerType === 'rsshub' ? 'Local RSSHub' : 'Local RSS-Bridge',
      base_url:
        providerType === 'rsshub' ? 'http://127.0.0.1:1200' : 'http://127.0.0.1:3001',
    }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const payload: FeedProviderInput = {
      name: form.name.trim(),
      provider_type: form.provider_type,
      base_url: form.base_url.trim(),
      ...(form.access_token.trim() ? { access_token: form.access_token.trim() } : {}),
      config: {
        timeout_seconds: Number(form.timeout_seconds) || 15,
        allowed_domains: form.allowed_domains
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        allow_private_network: form.allow_private_network,
        browser_routes: form.browser_routes,
        authenticated_routes: form.authenticated_routes,
      },
      enabled: form.enabled,
    }
    const options = {
      onSuccess: () => {
        toast.success(provider ? 'RSS Provider 已更新' : 'RSS Provider 已创建')
        setOpen(false)
      },
      onError: (cause: Error) => toast.error(cause.message),
    }
    if (provider) updateMutation.mutate({ id: provider.id, data: payload }, options)
    else createMutation.mutate(payload, options)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button size={provider ? 'xs' : 'sm'} variant={provider ? 'ghost' : 'default'} />}
      >
        {provider ? <Pencil className="size-3" /> : <Plus className="size-4" />}
        {provider ? '编辑' : '添加 RSS Provider'}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{provider ? '编辑 RSS Provider' : '连接自托管 RSS 生成器'}</DialogTitle>
            <DialogDescription>
              Token 只写入后端加密存储；工作流只保存 Provider 引用和 route/Bridge 选择。
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            {(['rsshub', 'rss_bridge'] as const).map((providerType) => (
              <Button
                key={providerType}
                type="button"
                variant={form.provider_type === providerType ? 'default' : 'outline'}
                onClick={() => handleTypeChange(providerType)}
              >
                {TYPE_LABEL[providerType]}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="feed-provider-name">名称</Label>
              <Input
                id="feed-provider-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="feed-provider-timeout">超时（秒）</Label>
              <Input
                id="feed-provider-timeout"
                type="number"
                min={1}
                max={60}
                value={form.timeout_seconds}
                onChange={(event) =>
                  setForm((current) => ({ ...current, timeout_seconds: event.target.value }))
                }
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="feed-provider-url">Base URL</Label>
            <Input
              id="feed-provider-url"
              value={form.base_url}
              onChange={(event) => setForm((current) => ({ ...current, base_url: event.target.value }))}
              placeholder="http://127.0.0.1:1200"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="feed-provider-domains">允许的域名（逗号分隔）</Label>
            <Input
              id="feed-provider-domains"
              value={form.allowed_domains}
              onChange={(event) =>
                setForm((current) => ({ ...current, allowed_domains: event.target.value }))
              }
              placeholder="rsshub.internal, 127.0.0.1"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="feed-provider-token">访问 Token（可选）</Label>
            <Input
              id="feed-provider-token"
              type="password"
              value={form.access_token}
              onChange={(event) =>
                setForm((current) => ({ ...current, access_token: event.target.value }))
              }
              placeholder={provider?.has_access_token ? '留空则保留现有 Token' : '未启用鉴权可留空'}
            />
          </div>

          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            {[
              ['allow_private_network', '允许私网实例'],
              ['browser_routes', '支持浏览器/WebDriver 路由'],
              ['authenticated_routes', '支持认证路由'],
              ['enabled', '启用 Provider'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-3 text-sm">
                <span>{label}</span>
                <Switch
                  checked={form[key as keyof FeedProviderFormState] as boolean}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({ ...current, [key]: checked }))
                  }
                />
              </label>
            ))}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {provider ? '保存' : '创建并保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProviderRouteBuilder({ provider }: { provider: FeedProvider }) {
  const [sourceGroup, setSourceGroup] = useState(`${provider.provider_type}-source`)
  const [site, setSite] = useState<string>(provider.provider_type)
  const [selection, setSelection] = useState(
    provider.provider_type === 'rsshub' ? '/rsshub/routes/en' : '',
  )
  const [parametersJson, setParametersJson] = useState('{}')
  const catalogQuery = useFeedProviderCatalog(provider.id)
  const buildMutation = useBuildFeedProviderWorkflowNode()
  const [node, setNode] = useState<FeedProviderWorkflowNode | null>(null)
  const catalog = catalogQuery.data
  const catalogSelections = useMemo(() => {
    const bridges = catalog?.bridges
    const bridgeIds = Array.isArray(bridges)
      ? bridges
          .map((bridge) =>
            typeof bridge === 'object' && bridge && 'id' in bridge ? String(bridge.id) : '',
          )
          .filter(Boolean)
      : []
    const routes = catalog?.routes
    const routeIds = Array.isArray(routes)
      ? routes
          .map((route) =>
            typeof route === 'object' && route && 'route' in route ? String(route.route) : '',
          )
          .filter(Boolean)
      : []
    return [...routeIds, ...bridgeIds]
  }, [catalog])

  const buildNode = () => {
    let parameters: Record<string, string>
    try {
      const parsed = JSON.parse(parametersJson) as unknown
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('参数必须是 JSON 对象')
      }
      parameters = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)]),
      )
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '参数 JSON 无效')
      return
    }
    buildMutation.mutate(
      {
        providerId: provider.id,
        data: {
          ...(provider.provider_type === 'rsshub'
            ? { route: selection }
            : { bridge: selection }),
          parameters,
          source_group: sourceGroup,
          site,
          max_entries: 20,
        },
      },
      {
        onSuccess: (result) => setNode(result),
        onError: (cause: Error) => toast.error(cause.message),
      },
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/10 p-3">
      <div>
        <p className="text-sm font-medium">路由 / Bridge → 工作流节点</p>
        <p className="mt-1 text-xs text-muted-foreground">
          生成标准 intelligence.source.rss 节点；运行时再从后端解析 Token。
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
          placeholder={provider.provider_type === 'rsshub' ? '/route/path' : 'Bridge name'}
          list={`feed-provider-catalog-${provider.id}`}
        />
        <datalist id={`feed-provider-catalog-${provider.id}`}>
          {catalogSelections.map((catalogSelection) => (
            <option key={catalogSelection} value={catalogSelection} />
          ))}
        </datalist>
        <Input value={sourceGroup} onChange={(event) => setSourceGroup(event.target.value)} placeholder="sourceGroup" />
        <Input value={site} onChange={(event) => setSite(event.target.value)} placeholder="site" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`feed-provider-parameters-${provider.id}`}>路由参数 JSON</Label>
        <Textarea
          id={`feed-provider-parameters-${provider.id}`}
          value={parametersJson}
          onChange={(event) => setParametersJson(event.target.value)}
          placeholder='{"feed_1":"https://example.com/feed.xml","limit":"5"}'
          className="min-h-20 font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          RSSHub 路径参数写入 route；RSS-Bridge 参数名可从实例目录的 Bridge 元数据中确认。
        </p>
      </div>
      {catalogQuery.isError ? (
        <p className="text-xs text-destructive">目录读取失败：{(catalogQuery.error as Error).message}</p>
      ) : catalogQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">正在读取实例目录…</p>
      ) : provider.provider_type === 'rss_bridge' ? (
        <p className="text-xs text-muted-foreground">
          实例返回 {catalogSelections.length} 个 Bridge。
        </p>
      ) : catalogSelections.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          实例目录提供 {catalogSelections.length} 个建议 route，也可直接输入自定义 route。
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="outline" onClick={buildNode} disabled={!selection || buildMutation.isPending}>
          {buildMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <WandSparkles className="size-3" />}
          生成节点
        </Button>
        {node ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(JSON.stringify(node, null, 2))
              toast.success('节点配置已复制')
            }}
          >
            <Copy className="size-3" />
            复制 JSON
          </Button>
        ) : null}
      </div>
      {node ? (
        <pre className="max-h-48 overflow-auto rounded-md bg-background p-3 text-[11px] leading-relaxed">
          {JSON.stringify(node, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}

export function RssGeneratorProviderPanel() {
  const { data, isLoading, isError, error } = useFeedProviders()
  const providers = data?.data ?? []
  const [testResults, setTestResults] = useState<Record<string, FeedProviderConnectionTest>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const testMutation = useTestFeedProvider()
  const deleteMutation = useDeleteFeedProvider()

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState message={(error as Error).message} hint={BACKEND_HINT} />

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">RSS 生成器 Provider</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            把自托管 RSSHub 和 RSS-Bridge 作为受管连接，统一健康检查、目录和工作流节点生成。
          </p>
        </div>
        <FeedProviderDialog />
      </div>

      {providers.length === 0 ? (
        <EmptyState title="暂无 RSS Provider" description="连接自托管实例后可选择 route 或 Bridge 并生成 RSS 节点。" />
      ) : (
        <div className="grid gap-3">
          {providers.map((provider) => {
            const testing = testMutation.isPending && testMutation.variables === provider.id
            const testResult = testResults[provider.id]
            const expanded = expandedId === provider.id
            return (
              <Card key={provider.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-primary">
                        <Rss className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-sm">{provider.name}</CardTitle>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{provider.base_url}</p>
                      </div>
                    </div>
                    <StatusBadge status={provider.enabled ? 'enabled' : 'disabled'} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{TYPE_LABEL[provider.provider_type]}</Badge>
                    {provider.config.allow_private_network ? <Badge variant="outline">私网</Badge> : null}
                    {provider.config.browser_routes ? <Badge variant="outline">Browser</Badge> : null}
                    {provider.config.authenticated_routes ? <Badge variant="outline">Auth</Badge> : null}
                    <Badge variant="outline">{provider.config.timeout_seconds}s</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    域名：{provider.config.allowed_domains.join(', ') || '未配置'} · Token：
                    {provider.has_access_token ? provider.access_token_preview ?? '已保存' : '无'}
                  </p>
                  {testResult ? (
                    <p className={testResult.ok ? 'text-xs text-success' : 'text-xs text-destructive'}>
                      {testResult.ok
                        ? `连接正常 · ${testResult.latency_ms ?? '—'}ms`
                        : `${testResult.error_kind ?? 'generator_unavailable'} · ${testResult.error ?? '连接失败'}`}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={testing}
                      onClick={() =>
                        testMutation.mutate(provider.id, {
                          onSuccess: (result) =>
                            setTestResults((current) => ({ ...current, [provider.id]: result })),
                          onError: (cause: Error) => toast.error(cause.message),
                        })
                      }
                    >
                      {testing ? <Loader2 className="size-3 animate-spin" /> : <Plug className="size-3" />}
                      测试
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setExpandedId(expanded ? null : provider.id)}>
                      <WandSparkles className="size-3" />
                      {expanded ? '收起节点生成' : '路由与节点'}
                    </Button>
                    <FeedProviderDialog provider={provider} />
                    <Button
                      size="xs"
                      variant={confirmDeleteId === provider.id ? 'destructive' : 'ghost'}
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (confirmDeleteId !== provider.id) {
                          setConfirmDeleteId(provider.id)
                          return
                        }
                        deleteMutation.mutate(provider.id, {
                          onSuccess: () => {
                            toast.success('RSS Provider 已删除')
                            setConfirmDeleteId(null)
                          },
                          onError: (cause: Error) => toast.error(cause.message),
                        })
                      }}
                    >
                      <Trash2 className="size-3" />
                      {confirmDeleteId === provider.id ? '确认删除' : '删除'}
                    </Button>
                  </div>
                  {expanded ? <ProviderRouteBuilder provider={provider} /> : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}
