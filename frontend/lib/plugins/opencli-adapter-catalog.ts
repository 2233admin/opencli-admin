import type { WorkflowOpenCLIAdapterNode } from "@/lib/workflow/backend-opencli-adapter-nodes"

export type OpenCLIAdapterPlugin = {
  kind: "opencli-adapter"
  category: "official-adapter"
  siteCategory: OpenCLISiteCategory
  availability: "included"
  description: string
  id: string
  site: string
  label: string
  introduction?: string
  features: string[]
  source: "OpenCLI"
  commandCount: number
  parameterReadyCount: number
  configurationRequiredCount: number
  readCount: number
  writeCount: number
  browserRequired: boolean
  loginRequired: boolean
  domains: string[]
  commands: WorkflowOpenCLIAdapterNode[]
}

export const OPENCLI_SITE_CATEGORIES = [
  { key: "ai", label: "AI 工具" },
  { key: "social", label: "社交与内容" },
  { key: "news", label: "新闻资讯" },
  { key: "finance", label: "金融数据" },
  { key: "academic", label: "学术研究" },
  { key: "developer", label: "开发者工具" },
  { key: "commerce", label: "电商与生活" },
  { key: "government", label: "政务与行业" },
  { key: "local-app", label: "本地应用" },
  { key: "general", label: "工具与数据" },
] as const

export type OpenCLISiteCategory = (typeof OPENCLI_SITE_CATEGORIES)[number]["key"]

export type OpenCLIAdapterRegistrySummary = {
  adapterCount: number
  commandCount: number
  parameterReadyCount: number
  configurationRequiredCount: number
}

function adapterId(node: WorkflowOpenCLIAdapterNode): string {
  const id = node.adapter.id
  return typeof id === "string" && id.trim() ? id : `opencli-${node.site}`
}

