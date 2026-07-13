'use client'

import { useEffect } from 'react'

import { ErrorState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { Button } from '@/components/ui/button'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Application route failed', error)
  }, [error])

  return (
    <PageContainer eyebrow="Recovery" title="当前视图无法显示" description="应用外壳仍可使用，可重试当前视图或切换到其他页面。">
      <ErrorState
        message={error.message || '加载当前视图时发生错误。'}
        hint={error.digest ? `错误标识：${error.digest}` : undefined}
        action={<Button onClick={reset}>重试当前视图</Button>}
      />
    </PageContainer>
  )
}
