'use client'

import { useEffect, useMemo } from 'react'
import {
  ControlsContainer,
  FullScreenControl,
  SigmaContainer,
  ZoomControl,
  useRegisterEvents,
  useSigma,
} from '@react-sigma/core'
import FA2Layout from 'graphology-layout-forceatlas2/worker'
import type { NodeLabelDrawingFunction } from 'sigma/rendering'

import type { ProjectRecordGraphPreview } from '@/lib/api/types'
import {
  buildProjectRecordGraph,
  type ProjectGraphEdgeAttributes,
  type ProjectGraphNodeAttributes,
} from '@/lib/records/project-record-graph'

import '@react-sigma/core/lib/style.css'

type ProjectRecordGraphCanvasProps = {
  preview: ProjectRecordGraphPreview
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
}

const drawReadableNodeLabel: NodeLabelDrawingFunction<
  ProjectGraphNodeAttributes,
  ProjectGraphEdgeAttributes
> = (context, data, settings) => {
  if (!data.label) return

  const selected = Boolean(data.selected)
  const fontSize = settings.labelSize + (selected ? 1 : 0)
  const fontWeight = selected ? '650' : settings.labelWeight
  const label = compactGraphLabel(data.label, selected ? 56 : 38)
  const paddingX = selected ? 8 : 6
  const paddingY = selected ? 5 : 4
  const x = data.x + data.size + 7
  const baselineY = data.y + fontSize / 3

  context.font = `${fontWeight} ${fontSize}px ${settings.labelFont}`
  const textWidth = context.measureText(label).width
  const boxX = x - paddingX
  const boxY = baselineY - fontSize - paddingY
  const boxWidth = textWidth + paddingX * 2
  const boxHeight = fontSize + paddingY * 2

  context.beginPath()
  context.roundRect(boxX, boxY, boxWidth, boxHeight, selected ? 5 : 4)
  context.fillStyle = selected ? 'rgba(9, 9, 11, 0.97)' : 'rgba(9, 9, 11, 0.82)'
  context.fill()

  if (selected) {
    context.lineWidth = 1.25
    context.strokeStyle = data.color
    context.stroke()
  }

  context.fillStyle = selected ? data.color : '#d4d4d8'
  context.fillText(label, x, baselineY)
}

function compactGraphLabel(label: string, limit: number) {
  return label.length > limit ? `${label.slice(0, limit - 1)}…` : label
}

function LayoutController() {
  const sigma = useSigma()

  useEffect(() => {
    const graph = sigma.getGraph()
    if (graph.order < 3) return

    const layout = new FA2Layout(graph, {
      settings: {
        barnesHutOptimize: graph.order > 300,
        barnesHutTheta: 0.7,
        edgeWeightInfluence: 0.35,
        gravity: 0.72,
        scalingRatio: graph.order > 800 ? 22 : 15,
        slowDown: graph.order > 800 ? 20 : 12,
        strongGravityMode: false,
      },
    })
    layout.start()
    const timeout = window.setTimeout(() => {
      layout.stop()
      sigma.refresh()
    }, graph.order > 800 ? 1_300 : 1_900)

    return () => {
      window.clearTimeout(timeout)
      layout.stop()
      layout.kill()
    }
  }, [sigma])

  return null
}

function InteractionController({
  selectedNodeId,
  onSelectNode,
}: Pick<ProjectRecordGraphCanvasProps, 'selectedNodeId' | 'onSelectNode'>) {
  const sigma = useSigma()
  const registerEvents = useRegisterEvents()

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => onSelectNode(node),
      clickStage: () => onSelectNode(null),
      doubleClickNode: ({ node, event }) => {
        event.preventSigmaDefault()
        const position = sigma.getNodeDisplayData(node)
        if (!position) return
        void sigma.getCamera().animate(
          { x: position.x, y: position.y, ratio: 0.32 },
          { duration: 380 },
        )
      },
    })
  }, [onSelectNode, registerEvents, sigma])

  useEffect(() => {
    const graph = sigma.getGraph()
    graph.updateEachNodeAttributes((node, data) => ({
      ...data,
      forceLabel: node === selectedNodeId,
      selected: node === selectedNodeId,
      label: node === selectedNodeId
        ? data.baseLabel
        : data.graphNode.kind === 'record'
          ? ''
          : data.baseLabel,
      size: node === selectedNodeId ? data.baseSize * 1.5 : data.baseSize,
      zIndex: node === selectedNodeId
        ? 5
        : data.graphNode.kind === 'project'
          ? 3
          : data.graphNode.kind === 'record'
            ? 0
            : 2,
    }))
    graph.updateEachEdgeAttributes((edge, data) => {
      const connected = selectedNodeId
        ? graph.hasExtremity(edge, selectedNodeId)
        : false
      return {
        ...data,
        color: connected ? data.activeColor : '#3f3f46',
        hidden: selectedNodeId
          ? !connected
          : data.graphEdge.kind === 'batch' || data.graphEdge.kind === 'duplicate',
        size: connected ? Math.max(1.35, data.baseSize) : data.baseSize,
      }
    })
  }, [selectedNodeId, sigma])

  return null
}

export function ProjectRecordGraphCanvas({
  preview,
  selectedNodeId,
  onSelectNode,
}: ProjectRecordGraphCanvasProps) {
  const graph = useMemo(() => buildProjectRecordGraph(preview), [preview])
  const settings = useMemo(
    () => ({
      allowInvalidContainer: true,
      defaultDrawNodeLabel: drawReadableNodeLabel,
      defaultEdgeColor: '#3f3f46',
      defaultNodeColor: '#94a3b8',
      enableEdgeEvents: false,
      hideEdgesOnMove: graph.size > 2_500,
      labelColor: { color: '#e4e4e7' },
      labelDensity: graph.order > 1_000 ? 0.025 : 0.045,
      labelFont: 'var(--font-sans), system-ui, sans-serif',
      labelSize: 12,
      labelWeight: '500',
      labelGridCellSize: graph.order > 1_000 ? 140 : 100,
      labelRenderedSizeThreshold: graph.order > 800 ? 18 : 14,
      renderEdgeLabels: false,
      stagePadding: 56,
      zIndex: true,
    }),
    [graph.order, graph.size],
  )

  return (
    <SigmaContainer
      graph={graph}
      settings={settings}
      className="h-full min-h-[38rem] w-full bg-[#09090b]"
      style={{ background: '#09090b' }}
    >
      <LayoutController />
      <InteractionController
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
      />
      <ControlsContainer position="bottom-right">
        <ZoomControl />
        <FullScreenControl />
      </ControlsContainer>
    </SigmaContainer>
  )
}
