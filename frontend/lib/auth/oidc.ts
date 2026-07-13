import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'

let manager: UserManager | null = null

export function isOidcConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_OIDC_AUTHORITY?.trim() &&
      process.env.NEXT_PUBLIC_OIDC_CLIENT_ID?.trim(),
  )
}

export function getOidcManager(): UserManager | null {
  if (typeof window === 'undefined' || !isOidcConfigured()) return null
  if (manager) return manager

  const origin = window.location.origin
  const sessionStore = new WebStorageStateStore({ store: window.sessionStorage })
  manager = new UserManager({
    authority: process.env.NEXT_PUBLIC_OIDC_AUTHORITY!.trim(),
    client_id: process.env.NEXT_PUBLIC_OIDC_CLIENT_ID!.trim(),
    redirect_uri: process.env.NEXT_PUBLIC_OIDC_REDIRECT_URI?.trim() || `${origin}/auth/callback`,
    post_logout_redirect_uri:
      process.env.NEXT_PUBLIC_OIDC_POST_LOGOUT_REDIRECT_URI?.trim() || `${origin}/login`,
    response_type: 'code',
    scope: process.env.NEXT_PUBLIC_OIDC_SCOPE?.trim() || 'openid profile email',
    automaticSilentRenew: true,
    loadUserInfo: false,
    monitorSession: false,
    revokeTokensOnSignout: true,
    stateStore: sessionStore,
    userStore: sessionStore,
  })
  return manager
}

export function oidcReturnTo(user: User): string {
  const state = user.state
  if (!state || typeof state !== 'object' || !('returnTo' in state)) return '/studio/workflow'
  const returnTo = (state as { returnTo?: unknown }).returnTo
  return sanitizeReturnTo(returnTo)
}

export function sanitizeReturnTo(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/studio/workflow'
}
