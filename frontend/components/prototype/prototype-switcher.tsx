"use client"

import { ArrowLeft, ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"

export type PrototypeVariant = "A" | "B" | "C"

const variants: Array<{
  id: PrototypeVariant
  name: string
  shortName: string
}> = [
  { id: "A", name: "编排优先", shortName: "Builder" },
  { id: "B", name: "控制面优先", shortName: "Control" },
  { id: "C", name: "统一闭环", shortName: "Unified" },
]

type PrototypeSwitcherProps = {
  active: PrototypeVariant
  onChange: (variant: PrototypeVariant) => void
}

export function PrototypeSwitcher({ active, onChange }: PrototypeSwitcherProps) {
  if (process.env.NODE_ENV === "production") {
    return null
  }

  const activeIndex = variants.findIndex((variant) => variant.id === active)
  const step = (direction: -1 | 1) => {
    const nextIndex = (activeIndex + direction + variants.length) % variants.length
    onChange(variants[nextIndex].id)
  }

  return (
    <section
      aria-label="原型方向切换"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex w-fit max-w-[calc(100vw-1.5rem)] items-center gap-1 rounded-2xl border border-white/20 bg-black/95 p-1.5 text-white backdrop-blur-xl"
    >
      <button
        type="button"
        aria-label="上一个原型方向"
        onClick={() => step(-1)}
        className="grid size-8 shrink-0 place-items-center rounded-xl text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
      </button>

      <div className="flex min-w-0 items-center gap-1" role="tablist" aria-label="原型方向">
        {variants.map((variant) => (
          <button
            key={variant.id}
            type="button"
            role="tab"
            aria-selected={active === variant.id}
            onClick={() => onChange(variant.id)}
            className={cn(
              "min-w-0 rounded-xl px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
              active === variant.id
                ? "bg-white text-black"
                : "text-white/55 hover:bg-white/10 hover:text-white",
            )}
          >
            <span className="block font-mono text-[9px] tracking-[0.18em]">{variant.id}</span>
            <span className="hidden text-xs font-medium sm:block">{variant.name}</span>
            <span className="block text-[10px] sm:hidden">{variant.shortName}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-label="下一个原型方向"
        onClick={() => step(1)}
        className="grid size-8 shrink-0 place-items-center rounded-xl text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <ArrowRight className="size-4" aria-hidden="true" />
      </button>
    </section>
  )
}
