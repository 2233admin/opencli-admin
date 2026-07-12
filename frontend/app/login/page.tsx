'use client'

import { KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { toast } from 'sonner'

import FaultyTerminal from '@/components/FaultyTerminal'
import { useAuth } from '@/components/auth/auth-provider'
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
import { Separator } from '@/components/ui/separator'
import { sanitizeReturnTo } from '@/lib/auth/oidc'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    status,
    oidcEnabled,
    developmentLoginEnabled,
    signInWithOidc,
    signInWithBootstrap,
    enterDevelopmentMode,
  } = useAuth()
  const [identityToken, setIdentityToken] = useState('')
  const [fleetToken, setFleetToken] = useState('')
  const [submitting, setSubmitting] = useState<'oidc' | 'bootstrap' | 'development' | null>(null)
  const [reduceMotion, setReduceMotion] = useState(true)
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'))

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPreference = () => setReduceMotion(mediaQuery.matches)
    syncPreference()
    mediaQuery.addEventListener('change', syncPreference)
    return () => mediaQuery.removeEventListener('change', syncPreference)
  }, [])

  useEffect(() => {
    if (status === 'authenticated') router.replace(returnTo)
  }, [returnTo, router, status])

  const optionalFleetToken = fleetToken.trim() || undefined

  async function startOidcLogin() {
    setSubmitting('oidc')
    try {
      await signInWithOidc(returnTo, optionalFleetToken)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法启动 OIDC 登录')
      setSubmitting(null)
    }
  }

  async function handleBootstrapLogin(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting('bootstrap')
    try {
      await signInWithBootstrap(identityToken, optionalFleetToken)
      toast.success('管理员身份验证成功')
      router.replace(returnTo)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '身份验证失败')
      setSubmitting(null)
    }
  }

  function handleDevelopmentLogin() {
    setSubmitting('development')
    try {
      enterDevelopmentMode(optionalFleetToken)
      router.replace(returnTo)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法进入本地开发模式')
      setSubmitting(null)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#070604] text-white">
      <div className="absolute inset-0 opacity-90" aria-hidden="true">
        <FaultyTerminal
          tint="#F97316"
          scale={1.35}
          gridMul={[2, 1]}
          digitSize={1.2}
          timeScale={0.22}
          pause={reduceMotion}
          scanlineIntensity={0.35}
          glitchAmount={0.65}
          flickerAmount={0.25}
          noiseAmp={0.85}
          chromaticAberration={0.5}
          curvature={0.08}
          mouseReact={!reduceMotion}
          mouseStrength={0.12}
          dpr={1}
          pageLoadAnimation={!reduceMotion}
          brightness={0.9}
        />
      </div>
      <div
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,6,4,0.08),rgba(7,6,4,0.62)_52%,rgba(7,6,4,0.94)),linear-gradient(0deg,rgba(7,6,4,0.7),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto grid min-h-screen w-full max-w-7xl items-center gap-12 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:px-12">
        <section className="hidden max-w-2xl lg:block" aria-label="产品介绍">
          <div className="mb-8 flex items-center gap-3 font-mono text-sm text-orange-300">
            <span className="grid size-10 place-items-center rounded-md border border-orange-400/40 bg-orange-500/15 font-bold text-orange-200">
              OC
            </span>
            OPENCLI / CONTROL PLANE
          </div>
          <p className="mb-4 font-mono text-xs tracking-[0.22em] text-orange-300/80">
            COLLECT · ORCHESTRATE · OPERATE
          </p>
          <h1 className="max-w-xl text-balance text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            把分散的数据能力，编排成持续运行的系统。
          </h1>
          <p className="mt-6 max-w-lg text-pretty text-base leading-7 text-white/60">
            从采集节点、自动化执行到交付与消费，在同一个运营控制台里观察、修复和扩展。
          </p>
        </section>

        <div className="mx-auto flex w-full max-w-sm flex-col gap-6 lg:mx-0">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="grid size-11 place-items-center rounded-lg border border-orange-400/40 bg-orange-500/15 font-mono text-sm font-bold text-orange-100">
              OC
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">OpenCLI Admin</h1>
              <p className="text-sm text-white/55">采集编排与运营控制台</p>
            </div>
          </div>

          <Card className="border-white/12 bg-background/92 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>登录控制台</CardTitle>
              <CardDescription>
                使用组织账号登录；Bootstrap Admin 仅用于首次部署和紧急恢复。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {oidcEnabled ? (
                <Button className="w-full" disabled={submitting !== null} onClick={startOidcLogin}>
                  {submitting === 'oidc' ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
                  使用组织账号登录
                </Button>
              ) : (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                  当前未配置 OIDC。设置 <code>NEXT_PUBLIC_OIDC_AUTHORITY</code> 和{' '}
                  <code>NEXT_PUBLIC_OIDC_CLIENT_ID</code> 后即可启用组织账号登录。
                </div>
              )}

              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">紧急管理员访问</span>
                <Separator className="flex-1" />
              </div>

              <form id="bootstrap-login" onSubmit={handleBootstrapLogin}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="identity-token">管理员身份令牌</FieldLabel>
                    <Input
                      id="identity-token"
                      type="password"
                      placeholder="BOOTSTRAP_ADMIN_TOKEN"
                      value={identityToken}
                      onChange={(event) => setIdentityToken(event.target.value)}
                      autoComplete="off"
                    />
                    <FieldDescription>验证成功后仅保存在当前标签页会话中。</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fleet-token">Fleet API 令牌（可选）</FieldLabel>
                    <Input
                      id="fleet-token"
                      type="password"
                      placeholder="API_AUTH_TOKEN"
                      value={fleetToken}
                      onChange={(event) => setFleetToken(event.target.value)}
                      autoComplete="off"
                    />
                    <FieldDescription>
                      后端启用 Fleet Auth 时填写；留空沿用部署配置或浏览器中已有值。
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button
                type="submit"
                form="bootstrap-login"
                variant={oidcEnabled ? 'outline' : 'default'}
                className="w-full"
                disabled={submitting !== null}
              >
                {submitting === 'bootstrap' ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
                使用管理员令牌登录
              </Button>
              {developmentLoginEnabled ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  disabled={submitting !== null}
                  onClick={handleDevelopmentLogin}
                >
                  {submitting === 'development' && <LoaderCircle className="animate-spin" />}
                  进入本地开发模式
                </Button>
              ) : null}
            </CardFooter>
          </Card>
          <p className="text-center font-mono text-[11px] tracking-wide text-white/35">
            LOCAL-FIRST · AUDITABLE · NODE-NATIVE
          </p>
        </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
