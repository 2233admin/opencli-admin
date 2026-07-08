import axios, { type InternalAxiosRequestConfig } from 'axios'

import { getApiAuthToken } from './auth-token'

export const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

export const rootClient = axios.create({
  headers: { 'Content-Type': 'application/json' },
})

// Fleet auth (ADR-0005): attach the static bearer token to every API call
// centrally — never per call site. Token source: VITE_API_AUTH_TOKEN build
// config, overridden by localStorage 'apiAuthToken' (see lib/apiAuthToken.ts).
// Empty token = dev posture (tokenless localhost API): no header attached.
const attachApiAuthToken = (config: InternalAxiosRequestConfig) => {
  const token = getApiAuthToken()
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
}

apiClient.interceptors.request.use(attachApiAuthToken)
rootClient.interceptors.request.use(attachApiAuthToken)

// Plan IR issue 07: a 422 from the Plans API carries a node-anchored error
// LIST in `detail` (backend.plan_ir.validation.PlanValidationError.to_dict()
// shape), not a string. Every other endpoint's `detail` is a string or absent.
// Stringifying `detail` unconditionally (the old behavior) turned that list
// into a useless comma-joined blob for every caller and threw away the
// node_id/edge_id anchors the canvas needs to render errors in place — so
// array details are left OUT of the message and attached raw as `.detail`
// instead, additive to every existing caller that only reads `.message`.
const normalizeApiError = (err: unknown) => {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail
    const detailIsList = Array.isArray(detail)
    const message =
      err.response?.data?.error || (detailIsList ? undefined : detail) || err.message || 'Unknown error'
    const normalized = new Error(message) as Error & { detail?: unknown; status?: number }
    if (detailIsList) normalized.detail = detail
    normalized.status = err.response?.status
    return Promise.reject(normalized)
  }
  return Promise.reject(err)
}

apiClient.interceptors.response.use(
  (res) => res,
  normalizeApiError
)

rootClient.interceptors.response.use(
  (res) => res,
  normalizeApiError
)
