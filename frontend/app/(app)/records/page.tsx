'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'

import { useRecords } from '@/lib/api/hooks'
import { formatRelative } from '@/lib/format'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { StatusBadge } from '@/components/shell/status-badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** Pull the most human-readable field out of a record's normalized payload. */
function recordTitle(data: Record<string, unknown>): string {
  const candidate = data.title ?? data.name ?? data.text ?? data.content ?? data.url
  if (typeof candidate === 'string' && candidate.trim()) return candidate
  return '(无标题)'
}

export default function RecordsPage() {
  const [search, setSearch] = useState('')
  const { data, isLoading, isError, error } = useRecords(search ? { search } : undefined)
  const records = data?.data ?? []

  return (
    <PageContainer
      title="运行中心"
      description="采集入库的结构化数据记录"
      actions={
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索记录内容…"
            className="pl-8"
          />
        </div>
      }
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
      ) : records.length === 0 ? (
        <EmptyState title="暂无记录" description="采集任务完成后，数据记录会显示在此。" />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>内容</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>AI 富化</TableHead>
                <TableHead>采集时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-md truncate font-medium">
                    {recordTitle(r.normalized_data ?? r.raw_data ?? {})}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.ai_enrichment && Object.keys(r.ai_enrichment).length > 0 ? '已富化' : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatRelative(r.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContainer>
  )
}
