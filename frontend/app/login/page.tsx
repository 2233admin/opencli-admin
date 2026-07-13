'use client'

import { KeyRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { useAuth } from '@/components/auth/auth-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const router = useRouter()
  const { enterDevelopmentMode, signInWithBootstrap, developmentLoginEnabled } = useAuth()
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      if (token.trim()) await signInWithBootstrap(token.trim())
      else enterDevelopmentMode()
      toast.success(token.trim() ? '已验证访问令牌' : '已进入本地开发模式')
      router.push('/studio/workflow')
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '登录失败')
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="grid size-11 place-items-center rounded-lg bg-primary font-mono text-sm font-bold text-primary-foreground">OC</span>
          <h1 className="text-xl font-semibold tracking-tight">OpenCLI Admin</h1>
          <p className="text-sm text-muted-foreground">采集编排控制台 — 以节点工作流为核心</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>登录</CardTitle>
            <CardDescription>输入身份令牌连接后端；本地开发环境可以留空进入。</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="token">身份令牌</FieldLabel>
                  <Input id="token" type="password" placeholder="粘贴身份令牌…" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" />
                  <FieldDescription>{developmentLoginEnabled ? '当前允许本地开发模式。' : '当前环境必须提供有效令牌。'}</FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="mt-6">
              <Button type="submit" className="w-full" disabled={submitting || (!developmentLoginEnabled && !token.trim())}>
                <KeyRound data-icon="inline-start" />进入控制台
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </main>
  )
}
