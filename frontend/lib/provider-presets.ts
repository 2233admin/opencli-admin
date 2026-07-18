import type { ModelProvider } from '@/lib/api/types'

export type ProviderPresetCategory =
  | 'coding_plan'
  | 'official_api'
  | 'relay'
  | 'local'

type LegacyProviderPresetCategory =
  | 'official'
  | 'china'
  | 'aggregator'
  | 'gateway'
  | 'local'

export type ProviderPreset = {
  key: string
  name: string
  shortName: string
  description: string
  category: ProviderPresetCategory
  provider_type: ModelProvider['provider_type']
  base_url: string
  default_model?: string
  accent: string
  icon?: string
  editableUrl?: boolean
  credentialHint?: string
}

export const PROVIDER_PRESET_CATEGORY_LABELS: Record<ProviderPresetCategory, string> = {
  coding_plan: 'Coding Plan',
  official_api: '官方 API',
  relay: '中转站',
  local: '本地模型',
}

/**
 * Provider directory adapted from CC Switch's provider presets.
 *
 * OpenCLI Admin currently supports Anthropic and OpenAI-compatible protocols,
 * so Gemini and Chinese cloud vendors use their documented OpenAI-compatible
 * endpoints. Model IDs are suggestions only; the setup flow fetches the live
 * catalog before asking the user to choose.
 */
const ALL_PROVIDER_PRESETS: Array<
  Omit<ProviderPreset, 'category'> & { category: LegacyProviderPresetCategory }
