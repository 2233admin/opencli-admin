import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  listNotificationRules,
  createNotificationRule,
  deleteNotificationRule,
  listNotificationLogs,
} from '../api/endpoints'
import type { NotificationRule, NotificationLog } from '../api/types'
import { PageLoader } from '../components/LoadingSpinner'
import ErrorAlert from '../components/ErrorAlert'
import Card from '../components/Card'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import TruncatedText from '../components/TruncatedText'
import NotifierConfigForm, { type NotifierType } from '../components/NotifierConfigForm'
import {
  formatJsonPreview,
  getAckStatusTone,
  summarizeNotificationResponse,
  type AckStatusTone,
} from '../lib/notificationDisplay'
import { Plus, Trash2 } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button } from '../components/ui/button'

const NOTIFIER_TYPES: NotifierType[] = ['webhook', 'dingtalk', 'feishu', 'wecom', 'email']
const TRIGGER_EVENTS = ['on_new_record', 'on_ai_processed', 'on_task_failed'] as const
type TriggerEvent = typeof TRIGGER_EVENTS[number]

const DEFAULT_CONFIGS: Record<NotifierType, Record<string, unknown>> = {
  webhook: { url: '', secret: '', ack_secret: '' },
  dingtalk: { webhook_url: '' },
  feishu: { webhook_url: '' },
  wecom: { webhook_url: '' },
  email: { smtp_host: '', smtp_port: 587, to: [] },
}

const ACK_TONE_RING: Record<AckStatusTone, string> = {
  success: 'ring-1 ring-emerald-500/40',
  warning: 'ring-1 ring-amber-500/40',
  danger: 'ring-1 ring-red-500/40',
  muted: 'ring-1 ring-white/10',
}

function formatTime(value?: string) {
  if (!value) return '—'
  return formatInTimeZone(new Date(value), 'Asia/Shanghai', 'MM-dd HH:mm:ss')
}

