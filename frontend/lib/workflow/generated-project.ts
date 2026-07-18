import type { GeneratedWorkflowEdge, GeneratedWorkflowNode, GeneratedWorkflowSpec } from '@/lib/flow/types'

import { parseWorkflowProject, type AdapterBinding, type WorkflowCapability, type WorkflowNodeKind } from './schema'

type GeneratedProjectOptions = { deliveryEmail?: string }

type MappedGeneratedNode = {
  kind: WorkflowNodeKind
  capability: WorkflowCapability
  catalogId?: string
  primitiveId?: string
  primitivePorts?: Array<{
    id: string
    direction: 'input' | 'output'
    type: string
    required: boolean
  }>
}

export function generatedSpecToWorkflowProject(spec: GeneratedWorkflowSpec, name: string, options: GeneratedProjectOptions = {}) {
  const deliveryEmail = options.deliveryEmail?.trim()
  const { nodes, edges } = withOptionalEmailDelivery(spec, deliveryEmail)
  const adapters: AdapterBinding[] = []

  return parseWorkflowProject({
    id: `agent-draft-${Date.now()}`,
    name,
    profile: 'intelligence',
    version: 1,
    nodes: nodes.map((node, index) => {
      const mapped = mapGeneratedNode(node)
      const adapter = adapterForGeneratedNode(node, mapped, deliveryEmail)
      const capabilityGapIds = node.capabilityGapIds ?? []
      if (adapter) adapters.push(adapter)
      return {
        id: node.id,
        kind: mapped.kind,
        capability: mapped.capability,
        adapter: adapter?.id,
        params: paramsForGeneratedNode(node, mapped, spec),
        ui: {
          label: node.label,
          description: node.description,
          position: positionForGeneratedNode(index, node),
          ...(mapped.catalogId ? { catalogId: mapped.catalogId } : {}),
          ...(mapped.primitiveId ? { primitiveId: mapped.primitiveId, primitivePorts: mapped.primitivePorts } : {}),
          builder: {
            nodeType: node.type,
            readiness: node.readiness ?? 'ready',
            capabilityGapIds,
            capabilityGaps: spec.capabilityGaps.filter((gap) => capabilityGapIds.includes(gap.id)),
            recentStatus: node.recentStatus ?? 'idle',
            outputStatus: node.outputStatus,
            definitionRef: node.definitionRef,
            retryPolicy: node.retryPolicy,
            envelope: spec.envelope,
          },
          recentStatus: node.recentStatus ?? 'idle',
          ...(node.outputStatus ? { outputStatus: node.outputStatus } : {}),
        },
      }
    }),
    edges: edges.map((edge, index) => {
      const target = nodes.find((node) => node.id === edge.target)
      const source = nodes.find((node) => node.id === edge.source)
      const ports = canonicalPorts(source, target, edge.sourcePort, edge.targetPort)
      return {
        id: `agent-edge-${index + 1}`,
        source: edge.source,
        target: edge.target,
        sourcePort: ports.sourcePort,
        targetPort: ports.targetPort,
        label: edge.label,
        condition: edge.label,
        contractId: spec.envelope.contract,
        ui: {
          mapping: edge.mapping ?? defaultMapping(),
          envelope: spec.envelope,
        },
      }
    }),
    settings: {
      timezone: 'Asia/Shanghai',
      deterministicSimulation: true,
      maxItemsPerRun: 20,
    },
    adapters: dedupeAdapters(adapters),
    agentPermissions: {
      canFetchNetwork: adapters.some((adapter) => adapter.type === 'source' && adapter.mode === 'live'),
      canSendNotifications: false,
      canWriteInbox: false,
      allowedDomains: adapters.flatMap((adapter) => domainFromAdapter(adapter)),
    },
  })
}

