"use client"

import { useEffect } from "react"

export function ErrorLogger() {
  useEffect(() => {
    const seen = { first: false }

    const logFirst = (label: string, detail: unknown) => {
      if (seen.first) {
        console.warn(`[ErrorLogger:${label}] (subsequent)`, detail)
        return
      }
      seen.first = true
      // eslint-disable-next-line no-console
      console.error(`[ErrorLogger:${label}] FIRST ERROR`, detail)
    }

    const onError = (e: ErrorEvent) => {
      logFirst("window.error", {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error?.stack,
      })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { message?: string; stack?: string } | string
      logFirst("unhandledrejection", {
        reason: typeof reason === "string" ? reason : reason?.message,
        stack: typeof reason === "object" ? reason?.stack : undefined,
      })
    }

    // Patch console.error to surface React internal errors
    const origErr = console.error
    console.error = (...args: unknown[]) => {
      try {
        logFirst("console.error", args.map((a) => {
          if (a instanceof Error) return { message: a.message, stack: a.stack }
          return a
        }))
      } catch {}
      origErr.apply(console, args as Parameters<typeof console.error>)
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)

    // Long-task detector: if the main thread blocks >1s, log it (freeze signal)
    let po: PerformanceObserver | undefined
    try {
      po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 500) {
            // eslint-disable-next-line no-console
            console.warn("[ErrorLogger:longtask]", {
              duration: Math.round(entry.duration),
              startTime: Math.round(entry.startTime),
              name: entry.name,
            })
          }
        }
      })
      po.observe({ entryTypes: ["longtask"] })
    } catch {}

    // eslint-disable-next-line no-console
    console.info("[ErrorLogger] armed")

    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
      console.error = origErr
      po?.disconnect()
    }
  }, [])

  return null
}
