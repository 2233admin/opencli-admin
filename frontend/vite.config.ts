import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function getPackageName(id: string) {
  const normalizedId = id.replace(/\\/g, '/')
  const match = normalizedId.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)

  return match?.[1] ?? 'misc'
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          const packageName = getPackageName(id)

          if (packageName.startsWith('@xyflow/')) return 'topology-xyflow'
          if (['elkjs', 'react-grid-layout', 'react-resizable'].includes(packageName)) {
            return 'topology-layout'
          }
          if (['react-router', 'react-router-dom', '@remix-run/router'].includes(packageName)) return 'react-router'
          if (['react', 'react-dom', 'scheduler'].includes(packageName)) return 'react-core'
          if (packageName === '@tanstack/react-query' || packageName === 'axios') return 'data-client'
          if (packageName === '@tanstack/react-table') return 'table-vendor'
          if (packageName.startsWith('@radix-ui/') || ['cmdk', 'sonner'].includes(packageName)) return 'headless-ui'
          if (packageName === 'lucide-react') return 'icons'
          if (packageName.startsWith('date-fns') || packageName.includes('i18next')) return 'intl'
          if (packageName === 'recharts') return 'charts'

          return undefined
        },
      },
    },
  },
  server: {
    host: true,
    // Prefer the platform-provided DEV_PORT (e.g. v0 preview expects it) and
    // fall back to the project's conventional 8030 for local development.
    port: Number(process.env.DEV_PORT) || 8030,
    // Allow requests from Docker containers (host.docker.internal) and any LAN IP
    // Dev-only: production uses nginx which doesn't have this restriction
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8031',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Pass original host so the API can build correct public URLs (e.g. install scripts)
            const host = req.headers['host']
            if (host) {
              proxyReq.setHeader('X-Forwarded-Host', host)
              proxyReq.setHeader('X-Forwarded-Proto', 'http')
            }
          })
        },
      },
      '/health': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8031',
        changeOrigin: true,
      },
    },
  },
})
