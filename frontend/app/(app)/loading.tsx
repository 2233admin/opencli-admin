import { LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'

export default function AppLoading() {
  return (
    <PageContainer eyebrow="Loading" title="正在准备工作区" description="导航保持可用，内容加载完成后会自动显示。">
      <LoadingState rows={5} />
    </PageContainer>
  )
}
