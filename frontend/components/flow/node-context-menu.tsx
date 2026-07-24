import { primitiveRuntimeCapability, runtimeStatusLabel, runtimeStatusTone, type WorkflowCapabilitiesResponse } from "@/lib/workflow/capabilities"
import { localizeNodeText, type WorkflowLanguage } from "@/lib/workflow/node-i18n"
import type { WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog"
import type { WorkflowPrimitive } from "@/lib/workflow/node-primitives"
import { getNodeVisualSignature } from "@/lib/workflow/node-visuals"
import { cn } from "@/lib/utils"

type NodeMenuState = { nodeId: string; x: number; y: number }
type PrimitiveMenuGroup = {
  category: string
  label: string
  items: WorkflowPrimitive[]
}

type NodeContextMenuProps = {
  capabilities: WorkflowCapabilitiesResponse | null | undefined
  dopNodeMenuItems: WorkflowNodeCatalogItem[]
  language: WorkflowLanguage
  menu: NodeMenuState
  onAddDopNode: (item: WorkflowNodeCatalogItem) => void
  onAddPrimitive: (item: WorkflowPrimitive, itemIndex: number) => void
  onDiveIntoNetwork: (nodeId: string) => void
  onLockInternals: (nodeId: string) => void
  onSelectComponent: (nodeId: string) => void
  onShowNodeInfo: () => void
  onShowParameters: () => void
  onUnlockInternals: (nodeId: string) => void
  primitiveMenuGroups: PrimitiveMenuGroup[]
  showDopOperators: boolean
  wrapperElement: HTMLElement | null
}

export function NodeContextMenu({
  capabilities,
  dopNodeMenuItems,
  language,
  menu,
  onAddDopNode,
  onAddPrimitive,
  onDiveIntoNetwork,
  onSelectComponent,
  onShowNodeInfo,
  onShowParameters,
  primitiveMenuGroups,
  showDopOperators,
  wrapperElement,
}: NodeContextMenuProps) {
  return (
    <div
      className="workflow-context-menu absolute z-50 min-w-64 rounded-sm border border-border bg-[#383838] py-1 text-xs text-[#d8d8d8] shadow-xl"
      style={{
        left: menu.x - (wrapperElement?.getBoundingClientRect().left ?? 0),
        top: menu.y - (wrapperElement?.getBoundingClientRect().top ?? 0),
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
        onClick={() => onDiveIntoNetwork(menu.nodeId)}
      >
        <span>{showDopOperators ? "查看 Agent 执行方式" : "进入下一层实现"}</span>
        <span className="text-[#a8a8a8]">Enter</span>
      </button>
      {showDopOperators ? (
        <>
          <div className="my-1 border-t border-[#626262]" />
          <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#a8a8a8]">
            可添加的业务步骤
          </div>
          <div className="max-h-64 overflow-y-auto">
            {dopNodeMenuItems.map((item) => {
          const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
          const visual = getNodeVisualSignature({
            label: item.label,
            description: item.description,
            nodeType: item.kind === "router" ? "condition" : item.kind === "schedule" ? "trigger" : item.kind === "source" ? "http" : "action",
            category: item.category === "decision" ? "logic" : item.category === "trigger" ? "trigger" : item.category === "source" ? "data" : item.category === "output" ? "action" : "action",
            icon: item.icon,
            canonical: { catalogId: item.id, kind: item.kind, capability: item.capability },
          })
          return (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
              onClick={() => onAddDopNode(item)}
            >
              <span className="w-8 shrink-0 font-mono text-[9px] text-[#a8d8ff]">{visual.code}</span>
              <span className="min-w-0 flex-1 truncate">{text.label}</span>
              <span
                className={cn(
                  "rounded-[3px] border px-1 py-0.5 font-mono text-[8px] uppercase",
                  runtimeStatusTone(item.runtimeCapability?.status),
                )}
                title={item.runtimeCapability?.reason ?? item.kind}
              >
                {runtimeStatusLabel(item.runtimeCapability?.status)}
              </span>
            </button>
          )
            })}
          </div>
        </>
      ) : null}
      {!showDopOperators ? <div className="group/atoms relative">
        <div className="flex w-full items-center justify-between px-3 py-1.5 text-left font-semibold text-white hover:bg-[#4a4a4a]">
          <span>添加内部组件</span>
          <span className="text-[#a8a8a8]">›</span>
        </div>
        <div className="pointer-events-none absolute left-full top-0 ml-1 hidden min-w-60 rounded-sm border border-border bg-[#383838] py-1 text-xs text-[#d8d8d8] shadow-xl group-hover/atoms:pointer-events-auto group-hover/atoms:block">
          {primitiveMenuGroups.map((group) => (
            <div key={group.category} className="group/atom-category relative">
              <div className="flex items-center justify-between px-3 py-1.5 hover:bg-[#4a4a4a] hover:text-white">
                <span>{group.label}</span>
                <span className="text-[#a8a8a8]">›</span>
              </div>
              <div className="pointer-events-none absolute left-full top-0 ml-1 hidden min-w-64 rounded-sm border border-border bg-[#383838] py-1 text-xs text-[#d8d8d8] shadow-xl group-hover/atom-category:pointer-events-auto group-hover/atom-category:block">
                {group.items.map((item, itemIndex) => {
                  const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
                  const runtimeCapability = primitiveRuntimeCapability(capabilities, item.id)
                  const visual = getNodeVisualSignature({
                    label: item.label,
                    description: item.description,
                    nodeType: item.nodeType,
                    category: item.nodeCategory,
                    icon: item.icon,
                    primitiveId: item.id,
                    primitiveCategory: item.category,
                  })
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
                      onClick={() => onAddPrimitive(item, itemIndex)}
                    >
                      <span className="w-8 shrink-0 font-mono text-[9px] text-[#a8d8ff]">{visual.code}</span>
                      <span className="min-w-0 flex-1 truncate">{text.label}</span>
                      <span
                        className={cn(
                          "rounded-[3px] border px-1 py-0.5 font-mono text-[8px] uppercase",
                          runtimeStatusTone(runtimeCapability?.status ?? "design_only"),
                        )}
                        title={runtimeCapability?.reason ?? item.category}
                      >
                        {runtimeStatusLabel(runtimeCapability?.status ?? "design_only")}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div> : null}
      <div className="my-1 border-t border-[#626262]" />
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
        onClick={() => onSelectComponent(menu.nodeId)}
      >
        <span>{showDopOperators ? "选择当前业务链路" : "选择当前实现链路"}</span>
        <span className="text-[#a8a8a8]">Strudel</span>
      </button>
      <div className="my-1 border-t border-[#626262]" />
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
        onClick={onShowParameters}
      >
        <span>{showDopOperators ? "编辑业务设置" : "参数与通道"}</span>
        <span className="text-[#a8a8a8]">›</span>
      </button>
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
        onClick={onShowNodeInfo}
      >
        <span>{showDopOperators ? "查看步骤说明" : "查看节点说明"}</span>
      </button>
      <div className="my-1 border-t border-[#626262]" />
      <div className="px-3 py-1.5 text-[#cfcfcf]">{showDopOperators ? "业务节点由你配置，Agent 负责执行。" : "高级编辑仅影响当前实现层。"}</div>
    </div>
  )
}
