"use client"

import { useEffect } from "react"

import { getHealth } from "@/lib/api/endpoints"

export function HealthCheckGate() {
  useEffect(() => {
    void getHealth().catch((error) => {
      console.debug("Backend health check failed", error)
    })
  }, [])

  return null
}
