import { AuthGate } from '@/components/auth/auth-gate'
import { AppShell } from '@/components/shell/app-shell'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  )
}
