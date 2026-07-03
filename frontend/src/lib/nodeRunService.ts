import {
  listExecutableNodeActions,
  type NodeActionDescriptor,
  type NodeActionInput,
  type NodeActionRunRequest,
  runNodeAction,
} from './nodeActions.ts'
import { t as i18nT } from 'i18next'

const ID_PATTERN = /\b([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-z0-9-]{20,})\b/i
const JSON_BLOCK_PATTERN = /\{[\s\S]*\}/

export interface ParsedNodeRunIntent {
  actionId: string
  request: NodeActionRunRequest
  raw: string
}

function t(key: string, defaultValue: string) {
  const translated = i18nT(key, { defaultValue })
  return typeof translated === 'string' && translated !== key && translated !== 'Error'
    ? translated
    : defaultValue
}

export async function parseConversationToNodeRun(input: string): Promise<ParsedNodeRunIntent> {
  const raw = input.trim()
  if (!raw) {
    throw new Error(t('settings.conversation.errors.emptyInput', '请输入对话指令'))
  }

  const lowered = raw.toLowerCase()
  const kind = inferKind(lowered, raw)
  if (!kind) {
    throw new Error(
      t(
        'settings.conversation.errors.unsupportedType',
        '未识别指令类型，示例：trigger source <id> 或 run task <id>',
      ),
    )
  }

  const entityId = extractEntityId(raw)
  if (!entityId) {
    throw new Error(t('settings.conversation.errors.missingEntity', '未识别实体 ID，示例：trigger source <source_id>'))
  }

  const actionId = inferActionId(lowered, kind)
  if (!actionId) {
    throw new Error(t('settings.conversation.errors.unsupportedTarget', '当前目标类型暂未支持可执行动作'))
  }

  const payload = extractPayload(raw, kind)

  return {
    actionId,
    raw,
    request: {
      actionId,
      nodeKind: kind,
      entityId,
      payload,
    },
  }
}

export async function executeConversationNodeRun(input: string): Promise<Awaited<ReturnType<typeof runNodeAction>>> {
  const parsed = await parseConversationToNodeRun(input)
  return runNodeAction(parsed.request)
}

export function listExecutableActionsForKind(kind: string): NodeActionDescriptor[] {
  return listExecutableNodeActions(kind)
}

function inferKind(lowered: string, raw: string): 'source' | 'task' | 'agent' | undefined {
  const directIntent = lowered.match(
    /(?:执行|触发|trigger|run|rerun|再触发|启动)\s+(源|source|数据源|任务|task|智能体|agent)\b/,
  )
  if (directIntent?.[1]) {
    return mapKindFromToken(directIntent[1])
  }

  if (/\bsource\b|源|数据源/.test(lowered)) return 'source'
  if (/\btask\b|任务/.test(lowered)) return 'task'
  if (/\bagent\b|智能体/.test(lowered)) return 'agent'

  const id = extractEntityId(raw)
  if (id) {
    return /task|任务/.test(lowered)
      ? 'task'
      : /source|源|数据源/.test(lowered)
        ? 'source'
        : undefined
  }

  return undefined
}

function mapKindFromToken(token: string): 'source' | 'task' | 'agent' {
  if (token.includes('task') || token.includes('任务')) {
    return 'task'
  }
  if (token.includes('agent') || token.includes('智能体')) {
    return 'agent'
  }
  return 'source'
}

function inferActionId(lowered: string, kind: string): string {
  const isExecute = /(执行|触发|trigger|run|rerun|再触发|启动)/.test(lowered)
  const actions = listExecutableNodeActions(kind)
  if (actions.length === 0) {
    return ''
  }

  if (!isExecute) {
    return actions[0]?.id ?? `${kind}.trigger`
  }

  const requestedAction = actions.find((action) => action.id === `${kind}.trigger`)
  return requestedAction?.id ?? actions[0]?.id ?? `${kind}.trigger`
}

function extractEntityId(value: string): string | undefined {
  const direct = value.match(
    /(?:source(?:_id)?|task(?:_id)?|agent(?:_id)?|id)[:\s=]+([a-zA-Z0-9][a-zA-Z0-9-]{6,})|#([a-zA-Z0-9][a-zA-Z0-9-]{6,})/i,
  )
  if (direct?.[1]) return direct[1]
  if (direct?.[2]) return direct[2]
  const quoted = value.match(/['"“”]([a-zA-Z0-9-]{8,})['"“”]/)
  if (quoted?.[1]) return quoted[1]
  const match = value.match(ID_PATTERN)
  return match?.[1]
}

function extractPayload(raw: string, kind: string): NodeActionInput | undefined {
  const agentId = raw.match(/agent(?:_?id)?\s*[:=]\s*([a-zA-Z0-9-]{6,})/i)?.[1]

  const payload: NodeActionInput = {
    ...(agentId ? { agent_id: agentId } : {}),
  }

  const endpoint = raw.match(/endpoint\s*[:=]\s*([\w./:?#=-]{4,})/i)?.[1]
  if (endpoint) {
    payload.parameters = { ...(payload.parameters as Record<string, unknown> | undefined), chrome_endpoint: endpoint }
  }

  const jsonMatch = raw.match(JSON_BLOCK_PATTERN)
  if (jsonMatch?.[0]) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (isObject(parsed)) {
        payload.parameters = {
          ...(payload.parameters as Record<string, unknown> | undefined),
          ...parsed,
        }
      }
    } catch {
      // ignore invalid json payload block
    }
  }

  const rawParams = parseParamsKv(raw)
  delete rawParams.agent_id
  if (Object.keys(rawParams).length > 0) {
    payload.parameters = {
      ...(payload.parameters as Record<string, unknown> | undefined),
      ...rawParams,
    }
  }

  if (kind === 'task' && !payload.parameters && !agentId) {
    return undefined
  }

  if (Object.keys(payload).length === 0) {
    return undefined
  }

  return payload
}

export function getNodeRunErrorMessage(error: unknown) {
  return defaultNodeRunError(error)
}

function defaultNodeRunError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return t('settings.conversation.errors.unknown', '未知错误')
}

function parseParamsKv(value: string) {
  const params: Record<string, string> = {}
  const matcher = /(\w+)=([\w\-./:@]+)|--(\w+)\s+([^\s,，]+)/g

  let match = matcher.exec(value)
  while (match) {
    if (match[1] && match[2]) {
      params[match[1]] = match[2]
    }
    if (match[3] && match[4]) {
      params[match[3]] = match[4]
    }
    match = matcher.exec(value)
  }
  return params
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