function siteLabel(site: string): string {
  return site
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

const SITE_PRESENTATION_OVERRIDES: Record<
  string,
  { label: string; introduction?: string }
> = {
  baidu: {
    label: "百度财经",
    introduction: "百度财经提供宏观经济数据日历、股票概念板块和市场分类信息。",
  },
  "baidu-scholar": {
    label: "百度学术",
    introduction: "百度学术用于检索论文、作者、期刊、年份和引用信息。",
  },
  "36kr": { label: "36氪" },
  arxiv: { label: "arXiv" },
  bbc: { label: "BBC" },
  bilibili: { label: "哔哩哔哩" },
  chatgpt: { label: "ChatGPT 网页版" },
  "chatgpt-app": { label: "ChatGPT 桌面应用" },
  cnki: { label: "中国知网" },
  coingecko: { label: "CoinGecko" },
  coinglass: { label: "CoinGlass" },
  ctrip: { label: "携程" },
  dblp: { label: "DBLP" },
  dockerhub: { label: "Docker Hub" },
  doubao: { label: "豆包网页版" },
  "doubao-app": { label: "豆包桌面应用" },
  douyin: { label: "抖音" },
  duckduckgo: { label: "DuckDuckGo" },
  eastmoney: { label: "东方财富" },
  google: { label: "Google 搜索" },
  "google-scholar": { label: "Google Scholar" },
  github: { label: "GitHub" },
  "github-trending": { label: "GitHub Trending" },
  hackernews: { label: "Hacker News" },
  hf: { label: "Hugging Face" },
  imdb: { label: "IMDb" },
  jd: { label: "京东" },
  linkedin: { label: "LinkedIn" },
  "linkedin-learning": { label: "LinkedIn Learning" },
  mdn: { label: "MDN" },
  npm: { label: "npm" },
  nvd: { label: "NVD" },
  oeis: { label: "OEIS" },
  openalex: { label: "OpenAlex" },
  openfda: { label: "openFDA" },
  openreview: { label: "OpenReview" },
  osv: { label: "OSV" },
  producthunt: { label: "Product Hunt" },
  pubmed: { label: "PubMed" },
  pypi: { label: "PyPI" },
  rfc: { label: "RFC" },
  semanticscholar: { label: "Semantic Scholar" },
  sina: { label: "新浪财经" },
  sinablog: { label: "新浪博客" },
  sinafinance: { label: "新浪财经数据" },
  stackoverflow: { label: "Stack Overflow" },
  weread: { label: "微信读书" },
  "weread-official": { label: "微信读书公众号" },
  xiaohongshu: { label: "小红书" },
  yahoo: { label: "Yahoo 搜索" },
  "yahoo-finance": { label: "Yahoo Finance" },
}

const FEATURE_COMMAND_PRIORITY = [
  /^(?:search|query|lookup|find)$/i,
  /^(?:list|feed|latest|trending|news)$/i,
  /^(?:detail|show|get|info|profile|item)$/i,
]

function featurePriority(command: string): number {
  const index = FEATURE_COMMAND_PRIORITY.findIndex((pattern) => pattern.test(command))
  return index === -1 ? FEATURE_COMMAND_PRIORITY.length : index
}

function cleanFeatureDescription(description: string): string {
  const cleaned = description.replace(/\s+/g, " ").trim().replace(/[。.]$/, "")
  return cleaned.length > 140 ? `${cleaned.slice(0, 139).trimEnd()}…` : cleaned
}

function siteFeatures(commands: WorkflowOpenCLIAdapterNode[]): string[] {
  const ordered = [...commands].sort((left, right) => {
    const priority = featurePriority(left.command) - featurePriority(right.command)
    return priority || left.command.localeCompare(right.command)
  })
  const descriptions = ordered
    .map((command) => cleanFeatureDescription(command.description))
    .filter(Boolean)
  return Array.from(new Set(descriptions)).slice(0, 4)
}

const SITE_CATEGORY_MEMBERS: Record<
  Exclude<OpenCLISiteCategory, "general">,
  ReadonlySet<string>
> = {
  "local-app": new Set([
    "antigravity",
    "chatgpt-app",
    "chatwise",
    "codex",
    "cursor",
    "discord-app",
    "doubao-app",
    "qoder",
    "trae-cn",
    "trae-solo",
  ]),
  ai: new Set([
    "chatgpt",
    "claude",
    "deepseek",
    "doubao",
    "gemini",
    "grok",
    "hf",
    "jimeng",
    "kimi",
    "manus",
    "notebooklm",
    "paperreview",
    "qwen",
    "slock",
    "suno",
    "yuanbao",
    "yollomi",
  ]),
  social: new Set([
    "1point3acres",
    "apple-podcasts",
    "band",
    "bilibili",
    "bluesky",
    "douban",
    "douyin",
    "facebook",
    "hupu",
    "instagram",
    "jike",
    "lesswrong",
    "linkedin",
    "maimai",
    "medium",
    "pixiv",
    "reddit",
    "rednote",
    "sinablog",
    "spotify",
    "substack",
    "tieba",
    "tiktok",
    "twitter",
    "wechat-channels",
    "weibo",
    "weixin",
    "xiaohongshu",
    "xiaoyuzhou",
    "youtube",
    "zhihu",
    "zsxq",
  ]),
  news: new Set([
    "36kr",
    "aibase",
    "bbc",
    "hackernews",
    "jin10",
    "reuters",
    "sina",
    "stcn",
    "toutiao",
    "wallstreetcn",
    "yahoo",
    "yicai",
  ]),
  finance: new Set([
    "barchart",
    "binance",
    "bloomberg",
    "bse",
    "chinamoney",
    "cls",
    "cninfo",
    "cnstock",
    "coingecko",
    "coinglass",
    "commodity-options",
    "csmar",
    "defillama",
    "eastmoney",
    "epsnet",
    "guba",
    "mercury",
    "pboc",
    "sevenfv",
    "sge",
    "sinafinance",
    "sse",
    "szse",
    "tdx",
    "ths",
    "xueqiu",
    "yahoo-finance",
    "zszq",
  ]),
  academic: new Set([
    "archive",
    "arxiv",
    "baidu-scholar",
    "chaoxing",
    "cnki",
    "dblp",
    "geogebra",
    "google-scholar",
    "oeis",
    "openalex",
    "openreview",
    "pubmed",
    "semanticscholar",
    "wanfang",
    "wikidata",
    "wikipedia",
    "zlibrary",
  ]),
  developer: new Set([
    "adapter-eco",
    "crates",
    "devto",
    "dockerhub",
    "endoflife",
    "flathub",
    "gitee",
    "github",
    "github-trending",
    "goproxy",
    "homebrew",
    "juejin",
    "linux-do",
    "lobsters",
    "maven",
    "mdn",
    "npm",
    "nuget",
    "nvd",
    "osv",
    "packagist",
    "producthunt",
    "pypi",
    "rfc",
    "rubygems",
    "stackoverflow",
    "uisdc",
    "uiverse",
    "v2ex",
  ]),
  commerce: new Set([
    "12306",
    "1688",
    "51job",
    "amazon",
    "autohome",
    "booking",
    "boss",
    "chess",
    "coupang",
    "ctrip",
    "dianping",
    "dongchedi",
    "guazi",
    "hltv",
    "huodongxing",
    "imdb",
    "indeed",
    "jd",
    "ke",
    "lichess",
    "linkedin-learning",
    "nowcoder",
    "smzdm",
    "steam",
    "taobao",
    "tvmaze",
    "upwork",
    "weread",
    "weread-official",
    "xianyu",
    "xiaoe",
  ]),
  government: new Set([
    "caam",
    "ccgp",
    "cde",
    "cpcif",
    "csrc",
    "csteelt",
    "customs",
    "drcnet",
    "eia",
    "ggzy",
    "gov-law",
    "gov-policy",
    "jianyu",
    "miit",
    "mof",
    "mofc",
    "mofcom",
    "ndrc",
    "nea",
    "nfra",
    "openfda",
    "powerchina",
    "safe",
    "sasac",
    "statsgov",
    "tzxm",
  ]),
}

const CATEGORY_MATCH_ORDER: ReadonlyArray<Exclude<OpenCLISiteCategory, "general">> = [
  "local-app",
  "ai",
  "social",
  "news",
  "finance",
  "academic",
  "developer",
  "commerce",
  "government",
]

const FALLBACK_CATEGORY_PATTERNS: ReadonlyArray<{
  category: Exclude<OpenCLISiteCategory, "local-app" | "general">
  pattern: RegExp
}> = [
  { category: "government", pattern: /\.gov(?:\.|$)|government|policy|regulation|政务|政策|监管/ },
  { category: "academic", pattern: /scholar|academic|research|journal|学术|论文|文献/ },
  { category: "ai", pattern: /artificial intelligence|\bai\b|chatbot|\bllm\b|大模型|人工智能/ },
  { category: "finance", pattern: /finance|stock|exchange|crypto|证券|股票|金融/ },
  { category: "news", pattern: /news|media|新闻|资讯/ },
  { category: "social", pattern: /social|community|forum|video|podcast|社交|社区|视频|播客/ },
  { category: "developer", pattern: /developer|software|package|code|开发|软件包|代码/ },
  { category: "commerce", pattern: /shop|travel|hotel|job|car|购物|旅行|酒店|招聘|汽车/ },
]

function isLocalDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase()
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized.endsWith(".local")
}

