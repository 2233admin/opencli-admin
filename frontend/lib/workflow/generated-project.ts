import type { GeneratedWorkflowSpec } from '@/lib/flow/types'

import { parseWorkflowProject } from './schema'

export function generatedSpecToWorkflowProject(spec: GeneratedWorkflowSpec, name: string) {
  return parseWorkflowProject({
    id: `agent-draft-${Date.now()}`,
    name,
    profile: 'intelligence',
    version: 1,
    nodes: spec.nodes.map((node, index) => {
      const mapped = mapGeneratedNode(node.type, node.label)
      return {
        id: node.id,
        ...mapped,
        params: node.config ? { value: node.config } : {},
        ui: {
          label: node.label,
          description: node.description,
          position: { x: 120 + (index % 3) * 300, y: 120 + Math.floor(index / 3) * 180 },
        },
      }
    }),
    edges: spec.edges.map((edge, index) => ({
      id: `agent-edge-${index + 1}`,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      condition: edge.label,
    })),
    adapters: [],
  })
}

function mapGeneratedNode(type: string, label: string) {
  if (type === 'trigger') return { kind: 'schedule' as const, capability: 'trigger' as const }
  if (type === 'http') return { kind: 'source' as const, capability: 'fetch' as const }
  if (type === 'condition') return { kind: 'router' as const, capability: 'route' as const }
  if (type === 'delay') return { kind: 'control' as const, capability: 'route' as const }
  if (type === 'transform') return { kind: 'action' as const, capability: /摘要|总结/.test(label) ? 'summarize' as const : 'normalize' as const }
  if (/通知|邮件|推送|发送/.test(label)) return { kind: 'notify' as const, capability: 'send' as const }
  return { kind: 'action' as const, capability: 'accept' as const }
}