function AddRuleModal({ onClose, onSave }: { onClose: () => void; onSave: (d: Partial<NotificationRule>) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [triggerEvent, setTriggerEvent] = useState('on_new_record')
  const [notifierType, setNotifierType] = useState<NotifierType>('webhook')
  const [notifierConfig, setNotifierConfig] = useState<Record<string, unknown>>(DEFAULT_CONFIGS.webhook)

  const inputCls = 'w-full border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-primary-500/70'
  const labelCls = 'block text-sm font-medium text-zinc-300 mb-1'

  const handleTypeChange = (type: NotifierType) => {
    setNotifierType(type)
    setNotifierConfig(DEFAULT_CONFIGS[type])
  }

  const handleSubmit = () => {
    if (!name.trim()) return
    onSave({ name: name.trim(), trigger_event: triggerEvent, notifier_type: notifierType, notifier_config: notifierConfig, enabled: true })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="telemetry-panel w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-zinc-100">{t('notifications.addRuleTitle')}</h2>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>{t('common.name')}<span className="text-red-500 ml-0.5">*</span></label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{t('notifications.triggerEvent')}</label>
            <select className={inputCls} value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}>
              {TRIGGER_EVENTS.map((e) => <option key={e} value={e}>{t(`notifications.events.${e}`)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>{t('notifications.notifierType')}</label>
            <select className={inputCls} value={notifierType} onChange={(e) => handleTypeChange(e.target.value as NotifierType)}>
              {NOTIFIER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>

          <div className="border-t border-white/8 pt-4">
            <p className="text-xs text-zinc-400 mb-3 uppercase tracking-wide font-medium">
              {t('notifications.notifierConfig')}
            </p>
            <NotifierConfigForm
              notifierType={notifierType}
              config={notifierConfig}
              onChange={setNotifierConfig}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!name.trim()}>
            {t('common.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'rules' | 'logs'>('rules')
  const [showAdd, setShowAdd] = useState(false)
  const qc = useQueryClient()

  const rulesQ = useQuery({ queryKey: ['notification-rules'], queryFn: listNotificationRules })
  const logsQ = useQuery({ queryKey: ['notification-logs'], queryFn: () => listNotificationLogs() })

  const createMut = useMutation({
    mutationFn: createNotificationRule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notification-rules'] }); setShowAdd(false); toast.success('通知规则已保存') },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteNotificationRule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notification-rules'] }); toast.success('已删除') },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  })

  const rules: NotificationRule[] = rulesQ.data?.data ?? []
  const logs: NotificationLog[] = logsQ.data?.data ?? []

  return (
    <div>
      <PageHeader
        title={t('notifications.title')}
        description={t('notifications.description')}
        action={
          tab === 'rules' && (
            <Button type="button" onClick={() => setShowAdd(true)}>
              <Plus size={16} /> {t('notifications.addRule')}
            </Button>
          )
        }
      />

      <div className="flex gap-2 mb-4">
        {(['rules', 'logs'] as const).map((tabKey) => (
          <button key={tabKey} onClick={() => setTab(tabKey)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === tabKey ? 'bg-primary-500/16 border border-primary-500/70 text-white' : 'bg-black/20 border border-white/8 text-zinc-300 hover:bg-white/4'
            }`}>
            {tabKey === 'rules' ? t('notifications.tabRules') : t('notifications.tabLogs')}
          </button>
        ))}
      </div>

      {tab === 'rules' && (
        rulesQ.isLoading ? <PageLoader /> :
        rulesQ.error ? <ErrorAlert error={rulesQ.error as Error} /> :
        <Card padding={false}>
          <DataTable
            data={rules}
            keyFn={(r) => r.id}
            emptyMessage={t('notifications.noRules')}
            columns={[
              { key: 'name', header: t('common.name'), render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'event', header: t('notifications.triggerEvent'), render: (r) => <span className="text-xs">{t(`notifications.events.${r.trigger_event as TriggerEvent}`, { defaultValue: r.trigger_event })}</span> },
              { key: 'type', header: t('notifications.notifierType'), render: (r) => <span className="text-xs">{r.notifier_type}</span> },
              { key: 'enabled', header: t('common.status'), render: (r) => <StatusBadge status={r.enabled ? 'online' : 'offline'} /> },
              {
                key: 'id', header: t('common.id'), width: '100px',
                render: (r) => <span className="font-mono text-xs text-zinc-500">{r.id.slice(0, 8)}</span>,
              },
              {
                key: 'created_at', header: t('common.createdAt'), width: '130px',
                render: (r) => <span className="text-xs text-zinc-400">{formatInTimeZone(new Date(r.created_at), 'Asia/Shanghai', 'MM-dd HH:mm:ss')}</span>,
              },
              {
                key: 'updated_at', header: t('common.updatedAt'), width: '130px',
                render: (r) => <span className="text-xs text-zinc-400">{formatInTimeZone(new Date(r.updated_at), 'Asia/Shanghai', 'MM-dd HH:mm:ss')}</span>,
              },
              {
                key: 'actions', header: t('common.actions'), width: '70px',
                render: (r) => (
                  <button onClick={() => { if (confirm(t('notifications.confirmDelete', { name: r.name }))) deleteMut.mutate(r.id) }}
                    className="p-1.5 rounded-sm hover:bg-red-100 text-red-500">
                    <Trash2 size={14} />
                  </button>
                ),
              },
            ]}
          />
        </Card>
      )}

      {tab === 'logs' && (
        logsQ.isLoading ? <PageLoader /> :
        logsQ.error ? <ErrorAlert error={logsQ.error as Error} /> :
        <Card padding={false}>
          <DataTable
            data={logs}
            keyFn={(l) => l.id}
            emptyMessage={t('notifications.noLogs')}
            columns={[
              {
                key: 'id', header: t('common.id'), width: '100px',
                render: (l) => <span className="font-mono text-xs text-zinc-500">{l.id.slice(0, 8)}</span>,
              },
              {
                key: 'record_id', header: t('notifications.recordId'), width: '100px',
                render: (l) => <span className="font-mono text-xs text-zinc-400">{l.record_id ? l.record_id.slice(0, 8) : '—'}</span>,
              },
              { key: 'rule', header: t('notifications.ruleId'), width: '110px', render: (l) => <span className="font-mono text-xs">{l.rule_id.slice(0, 10)}…</span> },
              { key: 'status', header: t('notifications.deliveryStatus'), width: '96px', render: (l) => <StatusBadge status={l.status} /> },
              {
                key: 'ack_status', header: t('notifications.ackStatus'), width: '104px',
                render: (l) => {
                  const ackStatus = l.ack_status || 'not_required'
                  return <StatusBadge status={ackStatus} className={ACK_TONE_RING[getAckStatusTone(ackStatus)]} />
                },
              },
              {
                key: 'response', header: t('notifications.response'),
                render: (l) => (
                  <TruncatedText
                    text={summarizeNotificationResponse(l.response_data)}
                    lines={2}
                    className="text-xs text-zinc-400"
                  />
                ),
              },
              {
                key: 'ack_data', header: t('notifications.ackDetail'),
                render: (l) => (
                  <TruncatedText
                    text={formatJsonPreview(l.ack_data)}
                    lines={2}
                    className="font-mono text-xs text-zinc-400"
                  />
                ),
              },
              { key: 'error', header: t('notifications.errorMsg'), render: (l) => <span className="text-xs text-red-400">{l.error_message || '—'}</span> },
              {
                key: 'acked_at', header: t('notifications.ackedAt'), width: '130px',
                render: (l) => <span className="text-xs text-zinc-400">{formatTime(l.acked_at)}</span>,
              },
              {
                key: 'created_at', header: t('common.createdAt'), width: '130px',
                render: (l) => <span className="text-xs text-zinc-400">{formatTime(l.created_at)}</span>,
              },
            ]}
          />
        </Card>
      )}

      {showAdd && <AddRuleModal onClose={() => setShowAdd(false)} onSave={(d) => createMut.mutate(d)} />}
    </div>
  )
}
