import {
  getIdentityAccessToken,
  hasDevelopmentSession,
  isDevelopmentLoginAllowed,
} from '@/lib/auth/session'

import { getApiAuthToken } from './auth-token'

export type ApiAuthHeaders = {
  Authorization?: string
  'X-API-Token'?: string
  'X-OpenCLI-Development-Identity'?: string
}

export function getApiAuthHeaders(authorizationOverride?: string | null): ApiAuthHeaders {
  const identityToken = getIdentityAccessToken()
  const fleetToken = getApiAuthToken()
  const developmentIdentity =
    isDevelopmentLoginAllowed() && hasDevelopmentSession()
      ? { 'X-OpenCLI-Development-Identity': 'local-development' as const }
      : {}

  if (authorizationOverride) {
    return {
      Authorization: authorizationOverride,
      ...(identityToken && fleetToken ? { 'X-API-Token': fleetToken } : {}),
      ...developmentIdentity,
    }
  }
  if (identityToken) {
    return {
      Authorization: `Bearer ${identityToken}`,
      ...(fleetToken ? { 'X-API-Token': fleetToken } : {}),
      ...developmentIdentity,
    }
  }
  return {
    ...(fleetToken ? { Authorization: `Bearer ${fleetToken}` } : {}),
    ...developmentIdentity,
  }
}

