'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import * as api from '@/lib/api/endpoints'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

/**
 * Installs the open-source RSS OPML catalog as disabled data sources.
 *
 * Extracted from the old sources/page.tsx "导入 RSS 源库" action — this is a
 * catalog/install action (Plugin Hub concern), not instance management, so it
 * now lives under the Plugin Hub's 源库 tab. sources/page.tsx only manages
 * already-installed data source instances.
 */
export function RssCatalogImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [catalogUrl, setCatalogUrl] = useState<string>(RSS_CATALOG_PRESETS[0].url)
  const queryClient = useQueryClient()

  const importCatalog = useMutation({
    mutationFn: () => api.importRssCatalog(catalogUrl.trim()),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      toast.success(
        `已导入 ${result.created.length} 个 RSS 数据源，跳过 ${result.skipped_existing.length} 个重复项`,
      )
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
  )
}
