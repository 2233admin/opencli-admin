'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'
import {
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  Download,
  Globe2,
  Loader2,
  Package,
  Puzzle,
  Rss,
  Search,
  Settings2,
  Webhook,
  Wrench,
} from 'lucide-react'

import { Ripple } from '@/components/motion/ripple'
import { DifyPackageImportDialog } from '@/components/plugins/dify-package-import-dialog'
import { RssCatalogImportDialog } from '@/components/plugins/rss-catalog-import-dialog'
import { EmptyState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  PLUGIN_PROVIDER_CATEGORIES,
  PLUGIN_PROVIDERS,
  mergeBundledPluginProviders,
  pluginProviderCategoryLabel,
  type PluginProvider,
  type PluginProviderCategory,
  type PluginProviderIcon,
} from '@/lib/plugins/provider-catalog'
import {
  useBackendPluginCatalog,
  type BackendPluginInstallation,
} from '@/lib/plugins/backend-plugin-catalog'
import { useOpenCLIAdapterRegistry } from '@/lib/plugins/use-opencli-adapter-registry'
import { cn } from '@/lib/utils'
import { runtimeStatusLabel, runtimeStatusTone } from '@/lib/workflow/capabilities'
import { getWorkflowNodeCatalog, type WorkflowNodeCatalogItem } from '@/lib/workflow/node-catalog'
import { localizeNodeText } from '@/lib/workflow/node-i18n'
import { useWorkflowCapabilities } from '@/lib/workflow/use-workflow-capabilities'

type PluginPageTab = 'installed' | 'marketplace'
type PluginCategoryFilter = 'all' | PluginProviderCategory
type ProviderState = 'ready' | 'configuration' | 'unavailable' | 'marketplace'
type RegistryPluginProvider = PluginProvider & {
  installation?: BackendPluginInstallation
  backendUnavailable?: boolean
}

const PROVIDER_ICONS: Record<PluginProviderIcon, typeof Wrench> = {
  brain: BrainCircuit,
  wrench: Wrench,
  database: Database,
  bot: Bot,
  clock: Clock3,
  puzzle: Puzzle,
  package: Package,
  globe: Globe2,
  rss: Rss,
  webhook: Webhook,
}

function isPluginPageTab(value: string | null): value is PluginPageTab {
  return value === 'installed' || value === 'marketplace'
}

function isPluginCategory(value: string | null): value is PluginCategoryFilter {
  return PLUGIN_PROVIDER_CATEGORIES.some((item) => item.key === value)
}

function providerState(
  provider: RegistryPluginProvider,
  nodesById: Map<string, WorkflowNodeCatalogItem>,
  opencliAdapterCount: number,
): ProviderState {
  if (provider.marketplace) return 'marketplace'
  if (provider.backendUnavailable) return 'unavailable'
  if (provider.installation) {
    return provider.installation.runtimeStatus === 'READY' ? 'ready' : 'configuration'
  }
  if (provider.id === 'opencli' && opencliAdapterCount > 0) return 'ready'

  const nodes = provider.nodeIds.map((id) => nodesById.get(id)).filter(Boolean) as WorkflowNodeCatalogItem[]
  if (nodes.some((node) => node.runtimeCapability?.status === 'runnable')) return 'ready'
  if (nodes.some((node) => node.runtimeCapability?.backendAvailable)) return 'configuration'
  return 'unavailable'
}

function providerStateLabel(state: ProviderState): string {
  if (state === 'ready') return '可用'
  if (state === 'configuration') return '需要配置或适配'
  if (state === 'marketplace') return '可安装'
  return '尚未就绪'
}

function providerStateTone(state: ProviderState): string {
  if (state === 'ready') return 'border-success/35 bg-success/10 text-success'
  if (state === 'configuration') return 'border-warning/35 bg-warning/10 text-warning'
  if (state === 'marketplace') return 'border-foreground/15 bg-muted/45 text-foreground'
  return 'border-border bg-muted/30 text-muted-foreground'
}

