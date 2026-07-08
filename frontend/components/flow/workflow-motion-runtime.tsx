"use client"

import { useEffect, useMemo, useRef } from "react"
import gsap from "gsap"
import { animate } from "animejs"
import type { NodeInteractionProbe } from "@/lib/flow/helper-lines"

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value)
  return value.replace(/["\\]/g, "\\$&")
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function WorkflowMotionRuntime({ interaction }: { interaction?: NodeInteractionProbe }) {
  const lastSignature = useRef("")
  const signature = useMemo(
    () =>
      interaction?.targets
        .map((target) => `${target.id}:${target.state}:${Math.round(target.distance)}`)
        .join("|") ?? "",
    [interaction],
  )

  useEffect(() => {
    if (!interaction || !signature || signature === lastSignature.current || prefersReducedMotion()) return
    lastSignature.current = signature

    const targetIds = interaction.targets.map((target) => target.id)
    for (const target of interaction.targets) {
      const nodeElement = document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${cssEscape(target.id)}"] [data-workflow-node="true"]`,
      )
      if (!nodeElement) continue
      gsap.killTweensOf(nodeElement)
      gsap.fromTo(
        nodeElement,
        {
          scale: 1,
        },
        {
          scale: target.state === "overlap" ? 1.018 : 1.01,
          duration: target.state === "overlap" ? 0.16 : 0.12,
          ease: "power2.out",
          yoyo: true,
          repeat: 1,
          overwrite: "auto",
        },
      )
    }

    const rings = targetIds
      .map((id) => document.querySelector<SVGRectElement>(`.workflow-proximity-ring[data-target-id="${cssEscape(id)}"]`))
      .filter(Boolean)
    if (rings.length > 0) {
      animate(rings, {
        opacity: [0.28, 0.82, 0.48],
        duration: 420,
        easing: "easeInOutSine",
      })
    }
  }, [interaction, signature])

  return null
}
