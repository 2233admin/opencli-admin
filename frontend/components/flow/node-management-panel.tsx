"use client"

import { useMemo, useState } from "react"
import { Activity, AlertTriangle, Bot, CheckCircle2, Database, ListTree, Play, Search, ShieldCheck, X } from "lucide-react"
import proposalFixture from "@/lib/workflow/fixtures/agent-proposal-duplicate-push.json"
import { useFlowStore } from "@/lib/flow/store"
import { summarizeNodeManagement } from "@/lib/workflow/node-management"
import { parseAgentProposal } from "@/lib/workflow/proposal"
import { simulateWorkflowRun, type WorkflowSimulationRun } from "@/lib/workflow/simulation"
import { runtimeStatusLabel, runtimeStatusTone } from "@/lib/workflow/capabilities"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

const proposal = parseAgentProposal(proposalFixture)

type NodeManagementPanelProps = {
  onClose?: () => void
}

type TabId = "overview" | "nodes" | "contracts" | "runtime" | "agents"

const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "nodes", label: "Nodes", icon: ListTree },
  { id: "contracts", label: "Contracts", icon: ShieldCheck },
  { id: "runtime", label: "Runtime", icon: Play },
  { id: "agents", label: "Agents", icon: Bot },
]

export function NodeManagementPanel({ onClose }: NodeManagementPanelProps) {
  const project = useFlowStore((state) => state.workflowProject)
  const focusProposalTargets = useFlowStore((state) => state.focusProposalTargets)
  const [tab, setTab] = useState<TabId>("overview")
  const [query, setQuery] = useState("")
  const [run, setRun] = useState<WorkflowSimulationRun | null>(null)
  const [running, setRunning] = useState(false)

  const summary = useMemo(() => summarizeNodeManagement(project, run, proposal), [project, run])
  const filteredNodes = summary.nodes.filter((node) =>
    `${node.id} ${node.kind} ${node.capability} ${node.adapter}`.toLowerCase().includes(query.toLowerCase()),
  )

  const runSimulation = async () => {
    setRunning(true)
    try {
      setRun(await simulateWorkflowRun(project))
    } finally {
      setRunning(false)
    }
  }

  return (
    <aside
      className="absolute bottom-3 left-3 top-3 z-40 flex w-[31rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-md border bg-sidebar/95 shadow-2xl backdrop-blur-sm"
      aria-label="节点管理面板"
    >
      <div className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">
              Node Management
            </p>
            <h2 className="mt-1 text-sm font-medium">{project.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <StatusPill status={summary.contracts.status} />
              <span>{summary.nodes.length} nodes</span>
              <span>·</span>
              <span>{summary.adapters.length} adapters</span>
              <span>·</span>
              <span>{project.profile}</span>
            </div>
          </div>
          {onClose ? (
            <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭节点管理面板">
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-5 gap-1 rounded-sm border bg-card p-1">
          {tabs.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex min-w-0 items-center justify-center gap-1 rounded-[3px] px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] transition-colors",
                  tab === item.id ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {tab === "overview" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <Metric label="Nodes" value={summary.nodes.length} />
                <Metric label="Edges" value={project.edges.length} />
                <Metric label="Ports" value={`${summary.contracts.coveragePercent}%`} />
                <Metric label="Findings" value={summary.contracts.findingsCount} tone={summary.contracts.findingsCount > 0 ? "warn" : "good"} />
              </div>

              <section className="rounded-sm border bg-card">
                <SectionHeader title="System Readiness" detail={summary.run ? `last run ${summary.run.runId}` : "no runtime artifact yet"} />
                <div className="grid grid-cols-3 border-t font-mono text-[10px]">
                  <ReadinessCell label="Contracts" value={summary.contracts.status} status={summary.contracts.status} />
                  <ReadinessCell label="Adapters" value={`${summary.adapters.length}`} status={summary.adapters.length > 0 ? "pass" : "warn"} />
                  <ReadinessCell label="Run Trace" value={summary.run ? "ready" : "empty"} status={summary.run ? "pass" : "warn"} />
                </div>
              </section>

              <section className="rounded-sm border bg-card">
                <SectionHeader title="Node Classes" detail="canonical surface" />
                <div className="grid grid-cols-2 gap-2 border-t p-3">
                  {Object.entries(countBy(summary.nodes, "kind")).map(([kind, count]) => (
                    <div key={kind} className="flex items-center justify-between rounded-sm border bg-background/60 px-2 py-1.5 font-mono text-[10px]">
                      <span className="uppercase text-muted-foreground">{kind}</span>
                      <span className="text-foreground">{count}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-sm border bg-card">
                <SectionHeader title="Attention Queue" detail="what to inspect next" />
                <div className="divide-y border-t">
                  {summary.contracts.findings.slice(0, 4).map((finding) => (
                    <button
                      key={`${finding.contractId}-${finding.nodeId}-${finding.summary}`}
                      type="button"
                      onClick={() => {
                        setTab("contracts")
                        focusProposalTargets([finding.nodeId])
                      }}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/40"
                    >
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#ff7a17]" />
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[11px] text-foreground">{finding.nodeId}</span>
                        <span className="line-clamp-1 text-[11px] text-muted-foreground">{finding.summary}</span>
                      </span>
                    </button>
                  ))}
                  {summary.contracts.findings.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                      <CheckCircle2 className="size-3.5 text-[#4ade80]" />
                      Contracts are clean. Run trace is the next evidence layer.
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {tab === "nodes" ? (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter nodes, adapters, capabilities"
                  className="pl-7 font-mono text-xs"
                />
              </div>
              <div className="overflow-hidden rounded-sm border bg-card">
                <div className="grid grid-cols-[1.25fr_0.8fr_0.8fr_0.6fr] border-b px-3 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  <span>Node</span>
                  <span>Contract</span>
                  <span>Runtime</span>
                  <span className="text-right">IO</span>
                </div>
                {filteredNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => focusProposalTargets([node.id])}
                    className={cn(
                      "grid w-full grid-cols-[1.25fr_0.8fr_0.8fr_0.6fr] items-center gap-2 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40",
                      node.proposalImpacted && "bg-[#ff7a17]/5",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-mono text-[11px] text-foreground">{node.id}</span>
                        {node.proposalImpacted ? <span className="size-1.5 shrink-0 rounded-full bg-[#ff7a17]" /> : null}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[9px] uppercase text-muted-foreground">
                        {node.kind} · {node.capability}
                      </p>
                    </div>
                    <div className="min-w-0 font-mono text-[10px]">
                      <StatusPill status={node.contractStatus} />
                      <p className="mt-1 truncate text-muted-foreground">{node.contractId}</p>
                    </div>
                    <div className="min-w-0 font-mono text-[10px]">
                      <span
                        className={cn(
                          "inline-flex max-w-full rounded-[3px] border px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em]",
                          runtimeStatusTone(node.runtimeCapability?.status),
                        )}
                        title={node.runtimeCapability?.reason ?? node.lastEvent}
                      >
                        <span className="truncate">{runtimeStatusLabel(node.runtimeCapability?.status)}</span>
                      </span>
                      <p className="mt-1 truncate text-muted-foreground">{node.adapter}</p>
                    </div>
                    <span className="text-right font-mono text-[10px] text-muted-foreground">
                      {node.incoming}/{node.outgoing}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {tab === "contracts" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Status" value={summary.contracts.status} />
                <Metric label="Coverage" value={`${summary.contracts.coveragePercent}%`} />
                <Metric label="Findings" value={summary.contracts.findingsCount} />
              </div>
              <div className="space-y-2">
                {summary.contracts.findings.length > 0 ? (
                  <div className="space-y-1.5">
                    {summary.contracts.findings.map((finding) => (
                      <div key={`${finding.contractId}-${finding.nodeId}-${finding.summary}`} className="rounded-md border border-[#d97706]/40 bg-card p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[10px] text-foreground">{finding.contractId}</span>
                          <Badge variant={finding.status === "fail" ? "destructive" : "outline"} className="font-mono text-[9px]">
                            {finding.status}
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{finding.summary}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {summary.contracts.nodes.map((contract) => (
                  <div key={contract.nodeId} className="rounded-md border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-foreground">{contract.nodeId}</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{contract.contractId}</p>
                      </div>
                      <Badge variant={contract.status === "pass" ? "secondary" : "outline"} className="font-mono text-[10px]">
                        {contract.status}
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {contract.ports.map((port) => (
                        <div key={`${contract.nodeId}-${port.id}`} className="flex items-center justify-between gap-2 font-mono text-[10px]">
                          <span className="truncate text-foreground">{port.id}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {port.direction.toUpperCase()} · {port.type}
                          </span>
                        </div>
                      ))}
                    </div>
                    <Separator className="my-3" />
                    <div className="space-y-1">
                      {contract.assertions.slice(0, 2).map((assertion) => (
                        <p key={assertion} className="line-clamp-1 text-[11px] text-muted-foreground">
                          {assertion}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === "runtime" ? (
            <div className="space-y-3">
              <Button size="sm" className="w-full" onClick={runSimulation} disabled={running}>
                <Play className="size-3.5" />
                {running ? "Running deterministic trace" : "Run deterministic trace"}
              </Button>
              {summary.run ? (
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="Events" value={summary.run.traceEventCount} />
                  <Metric label="Stored" value={summary.run.storedItems} />
                  <Metric label="Notified" value={summary.run.notifiedItems} />
                </div>
              ) : (
                <div className="rounded-sm border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No run in node manager yet.
                </div>
              )}

              <section className="rounded-sm border bg-card">
                <SectionHeader title="Adapters" detail="bound sources and sinks" />
                <div className="divide-y border-t">
              {summary.adapters.map((adapter) => (
                    <div key={adapter.id} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{adapter.id}</span>
                    <Badge variant={adapter.mode === "live" ? "default" : "outline"} className="font-mono text-[10px]">
                      {adapter.mode}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {adapter.type} / {adapter.provider}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    used by: {adapter.usedBy.length ? adapter.usedBy.join(", ") : "none"}
                  </p>
                </div>
              ))}
                </div>
              </section>
              <Separator />
              <div className="space-y-2">
                {summary.nodes.map((node) => (
                  <div key={node.id} className="flex items-center justify-between rounded-sm border bg-card px-3 py-2 font-mono text-[11px]">
                    <span>{node.id}</span>
                    <span className="text-muted-foreground">{node.lastEvent} · {node.lastItemCount}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === "agents" ? (
            <div className="space-y-3">
              <div className="rounded-sm border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{summary.proposal?.id}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">{summary.proposal?.risk}</Badge>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{proposal.summary}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => focusProposalTargets(summary.proposal?.nodeIds ?? [], summary.proposal?.edgeIds ?? [])}
                >
                  Focus impacted nodes
                </Button>
              </div>
              <div className="space-y-2">
                {(summary.proposal?.nodeIds ?? []).map((id) => (
                  <div key={id} className="rounded-sm border border-[#ff7a17]/50 bg-card px-3 py-2 font-mono text-[11px]">
                    {id}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  )
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-sm border bg-card p-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-sm", tone === "good" && "text-[#4ade80]", tone === "warn" && "text-[#ff7a17]")}>
        {value}
      </p>
    </div>
  )
}

function SectionHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground">{title}</h3>
      {detail ? <span className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">{detail}</span> : null}
    </div>
  )
}

function StatusPill({ status }: { status: "pass" | "warn" | "fail" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 font-mono text-[9px] uppercase tracking-[0.08em]",
        status === "pass" && "border-[#4ade80]/40 bg-[#4ade80]/10 text-[#4ade80]",
        status === "warn" && "border-[#ff7a17]/40 bg-[#ff7a17]/10 text-[#ffb86b]",
        status === "fail" && "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {status}
    </span>
  )
}

function ReadinessCell({
  label,
  value,
  status,
}: {
  label: string
  value: string
  status: "pass" | "warn" | "fail"
}) {
  return (
    <div className="border-r p-3 last:border-r-0">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "pass" && "bg-[#4ade80]",
            status === "warn" && "bg-[#ff7a17]",
            status === "fail" && "bg-destructive",
          )}
        />
        <span className="uppercase text-muted-foreground">{label}</span>
      </div>
      <p className="mt-1 uppercase text-foreground">{value}</p>
    </div>
  )
}

function countBy<T extends Record<string, unknown>>(items: T[], key: keyof T): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const value = String(item[key] ?? "unknown")
    acc[value] = (acc[value] ?? 0) + 1
    return acc
  }, {})
}
