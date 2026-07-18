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

import type { ProjectRecordGraphPreview } from '@/lib/api/types'
import { buildProjectRecordGraph } from '@/lib/records/project-record-graph'

import '@react-sigma/core/lib/style.css'

type ProjectRecordGraphCanvasProps = {
  preview: ProjectRecordGraphPreview
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
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
      defaultEdgeColor: '#3f3f46',
      defaultNodeColor: '#94a3b8',
      enableEdgeEvents: false,
      hideEdgesOnMove: graph.size > 2_500,
      labelColor: { color: '#e4e4e7' },
      labelDensity: graph.order > 1_000 ? 0.025 : 0.045,
      labelFont: 'var(--font-sans), system-ui, sans-serif',
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
