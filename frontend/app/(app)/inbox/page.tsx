'use client'

import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  ListTodo,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'

import { BACKEND_HINT, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useControlActions, useNotificationLogs, useTasks } from '@/lib/api/hooks'
import type { CollectionTask, ControlActionRecord, NotificationLog } from '@/lib/api/types'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

const MAX_VISIBLE_ITEMS = 5

function isNotificationAttention(log: NotificationLog) {
  const delivery = log.status.toLowerCase()
  return delivery.includes('fail') || delivery.includes('error') || log.ack_status === 'pending'
}

function AttentionSection({
  title,
  description,
  count,
  tone,
  icon,
  href,
  linkLabel,
  isLoading,
  isError,
  hasPartialState = false,
  children,
}: {
  title: string
  description: string
  count: number
  tone: 'critical' | 'waiting' | 'review'
  icon: React.ReactNode
  href: string
  linkLabel: string
  isLoading: boolean
  isError: boolean
  hasPartialState?: boolean
  children: React.ReactNode
}) {
  const rail = {
    critical: 'bg-destructive',
    waiting: 'bg-amber-500',
    review: 'bg-sky-500',
  }[tone]

  return (
    <Card className="relative gap-0 py-0">
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', rail)} />
      <CardHeader className="border-b py-4 pl-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            {icon}
          </span>
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {title}
              <Badge variant={count > 0 ? 'secondary' : 'outline'} className="tabular-nums">
                {count}
              </Badge>
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {isLoading ? (
          <div className="px-5 py-4">
            <LoadingState rows={2} />
          </div>
        ) : isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5 text-sm">
            <span className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4" />
              这一组暂时无法读取，请稍后重试。
            </span>
            <Link href={href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              前往原始列表
            </Link>
          </div>
        ) : count === 0 && !hasPartialState ? (
          <div className="flex items-center gap-3 px-6 py-6 text-sm text-muted-foreground">
            <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
            当前没有需要你处理的事项。
          </div>
        ) : (
          <div className="divide-y">{children}</div>
        )}
      </CardContent>
      {!isLoading && !isError && count > 0 ? (
        <div className="border-t px-6 py-3">
          <Link
            href={href}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {linkLabel}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      ) : null}
    </Card>
  )
}

function TaskAttentionRow({ task, waiting = false }: { task: CollectionTask; waiting?: boolean }) {
  return (
    <div className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/sources/${task.source_id}`} className="truncate font-medium hover:underline">
            {task.source_name ?? task.source_id}
          </Link>
          <StatusBadge status={task.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {waiting
            ? '任务仍在队列中，请确认执行节点和并发容量。'
            : task.error_message || '任务执行失败，请打开工作项查看上下文。'}
        </p>
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(task.updated_at)}</span>
    </div>
  )
}

function NotificationAttentionRow({ log }: { log: NotificationLog }) {
  const failed = /fail|error/i.test(log.status)
  return (
    <div className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">通知记录 {log.id.slice(0, 8)}</span>
          <StatusBadge status={failed ? 'failed' : log.ack_status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {failed
            ? log.error_message || '通知投递失败，请检查通知规则和目标连接。'
            : '通知已送达，但仍在等待业务确认。'}
        </p>
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(log.created_at)}</span>
    </div>
  )
}

function PartialSignalState({ kind, isLoading, isError }: { kind: string; isLoading: boolean; isError: boolean }) {
  if (!isLoading && !isError) return null

  return (
    <div className="flex items-center gap-2 px-6 py-3 text-sm text-muted-foreground">
      {isError ? <AlertCircle className="size-4 text-destructive" /> : <Clock3 className="size-4 animate-pulse" />}
      {isError ? `${kind}暂时无法读取，其他待办仍可处理。` : `正在读取${kind}…`}
    </div>
  )
}

function ControlAttentionRow({ action }: { action: ControlActionRecord }) {
  return (
    <div className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/sources/${action.source_id}`} className="font-mono text-xs font-semibold hover:underline">
            {action.action_type}
          </Link>
          <StatusBadge status={action.state} />
          <Badge variant="outline">{action.executed ? '已执行' : '建议'}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {action.reason || '控制动作尚未形成恢复结果，需要继续观察并复核。'}
        </p>
      </div>
      <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(action.created_at)}</span>
    </div>
  )
}

