'use client'

import { AlertCircle, LoaderCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { useAuth } from '@/components/auth/auth-provider'
import { Button } from '@/components/ui/button'

export default function AuthCallbackPage() {
  const router = useRouter()
  const { completeOidcSignIn } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    completeOidcSignIn()
      .then((returnTo) => {
        if (active) router.replace(returnTo)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'OIDC 登录回调失败')
      })
    return () => {
      active = false
    }
  }, [completeOidcSignIn, router])

  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        {error ? (
          <>
            <AlertCircle className="size-8 text-destructive" />
            <div>
              <h1 className="font-semibold">登录未完成</h1>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
            <Button onClick={() => router.replace('/login')}>返回登录</Button>
          </>
        ) : (
          <>
            <LoaderCircle className="size-8 animate-spin text-primary" />
            <div>
              <h1 className="font-semibold">正在完成登录</h1>
              <p className="mt-1 text-sm text-muted-foreground">正在验证身份并建立控制台会话…</p>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
