'use client'

// Throwaway prototype: evolve the existing dashboard and canvas instead of redrawing them.

import { Suspense, useState } from 'react'
import { Activity, LayoutDashboard, Workflow } from 'lucide-react'

import DashboardPage from '@/app/(app)/dashboard/page'
import { WorkflowEditor } from '@/components/flow/workflow-editor'
import { AppShell } from '@/components/shell/app-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Surface = 'overview' | 'canvas'

export default function WorkflowStudioPrototype() {
  const [surface, setSurface] = useState<Surface>('overview')
  const [scale, setScale] = useState(100)

  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <AppShell>
        <div className="flex min-h-full flex-col bg-background">
        <div className="sticky top-0 z-40 flex min-h-12 flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden sm:inline-flex">Workflow Studio prototype</Badge>
            <div className="flex rounded-full border bg-muted/30 p-1">
              <SurfaceButton active={surface === 'overview'} icon={LayoutDashboard} onClick={() => setSurface('overview')}>
                系统概览
              </SurfaceButton>
              <SurfaceButton active={surface === 'canvas'} icon={Workflow} onClick={() => setSurface('canvas')}>
                节点工作流
              </SurfaceButton>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground md:inline">界面密度</span>
            <div className="flex rounded-full border p-1">
              {[90, 100, 110].map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={scale === value ? 'default' : 'ghost'}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setScale(value)}
                >
                  {value}%
                </Button>
              ))}
            </div>
            <Badge variant="outline" className="gap-1.5">
              <Activity className="size-3" />
              复用现有功能
            </Badge>
          </div>
        </div>

        <div className={cn('min-h-0 flex-1 overflow-auto', surface === 'canvas' && 'overflow-hidden')}>
          <div
            className={cn(
              'origin-top-left transition-[zoom] duration-150',
              surface === 'canvas' ? 'h-[calc(100vh-7rem)] min-h-[640px]' : 'min-h-full',
            )}
            style={{ zoom: scale / 100 }}
          >
            {surface === 'overview' ? <DashboardPage /> : <WorkflowEditor />}
          </div>
        </div>
        </div>
      </AppShell>
    </Suspense>
  )
}

function SurfaceButton({
  active,
  icon: Icon,
  onClick,
  children,
}: {
  active: boolean
  icon: typeof LayoutDashboard
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'ghost'}
      className="h-7 gap-1.5 px-3 text-xs"
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      {children}
    </Button>
  )
}
