// Source atoms — one per real backend collection channel (backend/channels/*).
// Config fields mirror each channel's config.get(...) so a node = that channel.
import { defineNode } from '../define'
import type { NodeSpec } from '../spec'

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
})

export const SOURCE_NODES: NodeSpec<any>[] = [webScraper, rss, api, cli, opencli]
