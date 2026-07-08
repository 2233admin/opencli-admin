'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Play } from 'lucide-react'
import { toast } from 'sonner'

import * as api from '@/lib/api/endpoints'
import { useSources } from '@/lib/api/hooks'
import type { DataSource } from '@/lib/api/types'
import { formatRelative } from '@/lib/format'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

export default function SourcesPage() {
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const queryClient = useQueryClient()
  const params = enabledFilter === 'all' ? undefined : { enabled: enabledFilter === 'enabled' }
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

  const sources = data?.data ?? []

  const filters: { key: typeof enabledFilter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'enabled', label: '启用' },
    { key: 'disabled', label: '停用' },
  ]

  return (
    <PageContainer
      title="数据源"
      description="采集入口配置，管理渠道、凭证与运行控制"
      actions={
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {filters.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={enabledFilter === f.key ? 'secondary' : 'ghost'}
              className="h-7"
              onClick={() => setEnabledFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
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
        </Card>
      )}
    </PageContainer>
  )
}
