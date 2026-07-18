'use client'

import Link from 'next/link'

import { useProviders } from '@/lib/api/hooks'
import { ModelDefaultsCard } from '@/components/providers/model-defaults-card'
import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { Button } from '@/components/ui/button'

export default function ModelRoutingPage() {
  const { data, isLoading, isError, error } = useProviders()
  const providers = data?.data ?? []

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
  if (providers.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState
          title="先添加一个供应商"
          description="模型路由需要至少一个可用供应商。"
        />
        <div>
          <Button render={<Link href="/providers/catalog" />}>
            前往供应商设置
          </Button>
        </div>
      </div>
    )
  }

  return <ModelDefaultsCard providers={providers} />
}
