import { getTask, triggerTask } from '../api/endpoints.ts'
import { t as i18nT } from 'i18next'

export type NodeActionKind = 'source' | 'task' | 'agent' | string

export interface NodeActionInput {
  [key: string]: unknown
}

export interface NodeActionRunRequest {
  actionId: string
  nodeKind: NodeActionKind
  entityId: string
  payload?: NodeActionInput
}

export interface NodeActionRunResult {
  ok: boolean
  message: string
  taskId?: string
  sourceId?: string
}

function t(key: string, defaultValue: string, options: Record<string, unknown> = {}) {
  const translated = i18nT(key, { defaultValue, ...options })
  return typeof translated === 'string' && translated !== key && translated !== 'Error'
    ? translated
    : defaultValue
}

export type NodeActionType = 'trigger' | 'navigate'

export interface NodeActionDescriptor {
  id: string
  type: NodeActionType
  label: string
  description: string
  actionKind: string
  actionTarget: string
  payload?: NodeActionInput
  run?: (request: NodeActionRunRequest) => Promise<NodeActionRunResult>
}

const nodeActionByKind: Record<string, NodeActionDescriptor[]> = {
  source: [
    {
      id: 'source.trigger',
      type: 'trigger',
      actionKind: 'run',
      get label() {
        return t('nodeActions.source.trigger.label', '触发采集')
      },
      get description() {
        return t('nodeActions.source.trigger.description', '直接触发一次数据源采集任务')
      },
      actionTarget: '/sources',
      run: async (request) => {
        try {
          const agentId = normalizeString(request.payload?.agent_id)
          const parameters = isRecord(request.payload?.parameters) ? request.payload?.parameters : undefined

          const result = await triggerTask(request.entityId, parameters, agentId)
          return {
            ok: true,
            message: t('nodeActions.source.trigger.submitted', '采集已提交'),
            taskId: result?.task_id,
          }
        } catch (error) {
          return {
            ok: false,
            message: defaultErrorMessage(error),
          }
        }
      },
    },
    {
      id: 'source.open',
      type: 'navigate',
      actionKind: 'open',
      get label() {
        return t('nodeActions.source.open.label', '打开源详情')
      },
      get description() {
        return t('nodeActions.source.open.description', '跳转到数据源列表并聚焦该来源')
      },
      actionTarget: '/sources',
      payload: { section: 'source' },
    },
  ],
  task: [
    {
      id: 'task.trigger',
      type: 'trigger',
      actionKind: 'run',
      get label() {
        return t('nodeActions.task.trigger.label', '再次触发')
      },
      get description() {
        return t('nodeActions.task.trigger.description', '基于任务源 ID 触发一次采集')
      },
      actionTarget: '/tasks',
      run: async (request) => {
        try {
          const task = await getTask(request.entityId)
          const agentId = normalizeString(request.payload?.agent_id)
          const parameters = isRecord(request.payload?.parameters) ? request.payload?.parameters : undefined

          if (!task?.source_id) {
            return {
              ok: false,
              message: t('nodeActions.task.trigger.missingSource', '任务缺少 source_id'),
            }
          }

          const result = await triggerTask(task.source_id, parameters, agentId)
          return {
            ok: true,
            message: t('nodeActions.task.trigger.submitted', '采集已提交'),
            taskId: result?.task_id,
            sourceId: task.source_id,
          }
        } catch (error) {
          return {
            ok: false,
            message: defaultErrorMessage(error),
          }
        }
      },
    },
    {
      id: 'task.open',
      type: 'navigate',
      actionKind: 'open',
      get label() {
        return t('nodeActions.task.open.label', '查看详情')
      },
      get description() {
        return t('nodeActions.task.open.description', '跳转到任务页面')
      },
      actionTarget: '/tasks',
      payload: { section: 'task' },
    },
  ],
  agent: [
    {
      id: 'agent.open',
      type: 'navigate',
      actionKind: 'open',
      get label() {
        return t('nodeActions.agent.open.label', '查看智能体')
      },
      get description() {
        return t('nodeActions.agent.open.description', '跳转到智能体配置页')
      },
      actionTarget: '/agents',
      payload: { section: 'agent' },
    },
  ],
}

const EMPTY_ACTIONS: NodeActionDescriptor[] = []

export function listNodeActions(kind: string): NodeActionDescriptor[] {
  return (nodeActionByKind[kind] ?? EMPTY_ACTIONS).map((action) => ({ ...action }))
}

export function listExecutableNodeActions(kind: string): NodeActionDescriptor[] {
  return listNodeActions(kind).filter((action) => action.type === 'trigger')
}

export function findNodeActionById(kind: string, id: string): NodeActionDescriptor | undefined {
  return nodeActionByKind[kind]?.find((action) => action.id === id)
}

export function getDefaultActionIdForKind(kind: string): string | undefined {
  return listExecutableNodeActions(kind)[0]?.id
}

export function isExecutableAction(kind: string, actionId: string): boolean {
  return listExecutableNodeActions(kind).some((action) => action.id === actionId)
}

export async function runNodeAction(request: NodeActionRunRequest): Promise<NodeActionRunResult> {
  const action = findNodeActionById(request.nodeKind, request.actionId)
  if (!action || !action.run) {
    return {
      ok: false,
      message: t('nodeActions.errors.noExecutableAction', `No executable action for ${request.actionId}`, {
        actionId: request.actionId,
      }),
    }
  }
  return action.run(request)
}

function defaultErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return t('nodeActions.errors.unknown', '未知错误')
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
