'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'
import { LibraryBig } from 'lucide-react'

import { Ripple } from '@/components/motion/ripple'
import { RssCatalogImportDialog } from '@/components/plugins/rss-catalog-import-dialog'
import { TemplateCatalog } from '@/components/plugins/template-catalog'
import { EmptyState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type PluginSubtype = 'datasource' | 'template' | 'tool' | 'agent' | 'trigger' | 'extension'

const SUBTYPES: { key: PluginSubtype; label: string }[] = [
  { key: 'datasource', label: '源库' },
  { key: 'template', label: '模板' },
  { key: 'tool', label: '工具' },
  { key: 'agent', label: 'Agent' },
  { key: 'trigger', label: '触发器' },
  { key: 'extension', label: '扩展' },
]

const PLACEHOLDER_DESCRIPTION: Record<Exclude<PluginSubtype, 'datasource' | 'template'>, string> = {
  tool: '连接外部工具与 API，扩展工作流中可调用的能力。',
  agent: '安装预置的分析与判断 Agent，用于富化采集到的数据。',
  trigger: '安装可复用的触发规则，按事件或计划驱动自动化运行。',
  extension: '扩展控制台能力的其他插件与集成。',
}

function isPluginSubtype(value: string | null): value is PluginSubtype {
  return SUBTYPES.some((subtype) => subtype.key === value)
}

/**
 * Segmented subtype switcher, styled to match `RouteTabs`
 * (components/shell/route-tabs.tsx) — but this hub is a single page with
 * subtype *content*, not sibling routes, so `RouteTabs` itself (which derives
 * its active state from `usePathname()`) doesn't apply here. State lives in
 * the `?type=` search param instead, so a tab is still linkable/shareable.
 */
function PluginTypeTabs({ active, onSelect }: { active: PluginSubtype; onSelect: (next: PluginSubtype) => void }) {
  return (
    <nav aria-label="插件类型" className="inline-flex w-fit items-center gap-1 rounded-full bg-muted p-1">
      {SUBTYPES.map((subtype) => {
        const isActive = subtype.key === active
        return (
          <button
            key={subtype.key}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(subtype.key)}
            className={cn(
              'relative overflow-hidden rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {isActive ? (
              <motion.span
                layoutId="plugin-hub-tab-pill"
                className="absolute inset-0 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 460, damping: 38, mass: 0.6 }}
              />
            ) : null}
            <span className="relative">{subtype.label}</span>
            <Ripple />
          </button>
        )
      })}
    </nav>
  )
}

function DatasourceLibraryTab() {
  const [importOpen, setImportOpen] = useState(false)
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="group flex min-h-48 flex-col rounded-md border bg-background/60 p-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted/40">
              <LibraryBig aria-hidden="true" className="size-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">RSS 开源源库</h3>
              <Badge variant="outline" className="mt-1 h-5 px-1.5 text-3xs">
                数据源
              </Badge>
            </div>
          </div>
          <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">
            从 GitHub OPML 源包批量导入分类好的 RSS 数据源，导入后默认停用，审核通过再启用采集。
          </p>
          <span className="mt-auto border-t pt-3 text-xs font-medium text-foreground">
            安装 <span aria-hidden="true">→</span>
          </span>
        </button>
      </div>
      <RssCatalogImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  )
}

export default function PluginHubPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawType = searchParams.get('type')
  const active: PluginSubtype = isPluginSubtype(rawType) ? rawType : 'datasource'

  function selectSubtype(next: PluginSubtype) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'datasource') params.delete('type')
    else params.set('type', next)
    const query = params.toString()
    router.push(query ? `/plugins?${query}` : '/plugins', { scroll: false })
  }

  return (
    <PageContainer
      eyebrow="Plugin Hub"
      title="插件中心"
      description="像应用市场一样浏览、安装和管理可插拔能力——源库、模板、工具、Agent、触发器与扩展统一入口。"
      tabs={<PluginTypeTabs active={active} onSelect={selectSubtype} />}
    >
      {active === 'datasource' ? (
        <DatasourceLibraryTab />
      ) : active === 'template' ? (
        <TemplateCatalog />
      ) : (
        <EmptyState title="即将上线" description={PLACEHOLDER_DESCRIPTION[active]} />
      )}
    </PageContainer>
  )
}
