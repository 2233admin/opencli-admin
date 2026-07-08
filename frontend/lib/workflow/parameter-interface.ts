import type {
  ParameterInterface,
  ParameterInterfaceField,
  ParameterInterfaceGroup,
  WorkflowNode,
} from "@/lib/flow/types"
import type { AdapterBinding, WorkflowProjectNode } from "./schema"
import { getNodeInternals, type NodeInternals } from "./node-internals"
import { getNodeTemplate, readTemplateFieldValue, type NodeTemplate, type NodeTemplateField } from "./node-templates"

export type ParameterInterfaceMode = "template" | "exposed" | "summary"

export type ParameterInterfaceViewField = ParameterInterfaceField & {
  value: unknown
  readonly: boolean
}

export type ParameterInterfaceView = {
  mode: ParameterInterfaceMode
  title: string
  summary: string
  groups: ParameterInterfaceGroup[]
  fields: ParameterInterfaceViewField[]
}

export function buildParameterInterfaceView({
  node,
  adapter,
  nodes = [],
}: {
  node: WorkflowProjectNode | undefined
  adapter?: AdapterBinding
  nodes?: WorkflowNode[]
}): ParameterInterfaceView | undefined {
  if (!node) return undefined
  const template = getNodeTemplate(node)
  if (template && prefersTemplateInterface(node)) {
    return templateInterfaceView(node, adapter, template)
  }

  const parameterInterface = node.parameterInterface ?? createParameterInterfaceFromInternals(node.id, getNodeInternals(node))

  if (parameterInterface && parameterInterface.fields.length > 0) {
    const isPackage = typeof node.ui?.catalogId === "string" && node.ui.catalogId.startsWith("package.")
    return {
      mode: "exposed",
      title: isPackage ? "Package Parameters" : "Node Parameters",
      summary: "Public parameters promoted from node internals.",
      groups: sortedGroups(parameterInterface.groups),
      fields: parameterInterface.fields
        .map((field) => ({
          ...field,
          readonly: field.readonly === true,
          value: readParameterFieldValue(node, field, adapter, nodes),
        }))
        .sort(compareFields),
    }
  }

  if (template) {
    return templateInterfaceView(node, adapter, template)
  }

  const internals = getNodeInternals(node)
  if (!internals) return undefined
  return internalsSummaryView(node, internals)
}

function prefersTemplateInterface(node: WorkflowProjectNode): boolean {
  return isCollectionNeedNode(node)
}

export function createParameterInterfaceFromInternals(
  parentNodeId: string,
  internals: NodeInternals | undefined,
): ParameterInterface | undefined {
  if (!internals) return undefined
  const fields = internals.steps.flatMap((step) =>
    (step.exposedParams ?? []).map((param): ParameterInterfaceField => ({
      id: `${step.id}.${param.id}`,
      label: param.label,
      groupId: param.groupId,
      type: param.type,
      binding: {
        nodeId: `${parentNodeId}__${step.id}`,
        source: param.binding?.source ?? "params",
        fieldId: param.binding?.fieldId ?? param.id,
      },
      description: param.description,
      order: param.order,
      readonly: param.readonly,
      value: param.value,
      placeholder: param.placeholder,
      min: param.min,
      max: param.max,
      step: param.step,
      options: param.options,
    })),
  )
  if (fields.length === 0) return undefined

  const groupsById = new Map<string, ParameterInterfaceGroup>()
  for (const step of internals.steps) {
    for (const param of step.exposedParams ?? []) {
      if (!groupsById.has(param.groupId)) {
        groupsById.set(param.groupId, {
          id: param.groupId,
          label: param.groupLabel,
          order: param.groupOrder,
        })
      }
    }
  }

  return {
    groups: sortedGroups(Array.from(groupsById.values())),
    fields: fields.sort(compareFields),
  }
}

export function setParameterInterfaceFieldValue(
  parameterInterface: ParameterInterface,
  fieldId: string,
  value: unknown,
): ParameterInterface {
  return {
    ...parameterInterface,
    groups: [...parameterInterface.groups],
    fields: parameterInterface.fields.map((field) =>
      field.id === fieldId ? { ...field, value } : field,
    ),
  }
}

