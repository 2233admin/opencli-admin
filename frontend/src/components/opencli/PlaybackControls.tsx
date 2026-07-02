import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PlaybackControlsProps {
  playing: boolean
  disabled?: boolean
  progressLabel: string
  onToggle: () => void
  onPrevious: () => void
  onNext: () => void
  onReset: () => void
  className?: string
}

export function PlaybackControls({
  playing,
  disabled,
  progressLabel,
  onToggle,
  onPrevious,
  onNext,
  onReset,
  className,
}: PlaybackControlsProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      <Button variant="outline" size="xs" onClick={onReset} disabled={disabled} title="Reset playback">
        <SkipBack size={13} />
        Reset
      </Button>
      <Button variant={playing ? 'secondary' : 'default'} size="xs" onClick={onToggle} disabled={disabled} title={playing ? 'Pause playback' : 'Play run'}>
        {playing ? <Pause size={13} /> : <Play size={13} />}
        {playing ? 'Pause' : 'Play'}
      </Button>
      <Button variant="outline" size="xs" onClick={onPrevious} disabled={disabled} title="Previous step">
        <SkipBack size={13} />
      </Button>
      <Button variant="outline" size="xs" onClick={onNext} disabled={disabled} title="Next step">
        <SkipForward size={13} />
      </Button>
      <span className="ml-1 border border-white/10 bg-white/3 px-2 py-1 font-telemetry text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {progressLabel}
      </span>
    </div>
  )
}
