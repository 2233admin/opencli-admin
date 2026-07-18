'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { Check, Search } from 'lucide-react'

import {
  PROVIDER_PRESET_CATEGORY_LABELS,
  PROVIDER_PRESETS,
  type ProviderPreset,
  type ProviderPresetCategory,
} from '@/lib/provider-presets'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const CATEGORY_ORDER: ProviderPresetCategory[] = [
  'coding_plan',
  'official_api',
  'relay',
  'local',
]

export function ProviderPresetMark({
  preset,
  className,
}: {
  preset: ProviderPreset
  className?: string
}) {
  if (preset.icon) {
    return (
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl border bg-white p-1.5 shadow-sm',
          className,
        )}
        aria-hidden="true"
      >
        <Image src={preset.icon} alt="" width={24} height={24} className="size-6 object-contain" />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-semibold text-white shadow-sm',
        className,
      )}
      style={{ backgroundColor: preset.accent }}
      aria-hidden="true"
    >
      {preset.shortName}
    </span>
  )
}

export function ProviderPresetPicker({
  selectedKey,
  onSelect,
  compact = false,
}: {
  selectedKey?: string | null
  onSelect: (preset: ProviderPreset) => void
  compact?: boolean
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ProviderPresetCategory | 'all'>('all')

  const filteredPresets = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return PROVIDER_PRESETS.filter((preset) => {
      if (category !== 'all' && preset.category !== category) return false
      if (!normalized) return true
      return `${preset.name} ${preset.description} ${preset.key}`.toLowerCase().includes(normalized)
    })
  }, [category, query])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索供应商或网关"
            className="pl-9"
            aria-label="搜索供应商"
          />
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-1 lg:pb-0" aria-label="供应商分类">
          <Button
            type="button"
            size="xs"
            variant={category === 'all' ? 'secondary' : 'ghost'}
            onClick={() => setCategory('all')}
          >
            全部
          </Button>
          {CATEGORY_ORDER.map((item) => (
            <Button
              key={item}
              type="button"
              size="xs"
              variant={category === item ? 'secondary' : 'ghost'}
              onClick={() => setCategory(item)}
            >
              {PROVIDER_PRESET_CATEGORY_LABELS[item]}
            </Button>
          ))}
        </div>
      </div>

      <div
        className={cn(
          'grid gap-2 overflow-y-auto pr-1',
          compact
            ? 'max-h-64 grid-cols-1 sm:grid-cols-2'
            : 'max-h-[31rem] grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
        )}
      >
        {filteredPresets.map((preset) => {
          const selected = preset.key === selectedKey
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => onSelect(preset)}
              className={cn(
                'group relative flex min-h-17 items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors',
                'hover:border-primary/40 hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50',
                selected ? 'border-primary bg-primary/7' : 'border-border bg-card',
              )}
              aria-pressed={selected}
            >
              <ProviderPresetMark preset={preset} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{preset.name}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {preset.description}
                </span>
              </span>
              {selected ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {filteredPresets.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          没有匹配的供应商，可选择“自定义网关”手动填写。
        </p>
      ) : null}
    </div>
  )
}
