'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Boxes,
  ExternalLink,
  Focus,
  GitFork,
  Network,
  Search,
  Waypoints,
} from 'lucide-react'

import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { DATA_EXPLORER_TABS, RouteTabs } from '@/components/shell/route-tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useMyWorkspaces, useProjectRecordGraph, useWorkspaceProjects } from '@/lib/api/hooks'
import type { RecordGraphNode } from '@/lib/api/types'
import {
  RECORD_GRAPH_KIND_COLOR,
  RECORD_GRAPH_KIND_LABEL,
} from '@/lib/records/project-record-graph'
import { formatRelative } from '@/lib/format'

const ProjectRecordGraphCanvas = dynamic(
  () => import('@/components/records/project-record-graph-canvas')
    .then((module) => module.ProjectRecordGraphCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[38rem] place-items-center text-sm text-muted-foreground">
        正在初始化 WebGL 图谱…
      </div>
    ),
  },
)

const DENSITY_OPTIONS = [
  { value: 300, label: '概览 · 300 节点' },
  { value: 700, label: '标准 · 700 节点' },
  { value: 1200, label: '深入 · 1,200 节点' },
]

function selectedNodeDescription(node: RecordGraphNode) {
  if (node.kind === 'record') return node.preview ?? node.subtitle ?? '这条记录暂无正文预览。'
  if (node.count > 1) return `聚合了 ${node.count.toLocaleString('zh-CN')} 条项目数据。`
  return node.subtitle ?? RECORD_GRAPH_KIND_LABEL[node.kind]
}