function withOptionalEmailDelivery(
  spec: GeneratedWorkflowSpec,
  deliveryEmail?: string,
): { nodes: GeneratedWorkflowNode[]; edges: GeneratedWorkflowEdge[] } {
  if (!deliveryEmail) return { nodes: spec.nodes, edges: spec.edges }
  const existingEmail = spec.nodes.find((node) => node.type === 'email-output' || /邮件|email/i.test(node.label))
  if (existingEmail) {
    return {
      nodes: spec.nodes.map((node) => node.id === existingEmail.id
        ? {
            ...node,
            config: deliveryEmail,
            params: { ...node.params, channel: 'email', to: deliveryEmail },
            readiness: 'ready' as const,
            capabilityGapIds: [],
          }
        : node),
      edges: spec.edges,
    }
  }

  const outputTypes = new Set(['records-output', 'email-output', 'webhook-output'])
  const outputEdges = spec.edges.filter((edge) => outputTypes.has(spec.nodes.find((node) => node.id === edge.target)?.type ?? ''))
  const upstreamIds = Array.from(new Set(outputEdges.map((edge) => edge.source)))
  const fallbackUpstream = spec.nodes.findLast((node) => !outputTypes.has(node.type))?.id
  const sources = upstreamIds.length > 0 ? upstreamIds : fallbackUpstream ? [fallbackUpstream] : []
  const emailNode: GeneratedWorkflowNode = {
    id: 'email-delivery',
    type: 'email-output',
    label: 'Email',
    description: `将项目简报发送到 ${deliveryEmail}`,
    config: deliveryEmail,
    params: { channel: 'email', to: deliveryEmail, template: 'brief' },
    inputMode: 'batch',
    readiness: 'ready',
    recentStatus: 'idle',
    outputStatus: 'idle',
  }
  return {
    nodes: [...spec.nodes, emailNode],
    edges: [
      ...spec.edges,
      ...sources.map((source) => ({
        source,
        target: emailNode.id,
        label: '交付简报',
        mapping: defaultMapping(),
      })),
    ],
  }
}

function paramsForGeneratedNode(
  node: GeneratedWorkflowNode,
  mapped: MappedGeneratedNode,
  spec: GeneratedWorkflowSpec,
) {
  const builder = {
    nodeType: node.type,
    definitionRef: node.definitionRef,
    retryPolicy: node.retryPolicy,
    inputMode: node.inputMode,
    outputMode: node.outputMode,
    execution: 'batch',
    crossRunState: spec.executionPolicy.crossRunState,
    branchFailure: spec.executionPolicy.branchFailure,
  }
  if (mapped.kind === 'schedule') {
    const manual = node.type === 'manual-trigger' || node.config === 'manual'
    return manual
      ? { text: node.description, locale: 'zh-CN', mode: 'manual', inputSchema: node.params?.inputSchema, builder }
      : {
          interval: node.params?.interval ?? node.config?.replace(/^cron:\s*/, '') ?? 'manual',
          timezone: node.params?.timezone ?? 'Asia/Shanghai',
          overlap: node.params?.overlap ?? 'coalesce-one-pending',
          missedRuns: node.params?.missedRuns ?? 'skip',
          builder,
        }
  }
  if (mapped.kind === 'source') {
    const url = readString(node.params?.endpoint) ?? node.config?.match(/https?:\/\/\S+/)?.[0]
    return {
      ...node.params,
      method: node.params?.method ?? 'GET',
      ...(url ? { url, sourceUrl: url } : {}),
      builder,
    }
  }
  if (node.type === 'records-output') {
    return { target: 'records', writeMode: 'append', preserveLineage: true, ...node.params, builder }
  }
  if (mapped.kind === 'notify') {
    return { ...node.params, value: node.config, builder }
  }
  return { ...node.params, ...(node.config ? { value: node.config } : {}), builder }
}

function adapterForGeneratedNode(
  node: GeneratedWorkflowNode,
  mapped: MappedGeneratedNode,
  deliveryEmail?: string,
): AdapterBinding | undefined {
  if (mapped.kind === 'source' && mapped.capability === 'fetch') {
    const isOpenCLI = node.type === 'opencli-agent'
    const url = readString(node.params?.endpoint) ?? node.config?.match(/https?:\/\/\S+/)?.[0]
    return {
      id: `agent-${node.id}-source`,
      type: 'source',
      provider: isOpenCLI ? 'opencli' : 'http',
      mode: 'live',
      config: isOpenCLI
        ? { channel: 'opencli', site: node.params?.site, translatedFrom: 'agent-builder' }
        : { method: node.params?.method ?? 'GET', ...(url ? { url } : {}), translatedFrom: 'agent-builder' },
    }
  }
  if (mapped.kind === 'notify' && mapped.capability === 'send') {
    const email = node.type === 'email-output'
    const notifierType = email ? 'email' : node.type === 'webhook-output' ? 'webhook' : 'notification'
    const target = email
      ? readString(node.params?.to) ?? deliveryEmail ?? 'pending-recipient'
      : readString(node.params?.target) ?? readString(node.params?.url) ?? notifierType
    return {
      id: `agent-${node.id}-notification`,
      type: 'notification',
      provider: notifierType,
      mode: 'mock',
      config: {
        notifierType,
        target,
        ...(email ? { to: [target] } : {}),
        translatedFrom: 'agent-builder',
      },
    }
  }
}

