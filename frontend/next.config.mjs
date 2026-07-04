/** @type {import('next').NextConfig} */

// Proxy /api/v1/* to the real FastAPI backend. Override BACKEND_URL when the
// backend is not running on the local clone's default API port.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8031"

const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  typescript: {
    ignoreBuildErrors: true,
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
