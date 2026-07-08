"use client"

// Interaction Props panel — mirrors https://reactflow.dev/examples/interaction/interaction-props
// Rendered by <Inspector /> when nothing is selected.

import { useSettingsStore, DEFAULT_SETTINGS, type CanvasSettings } from "@/lib/flow/settings-store"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

function SectionCaption({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">
      {children}
    </p>
  )
}

function Row({
  k,
  hint,
  children,
}: {
  k: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Label className="font-mono text-[11px]">{k}</Label>
        {hint ? <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </div>
  )
}

const BOOLS: { key: keyof CanvasSettings; label: string; hint?: string }[] = [
  { key: "nodesDraggable", label: "nodesDraggable", hint: "节点可拖动" },
  { key: "nodesConnectable", label: "nodesConnectable", hint: "允许拉出连线" },
  { key: "elementsSelectable", label: "elementsSelectable", hint: "允许选中" },
  { key: "zoomOnScroll", label: "zoomOnScroll" },
  { key: "zoomOnPinch", label: "zoomOnPinch" },
  { key: "zoomOnDoubleClick", label: "zoomOnDoubleClick" },
  { key: "panOnScroll", label: "panOnScroll" },
  { key: "panOnDrag", label: "panOnDrag" },
  { key: "selectionOnDrag", label: "selectionOnDrag" },
  { key: "touchMode", label: "touchMode", hint: "触摸设备优化：双指平移" },
  { key: "snapToHelperLines", label: "snapToHelperLines", hint: "拖动节点时对齐吸附" },
  { key: "contextualZoom", label: "contextualZoom", hint: "低缩放时简化节点" },
  { key: "showMiniMap", label: "showMiniMap" },
  { key: "showControls", label: "showControls" },
  { key: "showBackground", label: "showBackground" },
]

const VALIDATION_BOOLS: { key: keyof CanvasSettings; label: string; hint?: string }[] = [
  { key: "preventCycles", label: "preventCycles", hint: "禁止形成环" },
  { key: "confirmDelete", label: "confirmDelete", hint: "删除前弹确认" },
  { key: "typedHandles", label: "typedHandles", hint: "端口类型校验" },
]

export function InteractionSettingsPanel() {
  const s = useSettingsStore()

  return (
    <aside
      className="absolute bottom-3 right-3 top-3 z-40 flex w-80 flex-col overflow-hidden rounded-lg border bg-sidebar/95 shadow-2xl backdrop-blur-sm duration-150 animate-in fade-in slide-in-from-right-4"
      aria-label="交互设置"
    >
      <div className="border-b px-4 py-3">
        <SectionCaption>Canvas Settings</SectionCaption>
        <h2 className="mt-1 text-sm font-medium">Interaction Props</h2>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          官方 Interaction 示例全部集成，切换即生效。
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          <div className="space-y-3">
            <SectionCaption>Interface</SectionCaption>
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-wider">Language</Label>
              <Select
                value={s.language}
                onValueChange={(v) => v && s.set("language", v as CanvasSettings["language"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh-CN">中文</SelectItem>
                  <SelectItem value="en-US">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <SectionCaption>Interaction</SectionCaption>
            {BOOLS.map((b) => (
              <Row key={b.key} k={b.label} hint={b.hint}>
                <Switch
                  checked={Boolean(s[b.key])}
                  onCheckedChange={(v) => s.set(b.key, v as never)}
                />
              </Row>
            ))}
          </div>

          <Separator />

          <div className="space-y-3">
            <SectionCaption>Validation</SectionCaption>
            {VALIDATION_BOOLS.map((b) => (
              <Row key={b.key} k={b.label} hint={b.hint}>
                <Switch
                  checked={Boolean(s[b.key])}
                  onCheckedChange={(v) => s.set(b.key, v as never)}
                />
              </Row>
            ))}

            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-wider">
                maxSourceConnections
              </Label>
              <Input
                type="number"
                min={0}
                value={s.maxSourceConnections ?? ""}
                placeholder="unlimited"
                onChange={(e) =>
                  s.set("maxSourceConnections", e.target.value === "" ? undefined : Number(e.target.value))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-wider">
                maxTargetConnections
              </Label>
              <Input
                type="number"
                min={0}
                value={s.maxTargetConnections ?? ""}
                placeholder="unlimited"
                onChange={(e) =>
                  s.set("maxTargetConnections", e.target.value === "" ? undefined : Number(e.target.value))
                }
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <SectionCaption>Collaboration</SectionCaption>
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-wider">Provider</Label>
              <Select
                value={s.collabProvider}
                onValueChange={(v) => v && s.set("collabProvider", v as CanvasSettings["collabProvider"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">关闭</SelectItem>
                  <SelectItem value="yjs">Yjs + y-websocket</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-wider">Yjs Room</Label>
              <Input value={s.yjsRoom} onChange={(e) => s.set("yjsRoom", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-wider">Yjs WebSocket URL</Label>
              <Input value={s.yjsUrl} onChange={(e) => s.set("yjsUrl", e.target.value)} />
              <p className="text-[10px] text-muted-foreground">
                默认 wss://demos.yjs.dev — 或自建 y-websocket-server。
              </p>
            </div>
          </div>

          <Separator />
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => s.patch(DEFAULT_SETTINGS)}
          >
            重置默认
          </Button>
        </div>
      </ScrollArea>
    </aside>
  )
}
