import type { GeneratedWorkflowSpec } from '@/lib/flow/types'

import { parseWorkflowProject } from './schema'

type GeneratedProjectOptions = { deliveryEmail?: string }

export function generatedSpecToWorkflowProject(spec: GeneratedWorkflowSpec, name: string, options: GeneratedProjectOptions = {}) {
  const deliveryEmail = options.deliveryEmail?.trim()
  const hasDeliveryNode = spec.nodes.some((node) => /通知|邮件|推送|发送/.test(`${node.label} ${node.description}`))
  const nodes = deliveryEmail && !hasDeliveryNode
    ? [...spec.nodes, { id: 'email-delivery', type: 'action', label: '发送邮件简报', description: `将项目简报发送到 ${deliveryEmail}`, config: deliveryEmail }]
    : spec.nodes
  const edges = deliveryEmail && !hasDeliveryNode && spec.nodes.length
    ? [...spec.edges, { source: spec.nodes.at(-1)!.id, target: 'email-delivery', label: '交付简报' }]
    : spec.edges

  return parseWorkflowProject({
    id: `agent-draft-${Date.now()}`,
    name,
    profile: 'intelligence',
    version: 1,
    nodes: nodes.map((node, index) => {
      const mapped = mapGeneratedNode(node.type, node.label)
      return {
        id: node.id,
        ...mapped,
        params: /通知|邮件|推送|发送/.test(node.label) && deliveryEmail
          ? { channel: 'email', to: [deliveryEmail], value: node.config ?? deliveryEmail }
          : node.config ? { value: node.config } : {},
        ui: {
          label: node.label,
          description: node.description,
          position: { x: 120 + (index % 3) * 300, y: 120 + Math.floor(index / 3) * 180 },
        },
      }
    }),
    edges: edges.map((edge, index) => ({
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
