// Shared toolbar button chrome for the Collection Canvas family (总览 /
// 当前 Plan — see PlanCanvasPage.tsx ADR-0008). Both the plan editor's
// auto-layout/save/run buttons and the overview's 控制室/采集画布/同步
// buttons render through this so the two views read as one family (task:
// bring 总览 up to the plan editor's visual language). Two tones only —
// 'neutral' for plain navigation/utility actions, 'accent' for the
// primary/affirmative action in a given toolbar (save, run, auto-layout).
import { cn } from '../lib/utils'

export type CanvasToolbarButtonTone = 'neutral' | 'accent' | 'affirmative'

const TONE_CLASSES: Record<CanvasToolbarButtonTone, string> = {
  neutral: 'border-white/12 bg-white/4 text-zinc-200 hover:border-white/24 hover:bg-white/8',
  accent: 'border-sky-500/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20',
  // Reserved for a plan's affirmative "go" action (Run) — kept distinct from
  // 'accent' (save/auto-layout) so Run reads as a different class of action.
  affirmative: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20',
}

/** Class-only escape hatch for non-<button> elements that need the identical
 * chrome — e.g. a react-router <Link> styled as a toolbar action (NetworkPage's
 * 控制室/采集画布 links navigate, they don't submit, so they must stay <a>/<Link>
 * for correct semantics/middle-click/etc rather than being wrapped in a real
 * <button>). Keeps exactly one source of truth for the visual classes. */
export function canvasToolbarButtonClass(tone: CanvasToolbarButtonTone = 'neutral', className?: string): string {
  return cn(
    'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
    TONE_CLASSES[tone],
    className,
  )
}

export interface CanvasToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: CanvasToolbarButtonTone
  icon?: React.ReactNode
}

export function CanvasToolbarButton({
  tone = 'neutral',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: CanvasToolbarButtonProps) {
  return (
    <button type={type} className={canvasToolbarButtonClass(tone, className)} {...rest}>
      {icon}
      {children}
    </button>
  )
}

export default CanvasToolbarButton
