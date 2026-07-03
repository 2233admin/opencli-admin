import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import i18next from 'i18next'

import { listExecutableNodeActions } from './nodeActions.ts'
import { parseConversationToNodeRun } from './nodeRunService.ts'

describe('node run service', () => {
  it('parses source trigger command with agent and endpoint', async () => {
    const parsed = await parseConversationToNodeRun(
      'trigger source 12345678-abcd-4ef0-1234-abcdef123456 agent_id=agent-01 chrome_endpoint=http://chrome-1',
    )

    assert.equal(parsed.request.nodeKind, 'source')
    assert.equal(parsed.request.actionId, 'source.trigger')
    assert.equal(parsed.request.entityId, '12345678-abcd-4ef0-1234-abcdef123456')
    assert.deepEqual(parsed.request.payload, {
      agent_id: 'agent-01',
      parameters: {
        chrome_endpoint: 'http://chrome-1',
      },
    })
  })

  it('parses task rerun command', async () => {
    const parsed = await parseConversationToNodeRun('rerun task abcd1234-5678-4c9b-9012-abcdef123456')

    assert.equal(parsed.request.nodeKind, 'task')
    assert.equal(parsed.request.actionId, 'task.trigger')
    assert.equal(parsed.request.entityId, 'abcd1234-5678-4c9b-9012-abcdef123456')
    assert.equal(parsed.request.payload, undefined)
  })

  it('throws when command type is unsupported', async () => {
    await assert.rejects(
      () => parseConversationToNodeRun('open agent aabbccddeeffgghhiijj'),
      /暂未支持可执行动作/,
    )
  })

  it('rejects empty or unparsable command input', async () => {
    await assert.rejects(() => parseConversationToNodeRun(''))
    await assert.rejects(() => parseConversationToNodeRun('hello world'))
  })

  it('uses the current language for executable action labels', async () => {
    if (!i18next.isInitialized) {
      await i18next.init({
        resources: {
          zh: {
            translation: {
              nodeActions: {
                source: {
                  trigger: {
                    label: '触发采集',
                  },
                },
              },
            },
          },
          en: {
            translation: {
              nodeActions: {
                source: {
                  trigger: {
                    label: 'Run collection',
                  },
                },
              },
            },
          },
        },
        lng: 'zh',
        fallbackLng: 'zh',
        interpolation: { escapeValue: false },
      })
    }

    await i18next.changeLanguage('zh')
    assert.equal(listExecutableNodeActions('source')[0]?.label, '触发采集')

    await i18next.changeLanguage('en')
    assert.equal(listExecutableNodeActions('source')[0]?.label, 'Run collection')

    await i18next.changeLanguage('zh')
  })
})
