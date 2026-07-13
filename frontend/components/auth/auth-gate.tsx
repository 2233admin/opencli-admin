'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { loader, Matrix } from '@/components/unlumen-ui/matrix'

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
        <div className="flex flex-col items-center gap-4 text-sm text-muted-foreground" role="status">
          <Matrix
            rows={7}
            cols={7}
            frames={loader}
            fps={10}
            size={5}
            gap={2}
            palette={{ on: 'var(--color-primary)', off: 'var(--color-muted-foreground)' }}
            ariaLabel="正在加载"
          />
          <span>{status === 'loading' ? '正在恢复会话…' : '正在前往登录…'}</span>
        </div>
      </main>
    )
  }

  return children
}
