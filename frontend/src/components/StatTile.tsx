import type { ReactNode } from 'react'

/** Small labeled metric tile — Control Console visual language (zinc palette,
 * font-code). Shared by ActionHistoryPage's advisory-report totals row and
 * the Source Control Room's per-source metric cards row, so the look stays
 * one component instead of two copies drifting apart. */
export default function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border border-white/[0.08] bg-black/25 px-3 py-2">
      <p className="font-code text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 font-code text-[15px] text-zinc-100">{value}</p>
    </div>
  )
}
