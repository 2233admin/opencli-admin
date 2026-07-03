// Processor atoms — one per real backend processor (backend/processors/*).
// These enrich/transform a collected record (in → out). Config mirrors each
// processor's config.get(...).
import { defineNode } from '../define'
import type { NodeSpec } from '../spec'

const openai = defineNode({
  type: 'processor.openai',
  category: 'agent',
  title: 'OpenAI 处理',
  subtitle: 'openai',
  icon: 'sparkles',
  ports: { inputs: [{ id: 'in', label: '记录' }], outputs: [{ id: 'out', label: '增强' }] },
  config: {
    fields: [
      { key: 'model', type: 'string', label: '模型', default: 'gpt-4o-mini', required: true },
      { key: 'base_url', type: 'string', label: 'Base URL', placeholder: 'https://api.openai.com/v1' },
      { key: 'api_key', type: 'string', label: 'API Key', placeholder: '在设置里配, 别硬编码' },
      { key: 'max_tokens', type: 'number', label: 'max_tokens', default: 1024 },
      { key: 'json_mode', type: 'boolean', label: 'JSON 模式', default: true },
    ],
  },
})

const claude = defineNode({
  type: 'processor.claude',
  category: 'agent',
  title: 'Claude 处理',
  subtitle: 'claude',
  icon: 'sparkles',
  ports: { inputs: [{ id: 'in', label: '记录' }], outputs: [{ id: 'out', label: '增强' }] },
  config: {
    fields: [
      { key: 'model', type: 'string', label: '模型', default: 'claude-haiku-4-5', required: true },
      { key: 'api_key', type: 'string', label: 'API Key', placeholder: '在设置里配' },
      { key: 'max_tokens', type: 'number', label: 'max_tokens', default: 1024 },
    ],
  },
})

const local = defineNode({
  type: 'processor.local',
  category: 'agent',
  title: '本地模型',
  subtitle: 'local',
  icon: 'cpu',
  ports: { inputs: [{ id: 'in', label: '记录' }], outputs: [{ id: 'out', label: '增强' }] },
  config: {
    fields: [
      { key: 'base_url', type: 'string', label: 'Base URL', default: 'http://localhost:11434/v1', required: true },
      { key: 'model', type: 'string', label: '模型', default: 'qwen3:4b', required: true },
      { key: 'api_style', type: 'select', label: 'API 风格', default: 'openai', options: [
        { value: 'openai', label: 'openai' }, { value: 'ollama', label: 'ollama' },
      ] },
      { key: 'timeout', type: 'number', label: '超时(s)', default: 60 },
    ],
  },
})

const externalHttp = defineNode({
  type: 'processor.external_http',
  category: 'transform',
  title: '外部 HTTP 处理',
  subtitle: 'external_http',
  icon: 'webhook',
  ports: { inputs: [{ id: 'in', label: '记录' }], outputs: [{ id: 'out', label: '结果' }] },
  config: {
    fields: [{ key: 'config', type: 'json', label: '配置', placeholder: '{"url":"…"}' }],
  },
})

export const PROCESSOR_NODES: NodeSpec<any>[] = [openai, claude, local, externalHttp]
