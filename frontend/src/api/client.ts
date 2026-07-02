import axios, { type InternalAxiosRequestConfig } from 'axios'

import { getApiAuthToken } from '../lib/apiAuthToken.ts'

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

const normalizeApiError = (err: unknown) => {
  if (axios.isAxiosError(err)) {
    const message =
      err.response?.data?.error || err.response?.data?.detail || err.message || 'Unknown error'
    return Promise.reject(new Error(message))
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