function mapGeneratedNode(node: GeneratedWorkflowNode): MappedGeneratedNode {
  switch (node.type) {
    case 'manual-trigger':
      return {
        kind: 'schedule',
        capability: 'trigger',
        primitiveId: 'primitive.core.manual-trigger',
        primitivePorts: [{ id: 'out', direction: 'output', type: 'trigger', required: true }],
      }
    case 'schedule-trigger':
      return { kind: 'schedule', capability: 'trigger', catalogId: 'intelligence.schedule.cron' }
    case 'api-agent':
    case 'http':
      return { kind: 'source', capability: 'fetch' }
    case 'opencli-agent':
      return { kind: 'source', capability: 'fetch' }
    case 'governed-tool-agent':
      return { kind: 'agent', capability: 'accept', catalogId: 'external.tool.capability' }
    case 'llm-transform-agent':
      return { kind: 'agent', capability: 'summarize' }
    case 'merge':
      return { kind: 'flow', capability: 'merge' }
    case 'router':
    case 'condition':
      return { kind: 'router', capability: 'route' }
    case 'records-output':
      return { kind: 'sink', capability: 'store', catalogId: 'intelligence.sink.records' }
    case 'webhook-output':
      return { kind: 'notify', capability: 'send', catalogId: 'intelligence.output.webhook' }
    case 'email-output':
      return { kind: 'notify', capability: 'send' }
    case 'trigger':
      return { kind: 'schedule', capability: 'trigger' }
    case 'delay':
      return { kind: 'control', capability: 'route' }
    case 'transform':
      return { kind: 'agent', capability: /摘要|总结/.test(node.label) ? 'summarize' : 'normalize' }
    default:
      if (/通知|邮件|推送|发送/.test(node.label)) return { kind: 'notify', capability: 'send' }
      return { kind: 'action', capability: 'accept' }
  }
}

function canonicalPorts(
  source: GeneratedWorkflowNode | undefined,
  target: GeneratedWorkflowNode | undefined,
  sourcePort?: string,
  targetPort?: string,
) {
  if (sourcePort || targetPort) return { sourcePort, targetPort }
  if (target?.type === 'records-output') return { sourcePort: source?.type === 'api-agent' || source?.type === 'http' ? 'records' : undefined, targetPort: 'records' }
  if (target?.type === 'email-output' && (source?.type === 'api-agent' || source?.type === 'http')) {
    return { sourcePort: 'records', targetPort: 'records' }
  }
  return {}
}

function defaultMapping() {
  return { mode: 'auto' as const, fields: [], preserveRaw: true as const, compatible: true, conflicts: [] }
}

function positionForGeneratedNode(index: number, node: GeneratedWorkflowNode) {
  const saved = node.params?.builderPosition
  if (
    saved &&
    typeof saved === 'object' &&
    'x' in saved &&
    'y' in saved &&
    typeof saved.x === 'number' &&
    typeof saved.y === 'number'
  ) {
    return { x: saved.x, y: saved.y }
  }
  const outputOffset = node.type.endsWith('-output') ? 80 : 0
  return { x: 120 + (index % 4) * 280, y: 120 + Math.floor(index / 4) * 180 + outputOffset }
}

function dedupeAdapters(adapters: AdapterBinding[]) {
  return Array.from(new Map(adapters.map((adapter) => [adapter.id, adapter])).values())
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function domainFromAdapter(adapter: AdapterBinding): string[] {
  const value = readString(adapter.config.url)
  if (!value) return []
  try {
    return [new URL(value).hostname]
  } catch {
    return []
  }
}
