import { ProviderManagementPanel } from '@/components/providers/provider-management-panel'
import { RssGeneratorProviderPanel } from '@/components/providers/rss-generator-provider-panel'

export default function ProviderCatalogPage() {
  return (
    <div className="flex flex-col gap-8">
      <ProviderManagementPanel />
      <RssGeneratorProviderPanel />
    </div>
  )
}