function PluginPageTabs({
  active,
  onSelect,
}: {
  active: PluginPageTab
  onSelect: (tab: PluginPageTab) => void
}) {
  return (
    <nav aria-label="插件页面" className="no-scrollbar overflow-x-auto">
      <div className="inline-flex min-w-max items-center gap-1 rounded-lg bg-muted p-1">
        {([
          ['installed', '已安装'],
          ['marketplace', '探索市场'],
        ] as const).map(([key, label]) => {
          const selected = active === key
          return (
            <button
              key={key}
              type="button"
              aria-current={selected ? 'page' : undefined}
              onClick={() => onSelect(key)}
              className={cn(
                'relative min-h-10 overflow-hidden rounded-md px-4 text-sm font-medium transition-colors',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {selected ? (
                <motion.span
                  layoutId="plugin-page-tab"
                  className="absolute inset-0 rounded-md border bg-background shadow-sm"
                  transition={{ type: 'spring', stiffness: 430, damping: 38, mass: 0.55 }}
                />
              ) : null}
              <span className="relative">{label}</span>
              <Ripple />
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function ProviderCard({
  provider,
  state,
  metric,
  onOpen,
}: {
  provider: RegistryPluginProvider
  state: ProviderState
  metric: string
  onOpen: () => void
}) {
  const Icon = PROVIDER_ICONS[provider.icon]
  return (
    <article className="group rounded-md border bg-background transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/15">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-36 w-full flex-col p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={`查看 ${provider.name} 插件`}
      >
        <div className="flex w-full items-start justify-between gap-3">
          <div className="grid size-11 place-items-center rounded-md border bg-muted/35">
            <Icon aria-hidden="true" className="size-5 text-foreground" />
          </div>
          <Badge variant="outline" className={cn('h-5 px-1.5 text-3xs', providerStateTone(state))}>
            {state === 'ready' ? <Check aria-hidden="true" className="mr-1 size-3" /> : null}
            {providerStateLabel(state)}
          </Badge>
        </div>
        <div className="mt-4 min-w-0">
          <h2 className="truncate text-sm font-semibold">{provider.name}</h2>
          <p className="mt-1 text-3xs text-muted-foreground">{provider.author}</p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{provider.description}</p>
        </div>
        <div className="mt-auto flex w-full items-center justify-between pt-4 text-3xs text-muted-foreground">
          <span>{pluginProviderCategoryLabel(provider.category)}</span>
          <span className="flex items-center gap-1">
            {metric}
            <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </button>
    </article>
  )
}

function ProviderDetails({
  provider,
  nodesById,
  state,
  opencliAdapterCount,
  onImportRss,
}: {
  provider: RegistryPluginProvider
  nodesById: Map<string, WorkflowNodeCatalogItem>
  state: ProviderState
  opencliAdapterCount: number
  onImportRss: () => void
}) {
  const Icon = PROVIDER_ICONS[provider.icon]
  const nodes = provider.nodeIds.map((id) => nodesById.get(id)).filter(Boolean) as WorkflowNodeCatalogItem[]
  const installation = provider.installation

  return (
    <SheetContent className="w-[94vw] sm:max-w-lg">
      <SheetHeader className="border-b pr-12">
        <div className="flex items-start gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-md border bg-muted/35">
            <Icon aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle>{provider.name}</SheetTitle>
              <Badge variant="outline" className={cn('h-5 px-1.5 text-3xs', providerStateTone(state))}>
                {providerStateLabel(state)}
              </Badge>
            </div>
            <SheetDescription className="mt-1">
              {provider.author} · {pluginProviderCategoryLabel(provider.category)}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="space-y-6 overflow-y-auto px-4 pb-6">
        <section>
          <h3 className="text-xs font-semibold">插件说明</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{provider.description}</p>
        </section>

        {installation ? (
          <section className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-3 text-xs">
            <div>
              <div className="text-muted-foreground">版本</div>
              <div className="mt-1 font-mono">{installation.version}</div>
            </div>
            <div>
              <div className="text-muted-foreground">包来源</div>
              <div className="mt-1 font-mono">{installation.sourceKind}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Manifest 规范</div>
              <div className="mt-1 font-mono">{installation.manifestSpecVersion}</div>
            </div>
            <div>
              <div className="text-muted-foreground">签名状态</div>
              <div className="mt-1 font-mono">
                {installation.signatureState === 'present_unverified'
                  ? '存在，未验证'
                  : installation.signatureState === 'unsigned'
                    ? '未签名'
                    : '系统内置'}
              </div>
            </div>
          </section>
        ) : null}

        {installation && installation.capabilities.length > 0 ? (
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold">声明的能力</h3>
              <span className="font-mono text-3xs text-muted-foreground">
                {installation.capabilities.length}
              </span>
            </div>
            <div className="divide-y rounded-lg border">
              {installation.capabilities.map((capability) => (
                <div key={capability.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{capability.label}</div>
                    <div className="mt-0.5 truncate font-mono text-3xs text-muted-foreground">
                      {capability.family} · {capability.key}
                    </div>
                    {capability.blockers[0]?.message ? (
                      <p className="mt-1 text-3xs leading-4 text-muted-foreground">
                        {capability.blockers[0].message}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-5 shrink-0 px-1.5 text-3xs',
                      capability.status === 'READY'
                        ? 'border-success/35 bg-success/10 text-success'
                        : 'border-warning/35 bg-warning/10 text-warning',
                    )}
                  >
                    {capability.status}
                  </Badge>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {installation && Object.keys(installation.permissions).length > 0 ? (
          <section>
            <h3 className="text-xs font-semibold">权限与凭证声明</h3>
            <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/20 p-3 text-3xs leading-5 text-muted-foreground">
              {JSON.stringify(installation.permissions, null, 2)}
            </pre>
          </section>
        ) : null}

        {installation && installation.blockers.length > 0 ? (
          <section className="rounded-lg border border-warning/30 bg-warning/5 p-3">
            <h3 className="text-xs font-semibold text-warning">运行前置条件</h3>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
              {installation.blockers.map((blocker) => (
                <li key={blocker.code}>· {blocker.message}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {provider.id === 'opencli' ? (
          <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div>
              <div className="text-3xs text-muted-foreground">已注册网站</div>
              <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{opencliAdapterCount}</div>
            </div>
            <Button variant="outline" className="w-full" nativeButton={false} render={<Link href="/plugins/opencli" />}>
              浏览网站适配与命令
            </Button>
          </section>
        ) : null}

        {provider.id === 'rss-reader' ? (
          <section className="rounded-lg border bg-muted/20 p-3">
            <h3 className="text-xs font-semibold">批量接入订阅</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              RSS 节点可直接填写地址；已有 OPML 清单时，也可以一次导入多个订阅。
            </p>
            <Button variant="outline" className="mt-3 w-full" onClick={onImportRss}>
              <Download aria-hidden="true" className="size-4" />
              导入 OPML 订阅清单
            </Button>
          </section>
        ) : null}

        {provider.marketplace ? (
          <section className="rounded-lg border border-dashed p-4">
            <h3 className="text-sm font-medium">插件运行时尚未接入</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              这里展示市场入口；接入真实安装服务后才能下载、安装并注册该 Provider。
            </p>
          </section>
        ) : (
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold">提供的工作流能力</h3>
              <span className="font-mono text-3xs text-muted-foreground">{nodes.length}</span>
            </div>
            <div className="divide-y rounded-lg border">
              {nodes.map((node) => {
                const text = localizeNodeText(
                  node.id,
                  { label: node.label, description: node.description },
                  'zh-CN',
                )
                return (
                  <div key={node.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{text.label}</div>
                      <div className="mt-0.5 truncate font-mono text-3xs text-muted-foreground">{node.id}</div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('h-5 shrink-0 px-1.5 text-3xs', runtimeStatusTone(node.runtimeCapability?.status))}
                    >
                      {runtimeStatusLabel(node.runtimeCapability?.status)}
                    </Badge>
                  </div>
                )
              })}
              {nodes.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">安装后由 Provider 注册工具。</div>
              ) : null}
            </div>
          </section>
        )}

        {!provider.marketplace && installation?.runtimeStatus !== 'BLOCKED' ? (
          <Button className="w-full" nativeButton={false} render={<Link href="/studio" />}>
            在工作流中使用
          </Button>
        ) : installation?.runtimeStatus === 'BLOCKED' ? (
          <Button className="w-full" disabled title="需要兼容的 OpenCLI 运行适配器">
            能力已登记，等待运行适配器
          </Button>
        ) : (
          <Button className="w-full" disabled title="插件安装运行时尚未接入">
            安装运行时待接入
          </Button>
        )}
      </div>
    </SheetContent>
  )
}

export default function PluginHubPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab')
  const rawCategory = searchParams.get('category')
  const activeTab: PluginPageTab = isPluginPageTab(rawTab) ? rawTab : 'installed'
  const activeCategory: PluginCategoryFilter = isPluginCategory(rawCategory) ? rawCategory : 'all'
  const [query, setQuery] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<RegistryPluginProvider | null>(null)
  const [rssImportOpen, setRssImportOpen] = useState(false)
  const [difyImportOpen, setDifyImportOpen] = useState(false)
  const {
    installations,
    error: pluginError,
    loading: pluginLoading,
  } = useBackendPluginCatalog(true)
  const { capabilities, error: capabilityError, loading: capabilityLoading } = useWorkflowCapabilities(true)
  const {
    summary,
    error: opencliError,
    loading: opencliLoading,
  } = useOpenCLIAdapterRegistry(true)
  const nodes = useMemo(() => getWorkflowNodeCatalog('intelligence', capabilities), [capabilities])
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])

  function updateRoute(next: { tab?: PluginPageTab; category?: PluginCategoryFilter }) {
    const params = new URLSearchParams(searchParams.toString())
    const tab = next.tab ?? activeTab
    const category = next.category ?? activeCategory
    if (tab === 'installed') params.delete('tab')
    else params.set('tab', tab)
    if (category === 'all') params.delete('category')
    else params.set('category', category)
    const queryString = params.toString()
    router.push(queryString ? `/plugins?${queryString}` : '/plugins', { scroll: false })
  }

  const availableProviders = useMemo(() => {
    const source: RegistryPluginProvider[] = activeTab === 'installed'
      ? installations
        ? mergeBundledPluginProviders(
            installations.map(backendProviderFromInstallation),
          ) as RegistryPluginProvider[]
        : pluginError
          ? PLUGIN_PROVIDERS.filter((provider) => provider.bundled).map((provider) => ({
              ...provider,
              backendUnavailable: true,
            }))
          : []
      : PLUGIN_PROVIDERS.filter((provider) => provider.marketplace)
    return source
  }, [activeTab, installations, pluginError])

  const categoryCounts = useMemo(() => {
    const counts = new Map<PluginCategoryFilter, number>([['all', availableProviders.length]])
    for (const provider of availableProviders) {
      counts.set(provider.category, (counts.get(provider.category) ?? 0) + 1)
    }
    return counts
  }, [availableProviders])

  const providers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return availableProviders.filter((provider) => {
      if (activeCategory !== 'all' && provider.category !== activeCategory) return false
      if (!needle) return true
      return `${provider.name} ${provider.author} ${provider.description} ${provider.tags.join(' ')}`
        .toLowerCase()
        .includes(needle)
    })
  }, [activeCategory, availableProviders, query])

  const activeCategoryLabel = activeCategory === 'all'
    ? '全部插件'
    : pluginProviderCategoryLabel(activeCategory)
  const sectionTitle = activeTab === 'installed'
    ? `${activeCategoryLabel} · 已安装`
    : `${activeCategoryLabel} · 市场`
  const sectionDescription = activeCategory === 'bundle'
    ? '预制包封装重复流程；打开后可查看包含的能力，并在 Studio 中直接使用。'
    : activeTab === 'installed'
      ? '按 Provider 管理能力、运行状态和配置。具体节点在 Studio 中选择。'
      : '浏览可安装的 Provider；安装前会校验包信息、权限和运行适配器。'

  const topTabs = (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <PluginPageTabs active={activeTab} onSelect={(tab) => updateRoute({ tab })} />
      <Button
        variant="outline"
        size="sm"
        className="min-h-10"
        onClick={() => setDifyImportOpen(true)}
      >
        <Download aria-hidden="true" className="size-4" />
        安装插件包
      </Button>
    </div>
  )

  return (
    <PageContainer
      eyebrow="Plugins"
      title="插件中心"
      description="管理已经接入的能力包，并按需安装新的 Provider。"
      tabs={topTabs}
    >
      <div className="grid min-w-0 gap-6 lg:grid-cols-[10rem_minmax(0,1fr)]">
        <aside className="min-w-0">
          <nav aria-label="插件分类" className="flex gap-1 overflow-x-auto lg:sticky lg:top-4 lg:flex-col">
            {PLUGIN_PROVIDER_CATEGORIES.map((item) => {
              const selected = activeCategory === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => updateRoute({ category: item.key })}
                  className={cn(
                    'flex min-h-10 shrink-0 items-center justify-between gap-4 rounded-md px-3 text-left text-xs font-medium transition-colors',
                    selected
                      ? 'bg-muted text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span>{item.label}</span>
                  <span
                    className={cn(
                      'font-mono text-3xs tabular-nums',
                      selected ? 'text-foreground/70' : 'text-muted-foreground/70',
                    )}
                  >
                    {categoryCounts.get(item.key) ?? 0}
                  </span>
                </button>
              )
            })}
          </nav>
        </aside>

        <main className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">{pluginError ? '插件能力目录' : sectionTitle}</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{sectionDescription}</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-10 pl-9"
                placeholder="搜索插件"
                aria-label="搜索插件"
              />
            </div>
          </div>

          {pluginError || capabilityError || opencliError ? (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <div className="font-medium">
                  {pluginError ? '后端插件注册表暂时不可用' : '部分 Provider 状态暂时不可用'}
                </div>
                <p className="mt-1 text-muted-foreground">
                  {pluginError ?? capabilityError ?? opencliError}
                </p>
                {pluginError ? (
                  <p className="mt-1 text-muted-foreground">
                    当前仅显示不可用的前端目录占位，不会把它们标记成“已安装”。
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {(pluginLoading || capabilityLoading || opencliLoading) &&
          (installations === null || capabilities === null) ? (
            <div className="grid min-h-48 place-items-center rounded-md border border-dashed">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                正在读取插件状态
              </div>
            </div>
          ) : providers.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {providers.map((provider) => {
                const state = providerState(provider, nodesById, summary.adapterCount)
                const capabilityCount = provider.id === 'opencli'
                  ? summary.adapterCount
                  : provider.nodeIds.filter((id) => nodesById.has(id)).length
                const metric = provider.id === 'opencli'
                  ? `${capabilityCount} 个网站`
                  : capabilityCount > 0
                    ? `${capabilityCount} 项能力`
                    : '查看详情'
                return (
                  <ProviderCard
                    key={provider.installation?.id ?? provider.id}
                    provider={provider}
                    state={state}
                    metric={metric}
                    onOpen={() => {
                      if (provider.id === 'opencli') {
                        router.push('/plugins/opencli')
                        return
                      }
                      setSelectedProvider(provider)
                    }}
                  />
                )
              })}
            </div>
          ) : (
            <EmptyState
              title={activeTab === 'installed'
                ? pluginError
                  ? '插件注册表不可用'
                  : `${activeCategoryLabel}中没有匹配项`
                : `${activeCategoryLabel}暂未上架`}
              description={query
                ? '清除搜索词或切换分类后再试。'
                : '切换到其他分类，或通过“安装插件包”接入本地 Provider。'}
            />
          )}

          {activeTab === 'marketplace' ? (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-dashed p-4">
              <Settings2 aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">市场目录已与安装执行分离</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  当前页面只展示可安装包。真正安装需要插件运行时完成下载、校验、权限确认和 Provider 注册。
                </p>
              </div>
            </div>
          ) : null}
        </main>
      </div>

      <Sheet
        open={selectedProvider !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedProvider(null)
        }}
      >
        {selectedProvider ? (
          <ProviderDetails
            provider={selectedProvider}
            nodesById={nodesById}
            state={providerState(selectedProvider, nodesById, summary.adapterCount)}
            opencliAdapterCount={summary.adapterCount}
            onImportRss={() => {
              setSelectedProvider(null)
              setRssImportOpen(true)
            }}
          />
        ) : null}
      </Sheet>

      <RssCatalogImportDialog open={rssImportOpen} onOpenChange={setRssImportOpen} />
      <DifyPackageImportDialog
        open={difyImportOpen}
        onOpenChange={setDifyImportOpen}
        onImported={(installation) => {
          setSelectedProvider(backendProviderFromInstallation(installation))
          updateRoute({ tab: 'installed' })
        }}
      />
    </PageContainer>
  )
}

function backendProviderFromInstallation(
  installation: BackendPluginInstallation,
): RegistryPluginProvider {
  const fallbackId = installation.providerKey === 'opencli-admin/opencli-adapters'
    ? 'opencli'
    : installation.providerKey === 'opencli-admin/native-data-sources'
      ? 'rss-reader'
      : installation.providerKey === 'opencli-admin/dify-graphon-runtime'
        ? 'workflow-core'
        : null
  const fallback = fallbackId
    ? PLUGIN_PROVIDERS.find((provider) => provider.id === fallbackId)
    : undefined
  const category = pluginCategoryFromInstallation(installation)
  const label = installation.labels.zh_Hans ?? installation.labels.en_US ?? installation.name
  const description = installation.descriptions.zh_Hans
    ?? installation.descriptions.en_US
    ?? fallback?.description
    ?? 'Dify 插件能力声明。'
  return {
    id: fallback?.id ?? installation.id,
    name: label,
    author: installation.author,
    category: fallback?.category ?? category,
    description,
    icon: fallback?.icon ?? pluginIconFromCategory(category),
    nodeIds: fallback?.nodeIds ?? [],
    tags: [
      ...new Set([
        ...(fallback?.tags ?? []),
        installation.providerKey,
        installation.version,
        ...installation.pluginTypes,
      ]),
    ],
    bundled: installation.bundled,
    installation,
  }
}

function pluginCategoryFromInstallation(
  installation: BackendPluginInstallation,
): PluginProviderCategory {
  const types = new Set(installation.pluginTypes)
  if (types.has('model')) return 'model'
  if (types.has('datasource')) return 'datasource'
  if (types.has('trigger')) return 'trigger'
  if (types.has('agent_strategy')) return 'agent'
  if (types.has('endpoint')) return 'extension'
  return 'tool'
}

function pluginIconFromCategory(category: PluginProviderCategory): PluginProviderIcon {
  if (category === 'model') return 'brain'
  if (category === 'datasource') return 'database'
  if (category === 'agent') return 'bot'
  if (category === 'trigger') return 'clock'
  if (category === 'extension') return 'puzzle'
  return 'wrench'
}
