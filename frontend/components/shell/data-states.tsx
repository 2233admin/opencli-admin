import { AlertTriangle, Inbox } from 'lucide-react'

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { loader, Matrix } from '@/components/unlumen-ui/matrix'

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
        <Matrix
          rows={7}
          cols={7}
          frames={loader}
          fps={10}
          size={2}
          gap={1.5}
          palette={{ on: 'var(--color-primary)', off: 'var(--color-muted-foreground)' }}
          ariaLabel="正在加载"
        />
        正在读取运行状态
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  )
}

export function ErrorState({ message, hint }: { message?: string; hint?: string }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertTriangle className="text-destructive" />
        </EmptyMedia>
        <EmptyTitle>加载失败</EmptyTitle>
        <EmptyDescription>{message ?? '无法连接后端服务。'}</EmptyDescription>
      </EmptyHeader>
      {hint ? <EmptyContent className="text-xs text-muted-foreground">{hint}</EmptyContent> : null}
    </Empty>
  )
}

export function EmptyState({ title, description }: { title?: string; description?: string }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>{title ?? '暂无数据'}</EmptyTitle>
        <EmptyDescription>{description ?? '当前没有可显示的内容。'}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** Standard hint shown when the backend proxy isn't configured in this env. */
export const BACKEND_HINT = '未配置 BACKEND_URL 或访问令牌时，此处将为空。连接后端后即显示真实数据。'
