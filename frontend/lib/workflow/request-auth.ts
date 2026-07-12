import { getApiAuthHeaders, type ApiAuthHeaders } from '@/lib/api/auth-headers'

export function workflowRequestAuthHeaders(authorization?: string | null): ApiAuthHeaders {
  return getApiAuthHeaders(authorization)
}

export function forwardedRequestAuthHeaders(request: Request): ApiAuthHeaders {
  const authorization = request.headers.get('authorization')
  const fleetToken = request.headers.get('x-api-token')
  return {
    ...(authorization ? { Authorization: authorization } : {}),
    ...(fleetToken ? { 'X-API-Token': fleetToken } : {}),
  }
}
