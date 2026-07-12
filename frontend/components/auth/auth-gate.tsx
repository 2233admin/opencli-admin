'use client'

import { LoaderCircle } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useAuth } from './auth-provider'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`)
    }
  }, [pathname, router, status])

  if (status !== 'authenticated') {
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {status === 'loading' ? '正在恢复会话…' : '正在前往登录…'}
        </div>
      </main>
    )
  }

  return children
}