> = [
  {
    key: 'openai',
    name: 'OpenAI',
    shortName: 'OA',
    description: 'OpenAI 官方 API',
    category: 'official',
    provider_type: 'openai',
    base_url: '',
    accent: '#10A37F',
    icon: '/provider-icons/openai.svg',
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    shortName: 'AN',
    description: 'Claude 官方 API',
    category: 'official',
    provider_type: 'claude',
    base_url: '',
    accent: '#D97757',
    icon: '/provider-icons/anthropic.svg',
  },
  {
    key: 'gemini',
    name: 'Google Gemini',
    shortName: 'G',
    description: 'Gemini OpenAI 兼容接口',
    category: 'official',
    provider_type: 'openai',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    accent: '#4285F4',
    icon: '/provider-icons/gemini.svg',
  },
  {
    key: 'azure-openai',
    name: 'Azure OpenAI',
    shortName: 'AZ',
    description: '填写 Azure 资源地址',
    category: 'official',
    provider_type: 'openai',
    base_url: 'https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1',
    accent: '#0078D4',
    editableUrl: true,
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DS',
    description: 'DeepSeek 开放平台',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://api.deepseek.com',
    accent: '#4D6BFE',
    icon: '/provider-icons/deepseek.svg',
  },
  {
    key: 'zhipu-coding-plan',
    name: '智谱 GLM Coding Plan',
    shortName: 'GLM',
    description: '专属套餐 Key 与 Coding 端点',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://open.bigmodel.cn/api/coding/paas/v4',
    accent: '#0F62FE',
    icon: '/provider-icons/zhipu.svg',
    credentialHint: '使用 GLM Coding Plan 套餐内创建的专属 Key，不能与开放平台 API Key 混用。',
  },
  {
    key: 'zhipu',
    name: '智谱开放平台 API',
    shortName: 'GLM',
    description: '普通按量 API',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    accent: '#0F62FE',
    icon: '/provider-icons/zhipu.svg',
  },
  {
    key: 'bailian-coding-plan',
    name: '百炼 Coding Plan',
    shortName: 'QW',
    description: '专属套餐 Key 与 Coding 端点',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://coding.dashscope.aliyuncs.com/v1',
    accent: '#624AFF',
    icon: '/provider-icons/bailian.svg',
    credentialHint: '使用 sk-sp- 开头的 Coding Plan 专属 Key，普通百炼 API Key 无法使用。',
  },
  {
    key: 'bailian',
    name: '阿里云百炼 API',
    shortName: 'QW',
    description: '普通按量 API',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    accent: '#624AFF',
    icon: '/provider-icons/bailian.svg',
  },
  {
    key: 'kimi-coding-plan',
    name: 'Kimi Code',
    shortName: 'K',
    description: '会员专属 Key 与 Coding 端点',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://api.kimi.com/coding/v1',
    default_model: 'kimi-for-coding',
    accent: '#111827',
    icon: '/provider-icons/kimi.svg',
    credentialHint: '使用 Kimi Code Console 创建的会员专属 Key，不能与开放平台 API Key 混用。',
  },
  {
    key: 'kimi',
    name: 'Kimi 开放平台 API',
    shortName: 'K',
    description: '普通按量 API',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://api.moonshot.cn/v1',
    accent: '#111827',
    icon: '/provider-icons/kimi.svg',
  },
  {
    key: 'minimax-coding-plan',
    name: 'MiniMax Coding Plan',
    shortName: 'MM',
    description: 'sk-cp- 专属 Key',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://api.minimaxi.com/v1',
    default_model: 'MiniMax-M3',
    accent: '#F64551',
    icon: '/provider-icons/minimax.svg',
    credentialHint: '使用 sk-cp- 开头的 MiniMax Token Plan 专属 Key；普通开放平台 Key 不属于该套餐。',
  },
  {
    key: 'minimax',
    name: 'MiniMax 开放平台 API',
    shortName: 'MM',
    description: '普通按量 API',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://api.minimaxi.com/v1',
    accent: '#F64551',
    icon: '/provider-icons/minimax.svg',
  },
  {
    key: 'mimo-coding-plan',
    name: '小米 MiMo Coding Plan',
    shortName: 'MiMo',
    description: 'tp- 专属 Key 与 Token Plan 端点',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://token-plan-cn.xiaomimimo.com/v1',
    default_model: 'mimo-v2.5-pro',
    accent: '#111111',
    credentialHint: '使用 tp- 开头的小米 MiMo Token Plan 专属 Key；不能与普通 sk- API Key 混用。',
  },
  {
    key: 'mimo',
    name: '小米 MiMo 开放平台 API',
    shortName: 'MiMo',
    description: '普通按量 API',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://api.xiaomimimo.com/v1',
    default_model: 'mimo-v2.5-pro',
    accent: '#111111',
  },
  {
    key: 'siliconflow',
    name: '硅基流动',
    shortName: 'SF',
    description: 'SiliconFlow 模型平台',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://api.siliconflow.cn/v1',
    accent: '#6E29F6',
    icon: '/provider-icons/siliconflow.svg',
  },
  {
    key: 'modelscope',
    name: '魔搭 ModelScope',
    shortName: 'MS',
    description: '魔搭推理 API',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://api-inference.modelscope.cn/v1',
    accent: '#624AFF',
  },
  {
    key: 'qianfan',
    name: '百度千帆',
    shortName: 'BD',
    description: '千帆 OpenAI 兼容接口',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://qianfan.baidubce.com/v2',
    accent: '#2932E1',
  },
  {
    key: 'volcengine',
    name: '火山方舟',
    shortName: 'ARK',
    description: '火山引擎模型服务',
    category: 'china',
    provider_type: 'openai',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    accent: '#3370FF',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    shortName: 'OR',
    description: '多模型统一 API',
    category: 'aggregator',
    provider_type: 'openai',
    base_url: 'https://openrouter.ai/api/v1',
    accent: '#6566F1',
    icon: '/provider-icons/openrouter.svg',
  },
  {
    key: 'together',
    name: 'Together AI',
    shortName: 'TG',
    description: '开源模型推理平台',
    category: 'aggregator',
    provider_type: 'openai',
    base_url: 'https://api.together.xyz/v1',
    accent: '#111827',
  },
  {
    key: 'groq',
    name: 'Groq',
    shortName: 'GQ',
    description: 'Groq 高速推理',
    category: 'aggregator',
    provider_type: 'openai',
    base_url: 'https://api.groq.com/openai/v1',
    accent: '#F55036',
  },
  {
    key: 'novita',
    name: 'Novita AI',
    shortName: 'NV',
    description: '多模型推理 API',
    category: 'aggregator',
    provider_type: 'openai',
    base_url: 'https://api.novita.ai/openai/v1',
    accent: '#7C3AED',
  },
  {
    key: 'qiniu',
    name: '七牛云 AI',
    shortName: 'QN',
    description: '七牛云模型聚合服务',
    category: 'aggregator',
    provider_type: 'openai',
    base_url: 'https://api.qnaigc.com/bypass/openai/v1',
    accent: '#00AEEF',
  },
  {
    key: 'newapi',
    name: 'New API',
    shortName: 'NA',
    description: '自部署多协议网关',
    category: 'gateway',
    provider_type: 'openai',
    base_url: 'http://127.0.0.1:3000/v1',
    accent: '#00A67E',
    icon: '/provider-icons/newapi.svg',
    editableUrl: true,
  },
  {
    key: 'oneapi',
    name: 'One API',
    shortName: '1A',
    description: '自部署统一模型接口',
    category: 'gateway',
    provider_type: 'openai',
    base_url: 'http://127.0.0.1:3000/v1',
    accent: '#2563EB',
    editableUrl: true,
  },
  {
    key: 'custom-gateway',
    name: '自定义网关',
    shortName: '+',
    description: 'OpenAI 兼容服务',
    category: 'gateway',
    provider_type: 'openai',
    base_url: '',
    accent: '#64748B',
    editableUrl: true,
  },
  {
    key: 'ollama',
    name: 'Ollama',
    shortName: 'OL',
    description: '本机 Ollama 服务',
    category: 'local',
    provider_type: 'local',
    base_url: 'http://127.0.0.1:11434/v1',
    accent: '#111827',
    icon: '/provider-icons/ollama.svg',
  },
  {
    key: 'lm-studio',
    name: 'LM Studio',
    shortName: 'LM',
    description: 'LM Studio 本地服务',
    category: 'local',
    provider_type: 'local',
    base_url: 'http://127.0.0.1:1234/v1',
    accent: '#7C3AED',
  },
  {
    key: 'vllm',
    name: 'vLLM',
    shortName: 'VL',
    description: 'vLLM OpenAI 服务',
    category: 'local',
    provider_type: 'local',
    base_url: 'http://127.0.0.1:8000/v1',
    accent: '#EA580C',
  },
  {
    key: 'localai',
    name: 'LocalAI',
    shortName: 'LA',
    description: 'LocalAI 本地服务',
    category: 'local',
    provider_type: 'local',
    base_url: 'http://127.0.0.1:8080/v1',
    accent: '#059669',
  },
]

