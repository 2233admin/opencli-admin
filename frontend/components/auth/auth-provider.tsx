'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { getCurrentIdentity } from '@/lib/api/endpoints'
import { AUTH_REQUIRED_EVENT } from '@/lib/api/auth-events'
import { setApiAuthToken } from '@/lib/api/auth-token'
import { getOidcManager, isOidcConfigured, oidcReturnTo, sanitizeReturnTo } from '@/lib/auth/oidc'
import {
  clearIdentityToken,
  getBootstrapIdentityToken,
  hasDevelopmentSession,
  isDevelopmentLoginAllowed,
  persistBootstrapIdentityToken,
  setDevelopmentSession,
  setRuntimeIdentityToken,
} from '@/lib/auth/session'
import type { AuthIdentity, AuthStatus } from '@/lib/auth/types'

type AuthContextValue = {
  status: AuthStatus
  identity: AuthIdentity | null
  oidcEnabled: boolean
  developmentLoginEnabled: boolean
  signInWithOidc: (returnTo?: string, fleetToken?: string) => Promise<void>
  completeOidcSignIn: () => Promise<string>
  signInWithBootstrap: (identityToken: string, fleetToken?: string) => Promise<void>
  enterDevelopmentMode: (fleetToken?: string) => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const DEVELOPMENT_IDENTITY: AuthIdentity = {
  subject: 'local-development',
  email: null,
  name: 'Local Development',
  is_platform_admin: true,
  auth_method: 'development',
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [identity, setIdentity] = useState<AuthIdentity | null>(null)
  const oidcEnabled = isOidcConfigured()
  const developmentLoginEnabled = isDevelopmentLoginAllowed()

  const acceptIdentityToken = useCallback(async (token: string) => {
    setRuntimeIdentityToken(token)
    try {
      const nextIdentity = await getCurrentIdentity()
      setIdentity(nextIdentity)
      setStatus('authenticated')
      setDevelopmentSession(false)
      return nextIdentity
    } catch (error) {
      setRuntimeIdentityToken('')
      throw error
    }
  }, [])

  const becomeAnonymous = useCallback(() => {
    clearIdentityToken()
    setDevelopmentSession(false)
    setIdentity(null)
    setStatus('anonymous')
  }, [])

  useEffect(() => {
    let active = true

    async function restoreSession() {
      try {
        const oidcUser = await getOidcManager()?.getUser()
        if (oidcUser && !oidcUser.expired) {
          await acceptIdentityToken(oidcUser.access_token)
          return
        }

        const bootstrapToken = getBootstrapIdentityToken()
        if (bootstrapToken) {
          await acceptIdentityToken(bootstrapToken)
          return
        }

        if (developmentLoginEnabled && hasDevelopmentSession()) {
          if (!active) return
          setIdentity(DEVELOPMENT_IDENTITY)
          setStatus('authenticated')
          return
        }
      } catch {
        clearIdentityToken()
      }
      if (active) {
        setIdentity(null)
        setStatus('anonymous')
      }
    }

    void restoreSession()
    return () => {
      active = false
    }
  }, [acceptIdentityToken, developmentLoginEnabled])

  useEffect(() => {
    const manager = getOidcManager()
    if (!manager) return

    const onUserLoaded = (user: { access_token: string }) => {
      void acceptIdentityToken(user.access_token)
    }
    const onSessionEnded = () => becomeAnonymous()

    manager.events.addUserLoaded(onUserLoaded)
    manager.events.addUserUnloaded(onSessionEnded)
    manager.events.addAccessTokenExpired(onSessionEnded)
    return () => {
      manager.events.removeUserLoaded(onUserLoaded)
      manager.events.removeUserUnloaded(onSessionEnded)
      manager.events.removeAccessTokenExpired(onSessionEnded)
    }
  }, [acceptIdentityToken, becomeAnonymous])

  useEffect(() => {
    const onAuthRequired = () => {
      if (developmentLoginEnabled && hasDevelopmentSession()) return
      becomeAnonymous()
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
  }, [becomeAnonymous, developmentLoginEnabled])

  const signInWithOidc = useCallback(async (returnTo = '/canvas', fleetToken?: string) => {
    const manager = getOidcManager()
    if (!manager) throw new Error('OIDC 登录尚未配置')
    if (fleetToken !== undefined) setApiAuthToken(fleetToken)
    await manager.signinRedirect({ state: { returnTo: sanitizeReturnTo(returnTo) } })
  }, [])

  const completeOidcSignIn = useCallback(async () => {
    const manager = getOidcManager()
    if (!manager) throw new Error('OIDC 登录尚未配置')
    const user = await manager.signinRedirectCallback()
    await acceptIdentityToken(user.access_token)
    return oidcReturnTo(user)
  }, [acceptIdentityToken])

  const signInWithBootstrap = useCallback(
    async (identityToken: string, fleetToken?: string) => {
      const trimmed = identityToken.trim()
      if (!trimmed) throw new Error('请输入管理员身份令牌')
      if (fleetToken !== undefined) setApiAuthToken(fleetToken)
      await acceptIdentityToken(trimmed)
      persistBootstrapIdentityToken(trimmed)
    },
    [acceptIdentityToken],
  )

  const enterDevelopmentMode = useCallback(
    (fleetToken?: string) => {
      if (!developmentLoginEnabled) throw new Error('本地开发模式不可用')
      if (fleetToken !== undefined) setApiAuthToken(fleetToken)
      clearIdentityToken()
      setDevelopmentSession(true)
      setIdentity(DEVELOPMENT_IDENTITY)
      setStatus('authenticated')
    },
    [developmentLoginEnabled],
  )

  const signOut = useCallback(async () => {
    const manager = getOidcManager()
    const oidcUser = await manager?.getUser()
    becomeAnonymous()
    if (!manager || !oidcUser) return
    try {
      await manager.signoutRedirect()
    } catch {
      await manager.removeUser()
    }
  }, [becomeAnonymous])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      identity,
      oidcEnabled,
      developmentLoginEnabled,
      signInWithOidc,
      completeOidcSignIn,
      signInWithBootstrap,
      enterDevelopmentMode,
      signOut,
    }),
    [
      completeOidcSignIn,
      developmentLoginEnabled,
      enterDevelopmentMode,
      identity,
      oidcEnabled,
      signInWithBootstrap,
      signInWithOidc,
      signOut,
      status,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
