import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App'
import './index.css'
import './i18n'

// "ResizeObserver loop completed with undelivered notifications" is a benign
// browser notice (not a real error) triggered when an observed element —
// e.g. ReactFlow nodes/canvas — resizes again within the same frame. The
// browser simply defers delivery to the next frame; nothing is lost. It has
// no error object / stack and cannot be caught in app code, so we filter this
// exact message at the window level to keep error overlays and logs clean.
const RO_LOOP_MESSAGE = 'ResizeObserver loop'
window.addEventListener('error', (event) => {
  if (typeof event.message === 'string' && event.message.includes(RO_LOOP_MESSAGE)) {
    event.stopImmediatePropagation()
    event.preventDefault()
  }
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  </React.StrictMode>
)
