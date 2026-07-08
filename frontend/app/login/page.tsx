'use client'

import { KeyRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { setApiAuthToken } from '@/lib/api/auth-token'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setApiAuthToken(token)
    toast.success(token.trim() ? '已保存访问令牌' : '已进入本地无鉴权模式')
    router.push('/canvas')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="grid size-11 place-items-center rounded-lg bg-primary font-mono text-sm font-bold text-primary-foreground">
            OC
          </span>
          <h1 className="text-xl font-semibold tracking-tight">OpenCLI Admin</h1>
          <p className="text-sm text-muted-foreground text-balance">
            采集编排控制台 — 以节点工作流为核心
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>登录</CardTitle>
            <CardDescription>
              输入 API 访问令牌（Bearer Token）以连接后端。本地无鉴权后端可留空直接进入。
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="token">访问令牌</FieldLabel>
                  <Input
                    id="token"
                    type="password"
                    placeholder="粘贴 API_AUTH_TOKEN…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoComplete="off"
                  />
                  <FieldDescription>
                    令牌仅保存在本浏览器（localStorage），随每次请求以 Bearer 头发送。
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="mt-6 flex-col gap-2">
              <Button type="submit" className="w-full" disabled={submitting}>
                <KeyRound data-icon="inline-start" />
                进入控制台
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </main>
  )
}
