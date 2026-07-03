import { clsx } from 'clsx'

interface Props {
  children: React.ReactNode
  className?: string
  padding?: boolean
}

export default function Card({ children, className, padding = true }: Props) {
  return (
    <div
      className={clsx(
        'telemetry-panel',
        padding && 'p-5',
        className
      )}
    >
      {children}
    </div>
  )
}
