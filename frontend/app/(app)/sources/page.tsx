'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Download, ExternalLink, LibraryBig, Play } from 'lucide-react'
import { toast } from 'sonner'

import * as api from '@/lib/api/endpoints'
import { useSources } from '@/lib/api/hooks'
import type { DataSource } from '@/lib/api/types'
import { formatRelative } from '@/lib/format'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { AUTOMATION_TABS, RouteTabs } from '@/components/shell/route-tabs'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const CHANNEL_LABEL: Record<DataSource['channel_type'], string> = {
  opencli: 'OpenCLI',
  web_scraper: '网页抓取',
  api: 'API',
  rss: 'RSS',
  cli: 'CLI',
  skill: '技能',
  crawl4ai: 'Crawl4AI',
  browser_act: 'BrowserAct 采集',
}

const RSS_CATALOG_COMMIT = '3a7a9e28943d28b8acb6d9197fb168a8be5267f6'
const RSS_CATALOG_BASE =
  `https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/${RSS_CATALOG_COMMIT}/recommended/with_category`

const RSS_CATALOG_PRESETS = [
  {
    id: 'business',
    label: '商业与经济',
    description: '市场、公司、宏观经济与商业分析',
    count: 17,
    url: `${RSS_CATALOG_BASE}/Business%20%26%20Economy.opml`,
  },
  {
    id: 'personal-finance',
    label: '个人财经',
    description: '理财、投资、税务与消费金融',
    count: 30,
    url: `${RSS_CATALOG_BASE}/Personal%20finance.opml`,
  },
  {
    id: 'news',
    label: '综合新闻',
    description: '全球新闻与公共事件',
    count: 10,
    url: `${RSS_CATALOG_BASE}/News.opml`,
  },
  {
    id: 'tech',
    label: '科技',
    description: '开发、产品、平台与技术产业',
    count: 28,
    url: `${RSS_CATALOG_BASE}/Tech.opml`,
  },
] as const

export default function SourcesPage() {
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [page, setPage] = useState(1)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogUrl, setCatalogUrl] = useState<string>(RSS_CATALOG_PRESETS[0].url)
  const queryClient = useQueryClient()
  const params = {
    page,
    limit: 50,
    ...(enabledFilter === 'all' ? {} : { enabled: enabledFilter === 'enabled' }),
  }
  const { data, isLoading, isError, error } = useSources(params)

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.updateSource(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      toast.success('已更新数据源状态')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const trigger = useMutation({
    mutationFn: (id: string) => api.triggerTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('已触发采集任务')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const importCatalog = useMutation({
    mutationFn: () => api.importRssCatalog(catalogUrl.trim()),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      toast.success(
        `已导入 ${result.created.length} 个 RSS 数据源，跳过 ${result.skipped_existing.length} 个重复项`,
      )
      setCatalogOpen(false)
      setEnabledFilter('disabled')
      setPage(1)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const sources = data?.data ?? []
  const pagination = data?.meta

  const filters: { key: typeof enabledFilter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'enabled', label: '启用' },
    { key: 'disabled', label: '停用' },
  ]

  return (
    <>
      <PageContainer
        eyebrow="Automation"
        title="自动化与 Agent"
        description="从数据入口、触发调度到 Agent 处理和技能执行，集中管理完整自动化链路。"
        tabs={<RouteTabs tabs={AUTOMATION_TABS} />}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => setCatalogOpen(true)}>
              <LibraryBig className="size-3.5" />
              导入 RSS 源库
            </Button>
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              {filters.map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={enabledFilter === f.key ? 'secondary' : 'ghost'}
                  className="h-7"
                  onClick={() => {
                    setEnabledFilter(f.key)
                    setPage(1)
                  }}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
        }
      >
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
        ) : sources.length === 0 ? (
          <EmptyState title="暂无数据源" description="连接后端后，已配置的采集入口将显示在此。" />
        ) : (
          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>渠道</TableHead>
                  <TableHead>标签</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        href={`/sources/${s.id}`}
                        className="group inline-flex items-center gap-1 font-medium hover:text-primary"
                      >
                        {s.name}
                        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Link>
                      {s.review_required ? (
                        <Badge variant="destructive" className="ml-2">
                          待复核
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {CHANNEL_LABEL[s.channel_type] ?? s.channel_type}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.tags.slice(0, 3).map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))}
                        {s.tags.length === 0 ? <span className="text-muted-foreground">—</span> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.enabled ? 'enabled' : 'disabled'} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatRelative(s.updated_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1"
                          disabled={!s.enabled || trigger.isPending}
                          onClick={() => trigger.mutate(s.id)}
                        >
                          <Play className="size-3.5" />
                          采集
                        </Button>
                        <Switch
                          checked={s.enabled}
                          disabled={toggle.isPending}
                          onCheckedChange={(v) => toggle.mutate({ id: s.id, enabled: v })}
                          aria-label="启用/停用"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pagination && pagination.pages > 1 ? (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <span className="text-sm text-muted-foreground">
                  共 {pagination.total} 个数据源 · 第 {pagination.page}/{pagination.pages} 页
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pagination.page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pagination.page >= pagination.pages}
                    onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        )}
      </PageContainer>

      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>导入开源 RSS 源库</DialogTitle>
            <DialogDescription>
              从 GitHub OPML 源包批量创建 RSS 数据源。所有源默认停用，并保留分类和源库出处，审核后再启用。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            {RSS_CATALOG_PRESETS.map((preset) => {
              const selected = catalogUrl === preset.url
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/60'
                  }`}
                  onClick={() => setCatalogUrl(preset.url)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{preset.label}</span>
                    <Badge variant={selected ? 'default' : 'secondary'}>{preset.count} 个源</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{preset.description}</p>
                </button>
              )
            })}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="rss-catalog-url">GitHub Raw OPML 地址</Label>
            <Input
              id="rss-catalog-url"
              value={catalogUrl}
              onChange={(event) => setCatalogUrl(event.target.value)}
              placeholder="https://raw.githubusercontent.com/.../feeds.opml"
            />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>也可以粘贴其他公开 OPML 源库地址，单次上限 2 MB。</span>
              <Link
                href="https://github.com/plenaryapp/awesome-rss-feeds"
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
              >
                查看源库
                <ExternalLink className="size-3" />
              </Link>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCatalogOpen(false)}>
              取消
            </Button>
            <Button
              className="gap-1.5"
              disabled={!catalogUrl.trim() || importCatalog.isPending}
              onClick={() => importCatalog.mutate()}
            >
              <Download className="size-3.5" />
              {importCatalog.isPending ? '正在导入…' : '导入并进入审核'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
