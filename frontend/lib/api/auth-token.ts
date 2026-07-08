// Fleet auth token resolution (ADR-0005, closeout issue 04).
//
// The backend guards every /api route with a static bearer token once
// API_AUTH_TOKEN is configured. The frontend attaches it centrally via the
// axios request interceptors in src/api/client.ts — never per call.
//
// Token source, in priority order:
//   1. localStorage 'apiAuthToken' — runtime override, wins so the operator
//      can set the token once per browser without rebuilding the bundle.
//   2. VITE_API_AUTH_TOKEN — baked in at build time.
// Empty result = no header attached (dev posture: tokenless localhost API).

export const API_AUTH_TOKEN_KEY = 'apiAuthToken'

/**
 * Pure resolution logic (node --test friendly): the stored runtime override
 * wins over the build-time token; blank/whitespace values count as unset.
 */
export function resolveApiAuthToken(
  buildToken: string | null | undefined,
  storedToken: string | null | undefined,
): string {
  const stored = typeof storedToken === 'string' ? storedToken.trim() : ''
  if (stored) return stored
  return typeof buildToken === 'string' ? buildToken.trim() : ''
}

function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Current effective token for this browser session ('' = none). */
export function getApiAuthToken(): string {
  // Next.js inlines NEXT_PUBLIC_* at build time; safe to read on the client.
  const buildToken = process.env.NEXT_PUBLIC_API_AUTH_TOKEN
  return resolveApiAuthToken(buildToken, safeGetItem(API_AUTH_TOKEN_KEY))
}

/** Persist a runtime token override for this browser ('' clears it). */
export function setApiAuthToken(token: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    const trimmed = token.trim()
    if (trimmed) localStorage.setItem(API_AUTH_TOKEN_KEY, trimmed)
    else localStorage.removeItem(API_AUTH_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}
