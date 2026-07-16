import type { ProjectAppType, ProjectSummary } from '@/lib/api/types'

export type ProjectAppTypeFilter = ProjectAppType | 'all'

export const PROJECT_APP_TYPE_LABELS: Record<ProjectAppType, string> = {
  chatbot: '聊天助手',
  agent: 'Agent',
  chatflow: 'Chatflow',
  workflow: 'Workflow',
  'text-generator': '文本生成',
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
  return filter === 'all' || project.app_type === filter
}
