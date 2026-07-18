import type { ReactNode } from 'react'

import { PageContainer } from '@/components/shell/page-container'
import { MODEL_SETTINGS_TABS, RouteTabs } from '@/components/shell/route-tabs'

export default function ModelSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <PageContainer
      eyebrow="PROVIDER RUNTIME"
      title="Provider 与连接"
      description="管理模型连接、自托管 RSS 生成器、健康检查与运行时路由。"
      tabs={<RouteTabs tabs={MODEL_SETTINGS_TABS} />}
    >
      {children}
    </PageContainer>
  )
}