function classifyOpenCLISiteCategory(
  commands: WorkflowOpenCLIAdapterNode[],
  domains: string[],
): OpenCLISiteCategory {
  const site = commands[0]?.site.toLowerCase() ?? ""
  if (domains.length > 0 && domains.every(isLocalDomain)) return "local-app"
  for (const category of CATEGORY_MATCH_ORDER) {
    if (SITE_CATEGORY_MEMBERS[category].has(site)) return category
  }

  if (domains.some((domain) => /\.gov(?:\.|$)/i.test(domain))) return "government"
  const identity = `${site} ${domains.join(" ")}`.toLowerCase()
  return FALLBACK_CATEGORY_PATTERNS.find(({ pattern }) => pattern.test(identity))?.category ?? "general"
}

export function groupOpenCLIAdapterPlugins(
  nodes: WorkflowOpenCLIAdapterNode[],
): OpenCLIAdapterPlugin[] {
  const groups = new Map<string, WorkflowOpenCLIAdapterNode[]>()
  for (const node of nodes) {
    const id = adapterId(node)
    const current = groups.get(id)
    if (current) current.push(node)
    else groups.set(id, [node])
  }

  return Array.from(groups, ([id, commands]) => {
    commands.sort((left, right) => left.command.localeCompare(right.command))
    const first = commands[0]
    const domains = Array.from(
      new Set(commands.map((command) => command.domain).filter((domain): domain is string => Boolean(domain))),
    ).sort()
    const presentation = SITE_PRESENTATION_OVERRIDES[first.site]
    const label = presentation?.label ?? siteLabel(first.site)
    return {
      kind: "opencli-adapter" as const,
      category: "official-adapter" as const,
      siteCategory: classifyOpenCLISiteCategory(commands, domains),
      availability: "included" as const,
      description: presentation?.introduction ?? `${label} 当前支持的主要内容。`,
      id,
      site: first.site,
      label,
      introduction: presentation?.introduction,
      features: siteFeatures(commands),
      source: "OpenCLI" as const,
      commandCount: commands.length,
      parameterReadyCount: commands.filter((command) => command.status === "runnable").length,
      configurationRequiredCount: commands.filter((command) => command.status === "blocked").length,
      readCount: commands.filter((command) => command.access === "read").length,
      writeCount: commands.filter((command) => command.access !== "read").length,
      browserRequired: commands.some((command) => command.browser),
      loginRequired: commands.some((command) => command.strategy === "cookie"),
      domains,
      commands,
    }
  }).sort((left, right) => left.label.localeCompare(right.label))
}

export function summarizeOpenCLIAdapterPlugins(
  plugins: OpenCLIAdapterPlugin[],
): OpenCLIAdapterRegistrySummary {
  return plugins.reduce<OpenCLIAdapterRegistrySummary>(
    (summary, plugin) => ({
      adapterCount: summary.adapterCount + 1,
      commandCount: summary.commandCount + plugin.commandCount,
      parameterReadyCount: summary.parameterReadyCount + plugin.parameterReadyCount,
      configurationRequiredCount:
        summary.configurationRequiredCount + plugin.configurationRequiredCount,
    }),
    {
      adapterCount: 0,
      commandCount: 0,
      parameterReadyCount: 0,
      configurationRequiredCount: 0,
    },
  )
}
