"use client"

import type { WorkflowProfile } from "@/lib/workflow/schema"
import {
  getWorkflowProfileDefinition,
  WORKFLOW_PROFILE_IDS,
  WORKFLOW_PROFILE_REGISTRY,
} from "@/lib/workflow/profiles"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

type ProjectSettingsPanelProps = {
  profile: WorkflowProfile
  onProfileChange?: (profile: WorkflowProfile) => void
}

export function ProjectSettingsPanel({ profile, onProfileChange }: ProjectSettingsPanelProps) {
  const active = getWorkflowProfileDefinition(profile)

  return (
    <aside
      className="flex h-full w-80 flex-col overflow-hidden rounded-md border bg-sidebar"
      aria-label="Project settings"
    >
      <div className="border-b px-4 py-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">
          Project Settings
        </p>
        <h2 className="mt-1 text-sm font-medium">Profile Registry</h2>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-wider">Profile</Label>
            <Select value={profile} onValueChange={(value) => onProfileChange?.(value as WorkflowProfile)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_PROFILE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {WORKFLOW_PROFILE_REGISTRY[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{active.description}</p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-wider">Visible Panels</Label>
            <div className="flex flex-wrap gap-1.5">
              {active.visiblePanels.map((panel) => (
                <Badge key={panel} variant="secondary" className="font-mono text-[10px]">
                  {panel}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-wider">Default Adapters</Label>
            <div className="space-y-2">
              {active.defaultAdapters.map((adapter) => (
                <div key={adapter.id} className="rounded-md border bg-background px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px]">{adapter.id}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {adapter.mode}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {adapter.type} / {adapter.provider}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-wider">Scoring</Label>
            <div className="rounded-md border bg-background px-3 py-2 text-[11px]">
              <div className="font-medium">{active.defaultScoringProfile.label}</div>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {active.defaultScoringProfile.scoreField} {active.defaultScoringProfile.sort} @{" "}
                {active.defaultScoringProfile.threshold}
              </p>
            </div>
          </div>
        </div>
      </ScrollArea>
    </aside>
  )
}
