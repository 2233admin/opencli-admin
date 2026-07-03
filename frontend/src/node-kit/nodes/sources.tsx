// Source atoms — one per real backend collection channel (backend/channels/*).
// Config fields mirror each channel's config.get(...) so a node = that channel.
//
// C0 (Control Room v0, docs/CONTROL_THEORY_ARCHITECTURE.md §0): every source
// node polls GET /sources/{id}/control-state (TanStack Query, refetchInterval
// — no websocket in v0) and renders ControlBadge + SensorCoverageBadge on top
// of its config body, so a source with incomplete sensors can never look like
// a plain green "healthy" node. The polling body only activates once the host
// stamps `config.__entityId` with a real source id (the same convention
// collection.tsx's `entityId()` helper uses) — a freshly-dropped, unconfigured
// palette node has no id yet and simply shows no control facts.
import { defineNode } from '../define'
import { SourceControlStrip } from '../render/controlState'
import type { NodeRenderContext, NodeSpec } from '../spec'

/** Shared render body: config fields (same as AutoBody would draw) + the C0
 *  control-state strip (SourceControlStrip — shared with collection.source so
 *  the "never a fake healthy" guarantee lives in exactly one place). */
function SourceBody(ctx: NodeRenderContext) {
  const sourceId = String(ctx.config.__entityId ?? '')
  const fields = ctx.spec.config?.fields ?? []

  return (
    <div className="grid gap-1.5">
      {fields.map((f) => (
        <div key={f.key} className="flex items-center justify-between gap-2 border border-white/6 bg-white/2.5 px-2 py-1 text-2xs">
          <span className="shrink-0 text-zinc-600">{f.label ?? f.key}</span>
          <span className="truncate font-medium text-zinc-300">
            {formatConfigValue(ctx.config[f.key])}
          </span>
        </div>
      ))}
      <SourceControlStrip sourceId={sourceId} />
    </div>
  )
}

function formatConfigValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const webScraper = defineNode({
  type: 'source.web_scraper',
  category: 'source',
  title: '网页抓取',
  subtitle: 'web_scraper',
  icon: 'globe',
  ports: { inputs: [], outputs: [{ id: 'out', label: '记录' }] },
  config: {
    fields: [
      { key: 'url', type: 'string', label: 'URL', required: true, placeholder: 'https://…' },
      { key: 'list_selector', type: 'string', label: '列表选择器', placeholder: '.item' },
      { key: 'selectors', type: 'json', label: '字段选择器', placeholder: '{"title":".t"}' },
      { key: 'headers', type: 'json', label: '请求头' },
      { key: 'timeout', type: 'number', label: '超时(s)', default: 30 },
    ],
  },
  render: SourceBody,
})

const rss = defineNode({
  type: 'source.rss',
  category: 'source',
  title: 'RSS 源',
  subtitle: 'rss',
  icon: 'rss',
  ports: { inputs: [], outputs: [{ id: 'out', label: '条目' }] },
  config: {
    fields: [
      { key: 'feed_url', type: 'string', label: 'Feed URL', required: true, placeholder: 'https://…/feed.xml' },
      { key: 'max_entries', type: 'number', label: '最多条数', default: 20 },
      { key: 'timeout', type: 'number', label: '超时(s)', default: 30 },
    ],
  },
  render: SourceBody,
})

const api = defineNode({
  type: 'source.api',
  category: 'source',
  title: 'API 拉取',
  subtitle: 'api',
  icon: 'webhook',
  ports: { inputs: [], outputs: [{ id: 'out', label: '响应' }] },
  config: {
    fields: [
      { key: 'base_url', type: 'string', label: 'Base URL', required: true },
      { key: 'endpoint', type: 'string', label: 'Endpoint', placeholder: '/v1/data' },
      { key: 'method', type: 'select', label: '方法', default: 'GET', options: [
        { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }, { value: 'DELETE', label: 'DELETE' },
      ] },
      { key: 'auth', type: 'json', label: '鉴权' },
      { key: 'params', type: 'json', label: 'Query 参数' },
      { key: 'body', type: 'json', label: 'Body' },
      { key: 'headers', type: 'json', label: '请求头' },
      { key: 'result_path', type: 'string', label: '结果路径', placeholder: 'data.items' },
      { key: 'timeout', type: 'number', label: '超时(s)', default: 30 },
    ],
  },
  render: SourceBody,
})

const cli = defineNode({
  type: 'source.cli',
  category: 'source',
  title: 'CLI 命令',
  subtitle: 'cli',
  icon: 'terminal',
  ports: { inputs: [], outputs: [{ id: 'out', label: '输出' }] },
  config: {
    fields: [
      { key: 'binary', type: 'string', label: '二进制', required: true, placeholder: 'tdx-cli' },
      { key: 'command', type: 'string', label: '命令' },
      { key: 'output_format', type: 'select', label: '输出格式', default: 'json', options: [
        { value: 'json', label: 'json' }, { value: 'text', label: 'text' }, { value: 'csv', label: 'csv' },
      ] },
      { key: 'env', type: 'json', label: '环境变量' },
      { key: 'defaults', type: 'json', label: '默认参数' },
      { key: 'timeout', type: 'number', label: '超时(s)', default: 60 },
    ],
  },
  render: SourceBody,
})

const opencli = defineNode({
  type: 'source.opencli',
  category: 'source',
  title: 'opencli 采集',
  subtitle: 'opencli',
  icon: 'package',
  ports: { inputs: [], outputs: [{ id: 'out', label: '记录' }] },
  config: {
    fields: [
      { key: 'site', type: 'string', label: '站点', required: true },
      { key: 'command', type: 'string', label: '命令' },
      { key: 'format', type: 'string', label: '格式', default: 'json' },
      { key: 'args', type: 'json', label: '参数' },
      { key: 'positional_args', type: 'json', label: '位置参数' },
    ],
  },
  render: SourceBody,
})

export const SOURCE_NODES: NodeSpec<any>[] = [webScraper, rss, api, cli, opencli]