function readParameterFieldValue(
  node: WorkflowProjectNode,
  field: ParameterInterfaceField,
  adapter: AdapterBinding | undefined,
  nodes: WorkflowNode[],
): unknown {
  const boundNode = nodes.find((candidate) => candidate.id === field.binding.nodeId)
  if (boundNode) {
    if (field.binding.source === "params") {
      return boundNode.data.fields?.find((candidate) => candidate.id === field.binding.fieldId)?.value ?? field.value ?? ""
    }
    if (field.binding.source === "data") {
      return boundNode.data[field.binding.fieldId] ?? field.value ?? ""
    }
  }

  if (field.binding.nodeId === node.id || field.binding.nodeId.startsWith(`${node.id}__`)) {
    if (field.binding.source === "params") return node.params[field.binding.fieldId] ?? field.value ?? ""
    if (field.binding.source === "adapter") {
      if (field.binding.fieldId === "mode") return adapter?.mode ?? field.value ?? ""
      return adapter?.config[field.binding.fieldId] ?? field.value ?? ""
    }
    if (field.binding.source === "data") return node.ui?.[field.binding.fieldId] ?? field.value ?? ""
  }

  return field.value ?? ""
}

function templateFieldToParameterField(
  node: WorkflowProjectNode,
  adapter: AdapterBinding | undefined,
  field: NodeTemplateField,
  groupId: string,
  order: number,
): ParameterInterfaceViewField {
  return {
    id: field.id,
    label: field.label,
    groupId,
    type: field.type === "tokens" ? "tokens" : field.type,
    binding: {
      nodeId: node.id,
      source: field.source,
      fieldId: field.id,
    },
    description: field.description,
    order,
    readonly: false,
    value: readTemplateFieldValue(node, adapter, field),
    placeholder: "placeholder" in field ? field.placeholder : undefined,
    min: "min" in field ? field.min : undefined,
    max: "max" in field ? field.max : undefined,
    step: "step" in field ? field.step : undefined,
    options: "options" in field ? field.options : undefined,
  }
}

function templateInterfaceView(
  node: WorkflowProjectNode,
  adapter: AdapterBinding | undefined,
  template: NodeTemplate,
): ParameterInterfaceView {
  const group = templateGroup(node)
  return {
    mode: "template",
    title: template.title,
    summary: template.summary,
    groups: [group],
    fields: template.fields.map((field, index) => templateFieldToParameterField(node, adapter, field, group.id, index)),
  }
}

function internalsSummaryView(node: WorkflowProjectNode, internals: NodeInternals): ParameterInterfaceView {
  return {
    mode: "summary",
    title: internals.title,
    summary: "No public parameters are declared. Internal steps are shown as readonly evidence.",
    groups: [{ id: "internals", label: "Internals", order: 1 }],
    fields: internals.steps.map((step, index) => ({
      id: step.id,
      label: step.label,
      groupId: "internals",
      type: "text",
      binding: { nodeId: node.id, source: "data", fieldId: step.id },
      description: step.description,
      order: index,
      readonly: true,
      value: step.evidence,
    })),
  }
}

function templateGroup(node: WorkflowProjectNode): ParameterInterfaceGroup {
  if (isCollectionNeedNode(node)) {
    return { id: "input", label: "Input", order: 1 }
  }
  if (node.kind === "source") return { id: "source", label: "Source", order: 1 }
  if (node.kind === "schedule") return { id: "transform", label: "Transform", order: 1 }
  if (node.kind === "notify" || node.kind === "inbox") return { id: "render", label: "Render", order: 1 }
  return { id: "parameters", label: "Parameters", order: 1 }
}

function sortedGroups(groups: ParameterInterfaceGroup[]): ParameterInterfaceGroup[] {
  return [...groups].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.label.localeCompare(right.label))
}

function compareFields(left: { groupId: string; order?: number; label: string }, right: { groupId: string; order?: number; label: string }) {
  return left.groupId.localeCompare(right.groupId) || (left.order ?? 0) - (right.order ?? 0) || left.label.localeCompare(right.label)
}

function isCollectionNeedNode(node: WorkflowProjectNode): boolean {
  if (node.ui?.catalogId === "intelligence.input.collection-need") return true
  if (node.kind !== "schedule" || node.capability !== "trigger") return false
  if (node.params.mode === "demand-draft") return true
  return hasNeedShape(node.params) && !hasScheduleShape(node.params)
}

function hasNeedShape(params: Record<string, unknown>): boolean {
  return typeof params.text === "string" || typeof params.locale === "string"
}

function hasScheduleShape(params: Record<string, unknown>): boolean {
  return typeof params.interval === "string" || typeof params.timezone === "string"
}
