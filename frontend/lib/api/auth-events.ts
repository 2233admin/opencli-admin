export const AUTH_REQUIRED_EVENT = 'opencli:auth-required'

export function notifyAuthRequired(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
}

