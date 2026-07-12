import { getIdentityAccessToken } from '@/lib/auth/session'

import { getApiAuthToken } from './auth-token'

export type ApiAuthHeaders = {
  Authorization?: string
  'X-API-Token'?: string
}

export function getApiAuthHeaders(authorizationOverride?: string | null): ApiAuthHeaders {
  const identityToken = getIdentityAccessToken()
  const fleetToken = getApiAuthToken()

  if (authorizationOverride) {
    return {
      Authorization: authorizationOverride,
      ...(identityToken && fleetToken ? { 'X-API-Token': fleetToken } : {}),
    }
  }
  if (identityToken) {
    return {
      Authorization: `Bearer ${identityToken}`,
      ...(fleetToken ? { 'X-API-Token': fleetToken } : {}),
    }
  }
  return fleetToken ? { Authorization: `Bearer ${fleetToken}` } : {}
}
