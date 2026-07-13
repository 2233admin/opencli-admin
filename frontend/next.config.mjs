/** @type {import('next').NextConfig} */

import path from "node:path"
import { fileURLToPath } from "node:url"

// Proxy /api/v1/* to the real FastAPI backend. Override BACKEND_URL when the
// backend is not running on the local clone's default API port.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"
const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url))
const VIEW_TRANSITIONS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_VIEW_TRANSITIONS !== 'false'

const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  experimental: {
    viewTransition: VIEW_TRANSITIONS_ENABLED,
  },
  turbopack: {
    root: FRONTEND_ROOT,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${BACKEND_URL}/api/v1/:path*`,
      },
      {
        source: '/health',
        destination: `${BACKEND_URL}/health`,
      },
    ]
  },
}

export default nextConfig
