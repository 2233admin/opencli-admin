'use client'

import { useProviders } from '@/lib/api/hooks'
import { PrimaryModelCard } from '@/components/providers/primary-model-card'
import { BACKEND_HINT, ErrorState, LoadingState } from '@/components/shell/data-states'

export default function ProvidersPage() {
  const { data, isLoading, isError, error } = useProviders()

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />

  return <PrimaryModelCard providers={data?.data ?? []} />
}
