'use client'

/**
 * Demo monitor feed — a live simulation of the collect→dispatch pipeline
 * used when no backend is configured, so the console demonstrates its full
 * information architecture instead of a bare error box. Every consumer
 * labels this data 演示数据.
 */

import { useEffect, useState } from 'react'

export type LaneKind = 'collect' | 'dispatch'
export type TaskPhase = 'queued' | 'running' | 'success' | 'failed'

export interface WorkerView {
  id: string
  name: string
  lane: LaneKind
  region: string
  online: boolean
  /** 0-100 current utilization. */
  load: number
  /** Tasks waiting in this worker's local queue. */
  queue: number
  /** Currently executing task label, if any. */
  current: string | null
  doneToday: number
  failedToday: number
}

export interface StreamTask {
  id: string
  lane: LaneKind
  title: string
  /** Collect: source name. Dispatch: destination channel. */
  endpoint: string
  workerId: string
  workerName: string
  phase: TaskPhase
  records: number
  retries: number
  startedAt: number
  durationMs: number | null
}

export interface FailureItem {
  id: string
  lane: LaneKind
  title: string
  workerName: string
  error: string
  retries: number
  at: number
}

export interface ThroughputPoint {
  /** HH:mm label. */
  time: string
  collected: number
  dispatched: number
  failed: number
}

export interface MonitorSnapshot {
  demo: true
  kpi: {
    collectPerMin: number
    dispatchPerMin: number
    successRate: number
    queueDepth: number
    onlineWorkers: number
    totalWorkers: number
    recordsToday: number
    dispatchedToday: number
  }
  throughput: ThroughputPoint[]
  workers: WorkerView[]
  stream: StreamTask[]
  failures: FailureItem[]
}

const SOURCES = ['微博热搜', '知乎热榜', '小红书笔记', '抖音评论', '电商价格页', 'RSS 聚合']
const DESTINATIONS = ['Webhook 回调', 'Kafka 主题', '飞书群机器人', 'S3 归档', '下游 API']
const ERRORS = [
  '目标接口 429 限流',
  '页面结构变更，选择器失效',
  '登录态过期',
  '网络超时 (15s)',
  '下游 schema 校验失败',
]

const WORKER_SEED: Array<Pick<WorkerView, 'id' | 'name' | 'lane' | 'region'>> = [
  { id: 'w-cn-1', name: 'collector-cn-01', lane: 'collect', region: '华东' },
  { id: 'w-cn-2', name: 'collector-cn-02', lane: 'collect', region: '华南' },
  { id: 'w-hk-1', name: 'collector-hk-01', lane: 'collect', region: '香港' },
  { id: 'w-sg-1', name: 'collector-sg-01', lane: 'collect', region: '新加坡' },
  { id: 'd-cn-1', name: 'dispatcher-cn-01', lane: 'dispatch', region: '华东' },
  { id: 'd-cn-2', name: 'dispatcher-cn-02', lane: 'dispatch', region: '华北' },
]