const COMMON_PROVIDER_KEYS = new Set([
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'zhipu-coding-plan',
  'zhipu',
  'bailian-coding-plan',
  'bailian',
  'kimi-coding-plan',
  'kimi',
  'minimax-coding-plan',
  'minimax',
  'mimo-coding-plan',
  'mimo',
  'siliconflow',
  'openrouter',
  'newapi',
  'ollama',
])

const COMMON_PROVIDER_CATEGORIES: Record<string, ProviderPresetCategory> = {
  openai: 'official_api',
  anthropic: 'official_api',
  gemini: 'official_api',
  deepseek: 'official_api',
  siliconflow: 'official_api',
  'zhipu-coding-plan': 'coding_plan',
  zhipu: 'official_api',
  'bailian-coding-plan': 'coding_plan',
  bailian: 'official_api',
  'kimi-coding-plan': 'coding_plan',
  kimi: 'official_api',
  'minimax-coding-plan': 'coding_plan',
  minimax: 'official_api',
  'mimo-coding-plan': 'coding_plan',
  mimo: 'official_api',
  openrouter: 'relay',
  newapi: 'local',
  ollama: 'local',
}

export const PROVIDER_PRESETS: ProviderPreset[] = ALL_PROVIDER_PRESETS.filter((preset) =>
  COMMON_PROVIDER_KEYS.has(preset.key),
).map((preset) => ({
  ...preset,
  category: COMMON_PROVIDER_CATEGORIES[preset.key],
}))

export function getProviderPreset(key?: string | null) {
  return PROVIDER_PRESETS.find((preset) => preset.key === key)
}
