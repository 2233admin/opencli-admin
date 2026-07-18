"use client"

// Canvas / interaction settings — mirrors the "Interaction Props" example on
// https://reactflow.dev/examples/interaction. Kept in its own store so
// toggles here don't clog undo/redo history in the graph store.

import { create } from "zustand"
import type { WorkflowLanguage } from "@/lib/workflow/node-i18n"

export interface CanvasSettings {
  // draggability & selection
  nodesDraggable: boolean
  nodesConnectable: boolean
  elementsSelectable: boolean
  // zoom
  zoomOnScroll: boolean
  zoomOnPinch: boolean
  zoomOnDoubleClick: boolean
  // pan
  panOnScroll: boolean
  panOnDrag: boolean
  // selection
  selectionOnDrag: boolean
  // touch mode (larger hit areas, pan-with-two-fingers)
  touchMode: boolean
  // validation
  preventCycles: boolean
  confirmDelete: boolean
  maxSourceConnections?: number
  maxTargetConnections?: number
  typedHandles: boolean
  // ui
  language: WorkflowLanguage
  snapToHelperLines: boolean
  contextualZoom: boolean
  showMiniMap: boolean
  showControls: boolean
  showBackground: boolean
  // collaboration
  collabProvider: "off" | "broadcast" | "yjs"
  yjsRoom: string
  yjsUrl: string
}

interface SettingsState extends CanvasSettings {
  set: <K extends keyof CanvasSettings>(key: K, value: CanvasSettings[K]) => void
  patch: (partial: Partial<CanvasSettings>) => void
  reset: () => void
}

export const DEFAULT_SETTINGS: CanvasSettings = {
  nodesDraggable: true,
  nodesConnectable: true,
  elementsSelectable: true,
  zoomOnScroll: true,
  zoomOnPinch: true,
  zoomOnDoubleClick: true,
  panOnScroll: false,
  panOnDrag: true,
  selectionOnDrag: true,
  touchMode: false,
  // Workflow Drafts are compiled as DAGs. Keep the canvas aligned with the
  // compiler contract instead of letting users create graphs that cannot run.
  preventCycles: true,
  confirmDelete: false,
  maxSourceConnections: undefined,
  maxTargetConnections: undefined,
  typedHandles: false,
  language: "zh-CN",
  snapToHelperLines: false,
  contextualZoom: true,
  showMiniMap: false,
  showControls: true,
  showBackground: true,
  collabProvider: "off",
  yjsRoom: "workflow-demo",
  yjsUrl: "wss://demos.yjs.dev",
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULT_SETTINGS,
  set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
  patch: (partial) => set(partial as Partial<SettingsState>),
  reset: () => set(DEFAULT_SETTINGS),
}))