let taskSeq = 100

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function timeLabel(offsetMin: number): string {
  const d = new Date(Date.now() - offsetMin * 60_000)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function newTask(lane: LaneKind, worker: WorkerView, phase: TaskPhase): StreamTask {
  taskSeq += 1
  const isCollect = lane === 'collect'
  const endpoint = isCollect ? pick(SOURCES) : pick(DESTINATIONS)
  return {
    id: `t-${taskSeq}`,
    lane,
    title: isCollect ? `${endpoint} 增量采集` : `推送至 ${endpoint}`,
    endpoint,
    workerId: worker.id,
    workerName: worker.name,
    phase,
    records: phase === 'queued' ? 0 : rand(12, 480),
    retries: Math.random() < 0.12 ? rand(1, 3) : 0,
    startedAt: Date.now() - rand(0, 90_000),
    durationMs: phase === 'success' || phase === 'failed' ? rand(800, 24_000) : null,
  }
}

export function createSnapshot(): MonitorSnapshot {
  const workers: WorkerView[] = WORKER_SEED.map((w, i) => ({
    ...w,
    online: i !== 3 || Math.random() > 0.3,
    load: rand(15, 92),
    queue: rand(0, 14),
    current: null,
    doneToday: rand(120, 1400),
    failedToday: rand(0, 22),
  }))

  const stream: StreamTask[] = []
  for (const w of workers.filter((w) => w.online)) {
    const running = newTask(w.lane, w, 'running')
    w.current = running.title
    stream.push(running)
    stream.push(newTask(w.lane, w, 'success'))
    if (Math.random() < 0.4) stream.push(newTask(w.lane, w, 'queued'))
    if (Math.random() < 0.25) stream.push(newTask(w.lane, w, 'failed'))
  }
  stream.sort((a, b) => b.startedAt - a.startedAt)

  const throughput: ThroughputPoint[] = []
  for (let i = 29; i >= 0; i--) {
    const base = 40 + Math.sin(i / 4) * 18
    throughput.push({
      time: timeLabel(i),
      collected: Math.max(4, Math.round(base + rand(-8, 10))),
      dispatched: Math.max(2, Math.round(base * 0.82 + rand(-8, 8))),
      failed: Math.random() < 0.3 ? rand(1, 5) : 0,
    })
  }

  const failures: FailureItem[] = stream
    .filter((t) => t.phase === 'failed')
    .map((t) => ({
      id: `f-${t.id}`,
      lane: t.lane,
      title: t.title,
      workerName: t.workerName,
      error: pick(ERRORS),
      retries: t.retries,
      at: t.startedAt,
    }))

  const online = workers.filter((w) => w.online)
  const last = throughput[throughput.length - 1]
  const totalFailed = throughput.reduce((s, p) => s + p.failed, 0)
  const totalOk = throughput.reduce((s, p) => s + p.collected + p.dispatched, 0)

  return {
    demo: true,
    kpi: {
      collectPerMin: last.collected,
      dispatchPerMin: last.dispatched,
      successRate: totalOk / Math.max(1, totalOk + totalFailed),
      queueDepth: workers.reduce((s, w) => s + w.queue, 0),
      onlineWorkers: online.length,
      totalWorkers: workers.length,
      recordsToday: workers.reduce((s, w) => s + w.doneToday, 0),
      dispatchedToday: workers.filter((w) => w.lane === 'dispatch').reduce((s, w) => s + w.doneToday * 3, 0),
    },
    throughput,
    workers,
    stream: stream.slice(0, 14),
    failures: failures.slice(0, 5),
  }
}

/** Evolve the snapshot in place-ish: shift chart, mutate loads, advance tasks. */
export function tick(prev: MonitorSnapshot): MonitorSnapshot {
  const workers = prev.workers.map((w) => ({
    ...w,
    load: w.online ? Math.min(98, Math.max(8, w.load + rand(-9, 9))) : 0,
    queue: w.online ? Math.max(0, w.queue + rand(-2, 2)) : w.queue,
    doneToday: w.online ? w.doneToday + rand(0, 6) : w.doneToday,
  }))

  // Advance stream: running tasks may complete; occasionally inject new ones.
  let stream = prev.stream.map((t) => {
    if (t.phase === 'running' && Math.random() < 0.35) {
      const failed = Math.random() < 0.12
      return { ...t, phase: failed ? ('failed' as const) : ('success' as const), durationMs: rand(800, 24_000), records: rand(12, 480) }
    }
    if (t.phase === 'queued' && Math.random() < 0.45) {
      return { ...t, phase: 'running' as const, startedAt: Date.now() }
    }
    return t
  })
  const onlineWorkers = workers.filter((w) => w.online)
  if (onlineWorkers.length > 0 && Math.random() < 0.7) {
    const w = pick(onlineWorkers)
    stream = [newTask(w.lane, w, Math.random() < 0.5 ? 'queued' : 'running'), ...stream]
  }
  stream = stream.slice(0, 14)

  for (const w of workers) {
    const running = stream.find((t) => t.workerId === w.id && t.phase === 'running')
    w.current = running ? running.title : null
  }

  const throughput = [
    ...prev.throughput.slice(1),
    {
      time: timeLabel(0),
      collected: Math.max(4, prev.throughput[prev.throughput.length - 1].collected + rand(-7, 9)),
      dispatched: Math.max(2, prev.throughput[prev.throughput.length - 1].dispatched + rand(-6, 8)),
      failed: Math.random() < 0.25 ? rand(1, 4) : 0,
    },
  ]

  const newFailures: FailureItem[] = stream
    .filter((t) => t.phase === 'failed' && !prev.failures.some((f) => f.id === `f-${t.id}`))
    .map((t) => ({
      id: `f-${t.id}`,
      lane: t.lane,
      title: t.title,
      workerName: t.workerName,
      error: pick(ERRORS),
      retries: t.retries,
      at: Date.now(),
    }))

  const last = throughput[throughput.length - 1]
  const totalFailed = throughput.reduce((s, p) => s + p.failed, 0)
  const totalOk = throughput.reduce((s, p) => s + p.collected + p.dispatched, 0)

  return {
    demo: true,
    kpi: {
      collectPerMin: last.collected,
      dispatchPerMin: last.dispatched,
      successRate: totalOk / Math.max(1, totalOk + totalFailed),
      queueDepth: workers.reduce((s, w) => s + w.queue, 0),
      onlineWorkers: onlineWorkers.length,
      totalWorkers: workers.length,
      recordsToday: prev.kpi.recordsToday + rand(2, 18),
      dispatchedToday: prev.kpi.dispatchedToday + rand(4, 30),
    },
    throughput,
    workers,
    stream,
    failures: [...newFailures, ...prev.failures].slice(0, 5),
  }
}

/** Live demo feed. Only ticks when `enabled`; interval respects visibility. */
export function useMonitorFeed(enabled: boolean): MonitorSnapshot | null {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null)

  useEffect(() => {
    if (!enabled) return
    setSnapshot(createSnapshot())
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      setSnapshot((prev) => (prev ? tick(prev) : createSnapshot()))
    }, 3000)
    return () => clearInterval(id)
  }, [enabled])

  return enabled ? snapshot : null
}