export default function RecordRelationshipGraphPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [maxNodes, setMaxNodes] = useState(700)
  const [search, setSearch] = useState('')

  const workspacesQuery = useMyWorkspaces()
  const workspaceId = workspacesQuery.data?.[0]?.id ?? null
  const projectsQuery = useWorkspaceProjects(workspaceId)
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])

  useEffect(() => {
    if (!projects.length) {
      setSelectedProjectId(null)
      return
    }
    if (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id)
    }
  }, [projects, selectedProjectId])

  const graphQuery = useProjectRecordGraph(workspaceId, selectedProjectId, maxNodes)
  const preview = graphQuery.data
  const selectedNode = preview?.nodes.find((node) => node.id === selectedNodeId) ?? null
  const nodesById = useMemo(
    () => new Map((preview?.nodes ?? []).map((node) => [node.id, node])),
    [preview?.nodes],
  )
  const related = useMemo(() => {
    if (!preview || !selectedNodeId) return []
    return preview.edges.flatMap((edge) => {
      const neighborId = edge.source === selectedNodeId
        ? edge.target
        : edge.target === selectedNodeId
          ? edge.source
          : null
      const node = neighborId ? nodesById.get(neighborId) : null
      return node ? [{ node, edge }] : []
    })
  }, [nodesById, preview, selectedNodeId])
  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term || !preview) return []
    return preview.nodes
      .filter((node) => `${node.label} ${node.subtitle ?? ''}`.toLowerCase().includes(term))
      .sort((left, right) => right.count - left.count)
      .slice(0, 8)
  }, [preview, search])

  const loading = workspacesQuery.isLoading || projectsQuery.isLoading || graphQuery.isLoading
  const error = workspacesQuery.error || projectsQuery.error || graphQuery.error

  return (
    <PageContainer
      eyebrow="Project knowledge graph"
      title="成果与数据"
      description="按项目预览采集成果的双向连接；大项目先聚合，再按需深入，不把十万条记录一次铺满。"
      tabs={<RouteTabs tabs={DATA_EXPLORER_TABS} />}
      className="max-w-none"
    >
      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedProjectId ?? ''}
              onValueChange={(value) => {
                setSelectedProjectId(value || null)
                setSelectedNodeId(null)
                setSearch('')
              }}
            >
              <SelectTrigger className="w-60">
                <SelectValue placeholder="选择要预览的项目">
                  {projects.find((project) => project.id === selectedProjectId)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={String(maxNodes)}
              onValueChange={(value) => {
                setMaxNodes(Number(value))
                setSelectedNodeId(null)
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue>
                  {DENSITY_OPTIONS.find((option) => option.value === maxNodes)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DENSITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && searchResults[0]) {
                    setSelectedNodeId(searchResults[0].id)
                  }
                }}
                placeholder="搜索当前项目预览…"
                className="h-8 pl-8"
              />
              {search.trim() && searchResults.length > 0 ? (
                <div className="absolute left-0 top-10 z-30 w-full overflow-hidden rounded-lg border bg-popover shadow-xl">
                  {searchResults.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(node.id)
                        setSearch('')
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="truncate">{node.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {node.count.toLocaleString('zh-CN')}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {preview ? (
            <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-muted-foreground">
              <span>{preview.stats.visible_nodes.toLocaleString('zh-CN')} 可见节点</span>
              <span>{preview.stats.visible_edges.toLocaleString('zh-CN')} 双向连接</span>
              <span>{preview.stats.total_records.toLocaleString('zh-CN')} 项目记录</span>
            </div>
          ) : null}
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/15 px-4 py-2">
          <div className="flex flex-wrap gap-3">
            {(Object.keys(RECORD_GRAPH_KIND_LABEL) as Array<keyof typeof RECORD_GRAPH_KIND_LABEL>)
              .map((kind) => (
                <span key={kind} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: RECORD_GRAPH_KIND_COLOR[kind] }}
                  />
                  {RECORD_GRAPH_KIND_LABEL[kind]}
                </span>
              ))}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Boxes className="size-3.5" />
            服务端聚合预览
            {preview?.truncated ? (
              <span>
                · 隐藏 {preview.stats.hidden_records.toLocaleString('zh-CN')} 条，避免图谱过载
              </span>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="p-5">
            <LoadingState rows={8} />
          </div>
        ) : error ? (
          <div className="p-5">
            <ErrorState message={(error as Error)?.message} hint={BACKEND_HINT} />
          </div>
        ) : projects.length === 0 ? (
          <div className="grid min-h-[36rem] place-items-center p-8">
            <EmptyState
              title="还没有可预览的项目"
              description="先在 Studio 创建并运行一个采集项目，成果会按项目进入这里。"
            />
          </div>
        ) : !preview || preview.stats.total_records === 0 ? (
          <div className="grid min-h-[36rem] place-items-center p-8">
            <EmptyState
              title="这个项目还没有采集成果"
              description="运行项目中的工作流后，项目、来源、运行、消息与实体双链会出现在这里。"
            />
          </div>
        ) : (
          <div className="grid h-[70rem] min-h-0 grid-rows-[38rem_32rem] lg:h-[42rem] lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-1">
            <div className="relative min-h-0 overflow-hidden bg-[#09090b]">
              <ProjectRecordGraphCanvas
                preview={preview}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
              />
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs text-zinc-400 backdrop-blur-sm">
                <Waypoints className="size-3.5" />
                滚轮缩放 · 双击聚焦 · 点击查看双向邻居
              </div>
            </div>

            <aside
              className="min-h-0 overflow-hidden border-t bg-background/80 lg:border-l lg:border-t-0"
              aria-label="项目图谱详情"
            >
              {selectedNode ? (
                <div className="flex h-full flex-col">
                  <div className="border-b p-4">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: RECORD_GRAPH_KIND_COLOR[selectedNode.kind] }}
                        />
                        {RECORD_GRAPH_KIND_LABEL[selectedNode.kind]}
                      </span>
                      <span className="font-mono">
                        {selectedNode.count.toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <h2 className="mt-3 text-base font-semibold leading-6">{selectedNode.label}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {selectedNodeDescription(selectedNode)}
                    </p>
                    {selectedNode.created_at ? (
                      <p className="mt-3 font-mono text-[10px] text-muted-foreground">
                        {formatRelative(selectedNode.created_at)}
                      </p>
                    ) : null}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    <h3 className="px-1 pb-2 text-xs font-medium text-muted-foreground">
                      双向邻居 · {related.length}
                    </h3>
                    {related.length ? (
                      <div className="space-y-1">
                        {related.slice(0, 80).map(({ node, edge }) => (
                          <button
                            key={`${edge.id}:${node.id}`}
                            type="button"
                            onClick={() => setSelectedNodeId(node.id)}
                            className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="line-clamp-2 text-sm font-medium leading-5">
                                {node.label}
                              </span>
                              <span className="shrink-0 font-mono text-[9px] text-primary">
                                {edge.label}
                              </span>
                            </span>
                            <span className="mt-1 block text-[10px] text-muted-foreground">
                              {RECORD_GRAPH_KIND_LABEL[node.kind]}
                              {node.count > 1 ? ` · ${node.count.toLocaleString('zh-CN')} 条` : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-1 py-4 text-sm text-muted-foreground">当前节点没有可见邻居。</p>
                    )}
                  </div>

                  {selectedNode.kind === 'record' ? (
                    <div className="border-t p-3">
                      <Button
                        variant="outline"
                        className="w-full justify-between"
                        nativeButton={false}
                        render={<a href={`/records?search=${encodeURIComponent(selectedNode.label)}`} />}
                      >
                        在数据表中查看
                        <ExternalLink className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="grid h-full min-h-64 place-items-center p-8 text-center">
                  <div>
                    <Network className="mx-auto size-7 text-muted-foreground" />
                    <h2 className="mt-4 text-sm font-medium">选择一个节点</h2>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      图谱会只保留它的一跳双向邻居，帮助你从项目结构逐层看到具体消息。
                    </p>
                    <div className="mt-5 flex items-center justify-center gap-2 font-mono text-[10px] text-muted-foreground">
                      <Focus className="size-3.5" />
                      项目
                      <ArrowRight className="size-3" />
                      聚类
                      <ArrowRight className="size-3" />
                      消息
                      <GitFork className="size-3.5" />
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </section>
    </PageContainer>
  )
}
