import type { ProjectAppType, ProjectSummary } from '@/lib/api/types'

export type ProjectAppCategory = 'conversation' | 'orchestration' | 'generation'
export type ProjectAppTypeFilter = ProjectAppCategory | 'all'

export const PROJECT_APP_TYPE_LABELS: Record<ProjectAppType, string> = {
  chatbot: '聊天助手',
  agent: 'Agent',
  chatflow: 'Chatflow',
  workflow: 'Workflow',
  'text-generator': '文本生成',
}

export const PROJECT_APP_CATEGORY_LABELS: Record<ProjectAppCategory, string> = {
  conversation: '对话应用',
  orchestration: '流程编排',
  generation: '内容生成',
}

const PROJECT_APP_TYPE_CATEGORIES: Record<ProjectAppType, ProjectAppCategory> = {
  chatbot: 'conversation',
  agent: 'conversation',
  chatflow: 'conversation',
  workflow: 'orchestration',
  'text-generator': 'generation',
}

export function projectAppTypeLabel(appType: ProjectAppType | string | null | undefined) {
  return PROJECT_APP_TYPE_LABELS[appType as ProjectAppType] ?? '未分类'
}

export function projectAppCategory(appType: ProjectAppType | string | null | undefined) {
  return PROJECT_APP_TYPE_CATEGORIES[appType as ProjectAppType] ?? 'orchestration'
}

export function projectAppCategoryLabel(appType: ProjectAppType | string | null | undefined) {
  return PROJECT_APP_CATEGORY_LABELS[projectAppCategory(appType)]
}

const DIFY_APP_MODE_TYPES: Partial<Record<string, ProjectAppType>> = {
  chat: 'chatbot',
  'agent-chat': 'agent',
  'advanced-chat': 'chatflow',
  workflow: 'workflow',
  completion: 'text-generator',
}

export function projectAppTypeForDifyMode(mode?: string | null): ProjectAppType {
  return DIFY_APP_MODE_TYPES[mode?.toLowerCase() ?? ''] ?? 'workflow'
}

export function projectMatchesAppType(
  project: Pick<ProjectSummary, 'app_type'>,
  filter: ProjectAppTypeFilter,
) {
  return filter === 'all' || projectAppCategory(project.app_type) === filter
}
