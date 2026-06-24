import axios from 'axios'

export const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

export const rootClient = axios.create({
  headers: { 'Content-Type': 'application/json' },
})

const normalizeApiError = (err: unknown) => {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.error || err.message || 'Unknown error'
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
