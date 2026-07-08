import type { GeneratedWorkflowSpec } from "./types"

/**
 * 规则式工作流生成回退。
 * 当 AI Gateway 不可用（例如未配置额度）时，根据关键字启发式地
 * 构造一个合理的工作流，保证「AI 生成」功能始终可用。
 */
export function generateWorkflowLocally(prompt: string): GeneratedWorkflowSpec {
  const text = prompt.toLowerCase()
  const nodes: GeneratedWorkflowSpec["nodes"] = []
  const edges: GeneratedWorkflowSpec["edges"] = []
  let counter = 0
  const nextId = () => `n${++counter}`

  const push = (
    type: string,
    label: string,
    description: string,
    config?: string,
  ): string => {
    const id = nextId()
    nodes.push({ id, type, label, description, config })
    return id
  }

  // 1) 触发器 —— 从关键字推断触发方式
  let triggerLabel = "开始触发"
  let triggerConfig = "manual"
  if (/(注册|signup|sign up|register)/.test(text)) {
    triggerLabel = "用户注册"
    triggerConfig = "user.registered"
  } else if (/(下单|订单|order|purchase|支付|付款)/.test(text)) {
    triggerLabel = "订单创建"
    triggerConfig = "order.created"
  } else if (/(定时|每天|每日|每周|cron|schedule|rss)/.test(text)) {
    triggerLabel = "定时触发"
    triggerConfig = "cron: 0 9 * * *"
  } else if (/(工单|客服|ticket|support|表单|form)/.test(text)) {
    triggerLabel = "收到工单"
    triggerConfig = "ticket.created"
  } else if (/(webhook|回调|事件)/.test(text)) {
    triggerLabel = "Webhook 触发"
    triggerConfig = "webhook.received"
  }
  let prev = push("trigger", triggerLabel, "工作流的起点", triggerConfig)

  // 2) 抓取 / 调用外部数据
  if (/(rss|抓取|api|接口|拉取|fetch|请求|http)/.test(text)) {
    const id = push("http", "获取数据", "调用外部接口获取数据", "GET /api/data")
    edges.push({ source: prev, target: id })
    prev = id
  }

  // 3) 数据处理 / AI 摘要
  if (/(摘要|总结|ai|处理|转换|清洗|summar|transform)/.test(text)) {
    const id = push("transform", "数据处理", "对数据进行处理或 AI 摘要", "transform(data)")
    edges.push({ source: prev, target: id })
    prev = id
  }

  // 4) 校验 / 判断分支
  if (/(校验|检查|库存|判断|优先级|条件|如果|是否|valid|check|priority|if)/.test(text)) {
    const cond = /(库存|stock|inventory)/.test(text)
      ? "stock >= quantity"
      : /(优先级|priority)/.test(text)
        ? "priority === 'high'"
        : "condition === true"
    const condId = push("condition", "条件判断", "根据条件走向不同分支", cond)
    edges.push({ source: prev, target: condId })

    // 是 分支
    const yesLabel = /(库存|stock)/.test(text)
      ? "扣减库存"
      : /(优先级|priority)/.test(text)
        ? "转人工处理"
        : "执行主流程"
    const yes = push("action", yesLabel, "满足条件时执行", "run()")
    edges.push({ source: condId, target: yes, label: "是" })

    // 通知
    const notifyLabel = /(发货|仓库|ship)/.test(text)
      ? "通知仓库发货"
      : /(slack|频道|推送)/.test(text)
        ? "推送到 Slack"
        : "发送通知"
    const notify = push("action", notifyLabel, "完成后发送通知", "notify()")
    edges.push({ source: yes, target: notify })

    // 否 分支
    const noLabel = /(退款|refund)/.test(text)
      ? "退款处理"
      : /(激活|提醒|remind)/.test(text)
        ? "稍后再次提醒"
        : "记录并跳过"
    const no = push("action", noLabel, "不满足条件时执行", "handle()")
    edges.push({ source: condId, target: no, label: "否" })
    return { title: prompt.slice(0, 20) || "自动化工作流", nodes, edges }
  }

  // 5) 延时
  if (/(小时|分钟|天后|延时|等待|稍后|delay|wait|hour|day)/.test(text)) {
    const id = push("delay", "延时等待", "暂停一段时间后继续", "24h")
    edges.push({ source: prev, target: id })
    prev = id
  }

  // 6) 邮件 / 通知动作
  const actionLabel = /(邮件|欢迎|email|mail)/.test(text)
    ? "发送邮件"
    : /(slack|频道|推送)/.test(text)
      ? "推送到 Slack"
      : /(发货|仓库)/.test(text)
        ? "通知发货"
        : "执行动作"
  const action = push("action", actionLabel, "工作流的主要动作", "sendEmail()")
  edges.push({ source: prev, target: action })

  return { title: prompt.slice(0, 20) || "自动化工作流", nodes, edges }
}
