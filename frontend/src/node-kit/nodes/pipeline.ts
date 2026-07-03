// Pipeline-stage atoms — the collection pipeline as nodes (trigger → … → sink).
// Mirrors the real backend stages: schedule/manual trigger, store records,
// notification rule. Source/processor stages live in sources.ts / processors.ts.
import { defineNode } from '../define'
import type { NodeSpec } from '../spec'

const scheduleTrigger = defineNode({
  type: 'trigger.schedule',
  category: 'control',
  title: '定时触发',
  subtitle: 'cron',
  icon: 'clock',
  ports: { inputs: [], outputs: [{ id: 'out', label: '触发' }] },
  config: {
    fields: [
      { key: 'cron', type: 'string', label: 'Cron', required: true, placeholder: '0 */5 * * * *' },
      { key: 'enabled', type: 'boolean', label: '启用', default: true },
    ],
  },
})

const manualTrigger = defineNode({
  type: 'trigger.manual',
  category: 'control',
  title: '手动触发',
  subtitle: 'manual',
  icon: 'player-play',
  ports: { inputs: [], outputs: [{ id: 'out', label: '触发' }] },
})

const storeRecord = defineNode({
  type: 'sink.record',
  category: 'sink',
  title: '存记录',
  subtitle: 'record',
  icon: 'database',
  ports: { inputs: [{ id: 'in', label: '记录' }], outputs: [] },
  config: {
    fields: [
      { key: 'dedup_key', type: 'string', label: '去重字段', placeholder: 'id' },
    ],
  },
})

const notify = defineNode({
  type: 'sink.notify',
  category: 'sink',
  title: '通知',
  subtitle: 'notification',
  icon: 'bell',
  ports: { inputs: [{ id: 'in', label: '触发' }], outputs: [] },
  config: {
    fields: [
      { key: 'channel', type: 'select', label: '渠道', default: 'webhook', options: [
        { value: 'webhook', label: 'Webhook' }, { value: 'email', label: '邮件' }, { value: 'feishu', label: '飞书' }, { value: 'serverchan', label: 'Server酱' },
      ] },
      { key: 'template', type: 'string', label: '模板', placeholder: '{{title}}' },
    ],
  },
})

export const PIPELINE_NODES: NodeSpec<any>[] = [scheduleTrigger, manualTrigger, storeRecord, notify]