export default function InboxPage() {
  const failedTasks = useTasks({ status: 'failed', limit: 50 })
  const pendingTasks = useTasks({ status: 'pending', limit: 50 })
  const notificationLogs = useNotificationLogs()
  const pendingControlActions = useControlActions({ outcome: 'pending', limit: 50 })

  const failed = failedTasks.data?.data ?? []
  const pending = pendingTasks.data?.data ?? []
  const notifications = (notificationLogs.data?.data ?? []).filter(isNotificationAttention)
  const controls = pendingControlActions.data?.data ?? []
  const total = failed.length + pending.length + notifications.length + controls.length

  const queries = [failedTasks, pendingTasks, notificationLogs, pendingControlActions]
  const isInitialLoading = queries.every((query) => query.isLoading)
  const isTotalFailure = queries.every((query) => query.isError)

  const refetchAll = () => {
    void Promise.all(queries.map((query) => query.refetch()))
  }

  return (
    <PageContainer
      eyebrow="Action queue"
      title="待我处理"
      description="只聚合需要判断、排障或复核的真实运行信号。按从阻塞执行到等待复核的顺序处理。"
      actions={
        <Button variant="outline" size="sm" onClick={refetchAll}>
          刷新
        </Button>
      }
    >
      {isInitialLoading ? (
        <LoadingState rows={5} />
      ) : isTotalFailure ? (
        <ErrorState
          message="待办信号暂时无法读取。"
          hint={BACKEND_HINT}
          action={
            <Button variant="outline" size="sm" onClick={refetchAll}>
              重新读取
            </Button>
          }
        />
      ) : (
        <>
          <section
            aria-label="待处理摘要"
            className="grid overflow-hidden rounded-xl border bg-card md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(8rem,0.6fr))]"
          >
            <div className="flex items-center gap-4 border-b p-5 md:border-r md:border-b-0">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                <ListTodo className="size-5" />
              </span>
              <div>
                <p className="text-xs font-medium tracking-wide text-muted-foreground">需要处理</p>
                <p className="mt-0.5 text-3xl font-semibold tabular-nums">{total}</p>
              </div>
            </div>
            <div className="border-b p-5 md:border-r md:border-b-0">
              <p className="text-xs text-muted-foreground">阻塞执行</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-destructive">{failed.length}</p>
            </div>
            <div className="border-b p-5 md:border-r md:border-b-0">
              <p className="text-xs text-muted-foreground">等待推进</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{pending.length + notifications.length}</p>
            </div>
            <div className="p-5">
              <p className="text-xs text-muted-foreground">等待复核</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{controls.length}</p>
            </div>
          </section>

          <div className="grid gap-4">
            <AttentionSection
              title="先处理失败运行"
              description="执行已经中断，先排除错误，避免后续任务继续堆积。"
              count={failed.length}
              tone="critical"
              icon={<TriangleAlert className="size-4" />}
              href="/tasks"
              linkLabel="查看全部工作项"
              isLoading={failedTasks.isLoading}
              isError={failedTasks.isError}
            >
              {failed.slice(0, MAX_VISIBLE_ITEMS).map((task) => (
                <TaskAttentionRow key={task.id} task={task} />
              ))}
            </AttentionSection>

            <AttentionSection
              title="推进等待事项"
              description="检查排队任务的执行容量，并处理投递失败或待确认的通知。"
              count={pending.length + notifications.length}
              tone="waiting"
              icon={<Clock3 className="size-4" />}
              href="/tasks"
              linkLabel="打开工作项"
              isLoading={pendingTasks.isLoading && notificationLogs.isLoading}
              isError={pendingTasks.isError && notificationLogs.isError}
              hasPartialState={
                pendingTasks.isLoading ||
                pendingTasks.isError ||
                notificationLogs.isLoading ||
                notificationLogs.isError
              }
            >
              <PartialSignalState kind="等待任务" isLoading={pendingTasks.isLoading} isError={pendingTasks.isError} />
              {pending.slice(0, MAX_VISIBLE_ITEMS).map((task) => (
                <TaskAttentionRow key={task.id} task={task} waiting />
              ))}
              <PartialSignalState kind="通知记录" isLoading={notificationLogs.isLoading} isError={notificationLogs.isError} />
              {notifications.slice(0, Math.max(0, MAX_VISIBLE_ITEMS - pending.length)).map((log) => (
                <NotificationAttentionRow key={log.id} log={log} />
              ))}
              {notifications.length > 0 ? (
                <div className="px-6 py-3 text-sm">
                  <Link href="/notifications" className="inline-flex items-center gap-2 text-primary hover:underline">
                    <BellRing className="size-4" />
                    查看通知记录
                  </Link>
                </div>
              ) : null}
            </AttentionSection>

            <AttentionSection
              title="复核控制结果"
              description="这些建议或动作仍未形成结果判断，需要继续观察数据源是否恢复。"
              count={controls.length}
              tone="review"
              icon={<ShieldCheck className="size-4" />}
              href="/control/actions"
              linkLabel="打开控制证据台账"
              isLoading={pendingControlActions.isLoading}
              isError={pendingControlActions.isError}
            >
              {controls.slice(0, MAX_VISIBLE_ITEMS).map((action) => (
                <ControlAttentionRow key={action.id} action={action} />
              ))}
            </AttentionSection>
          </div>
        </>
      )}
    </PageContainer>
  )
}
