import type { NodeCategory, WorkflowNodeData, WorkflowNodeType } from "@/lib/flow/types"
import type { WorkflowRuntimeCapability } from "./capabilities"
import type { WorkflowCapability, WorkflowNodeKind } from "./schema"

export type WorkflowPrimitiveCategory =
  | "input"
  | "transform"
  | "ai"
  | "logic"
  | "state"
  | "output"
  | "verify"
  | "business"
  | "ops"
  | "core"
  | "map"

export type WorkflowPrimitivePort = {
  id: string
  direction: "input" | "output"
  type: string
  description: string
}

export type WorkflowPrimitive = {
  id: string
  idPrefix: string
  label: string
  description: string
  category: WorkflowPrimitiveCategory
  nodeType: WorkflowNodeType
  nodeCategory: NodeCategory
  icon: string
  color: string
  ports: WorkflowPrimitivePort[]
  canonical: {
    kind: WorkflowNodeKind
    capability: WorkflowCapability
    inputPorts: WorkflowPrimitivePort[]
    outputPorts: WorkflowPrimitivePort[]
  }
  fields: Array<{ id: string; label: string; value: string }>
  keywords: string[]
}

export const WORKFLOW_PRIMITIVES: WorkflowPrimitive[] = [
  primitive("primitive.input.adapter-read", "adapter-read", "Adapter Read", "从 adapter 或 fixture 读入原始 payload", "input", "http", "data", "Globe", [
    out("payload", "payload", "Raw provider payload."),
  ], [{ id: "adapter", label: "adapter", value: "{{adapter.id}}" }], ["source", "adapter", "fetch", "fixture", "live", "读取"]),
  primitive("primitive.input.manual-sample", "sample", "Manual Sample", "提供手工样本，方便封包调试", "input", "trigger", "data", "Play", [
    out("sample", "items[]", "Sample items."),
  ], [{ id: "count", label: "count", value: "2" }], ["sample", "fixture", "debug", "样本"]),
  primitive("primitive.transform.parse-json", "parse", "Parse JSON", "解析 JSON/HTTP payload 为结构化对象", "transform", "transform", "data", "Code", [
    inPort("payload", "payload", "Raw payload."),
    out("object", "object", "Parsed object."),
  ], [{ id: "schema", label: "schema", value: "provider payload" }], ["parse", "json", "schema", "解析"]),
  primitive("primitive.transform.map-fields", "map", "Map Fields", "字段映射、重命名、补默认值", "transform", "transform", "data", "ArrowRightLeft", [
    inPort("object", "object", "Input object."),
    out("items", "items[]", "Mapped item list."),
  ], [{ id: "mapping", label: "mapping", value: "id,title,publishedAt" }], ["map", "fields", "normalize", "映射", "标准化"]),
  primitive("primitive.transform.filter-items", "filter", "Filter Items", "按表达式过滤集合元素", "transform", "transform", "data", "Filter", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Filtered items."),
  ], [{ id: "predicate", label: "predicate", value: "item.important || true" }], ["filter", "where", "predicate", "过滤"]),
  primitive("primitive.transform.limit-window", "limit", "Limit Window", "限制条数和时间窗口", "transform", "transform", "data", "Hourglass", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Windowed items."),
  ], [{ id: "limit", label: "limit", value: "20" }], ["limit", "window", "分页", "窗口"]),
  primitive("primitive.ai.prompt-template", "prompt", "Prompt Template", "把输入变量装配成 LLM prompt", "ai", "action", "action", "Sparkles", [
    inPort("items", "items[]", "Input items."),
    out("prompt", "prompt", "Prompt payload."),
  ], [{ id: "preset", label: "preset", value: "macro-brief" }], ["prompt", "llm", "template", "提示词"]),
  primitive("primitive.ai.prompt-version", "prompt-version", "Prompt Version", "保存 prompt 版本、备注和回滚锚点", "ai", "action", "action", "History", [
    inPort("prompt", "prompt", "Prompt payload."),
    out("version", "promptVersion", "Versioned prompt payload."),
  ], [{ id: "version", label: "version", value: "v1" }, { id: "note", label: "note", value: "baseline" }], ["prompt", "version", "rollback", "版本"]),
  primitive("primitive.ai.prompt-test-case", "prompt-case", "Prompt Test Case", "给 prompt 绑定测试输入和期望输出", "ai", "transform", "logic", "FlaskConical", [
    inPort("version", "promptVersion", "Versioned prompt."),
    out("case", "evalCase", "Prompt evaluation case."),
  ], [{ id: "input", label: "input", value: "macro news sample" }, { id: "expected", label: "expected", value: "brief with risk note" }], ["prompt", "test", "case", "测试"]),
  primitive("primitive.ai.model-call", "model", "Model Call", "调用或模拟一个模型推理步骤", "ai", "action", "action", "Sparkles", [
    inPort("prompt", "prompt", "Prompt payload."),
    out("result", "modelResult", "Model result."),
  ], [{ id: "model", label: "model", value: "deepseek" }], ["deepseek", "gpt", "claude", "model", "推理"]),
  primitive("primitive.ai.model-compare", "model-compare", "Model Compare", "并排比较多个模型或 mock 输出", "ai", "transform", "logic", "GitCompare", [
    inPort("prompt", "prompt", "Prompt payload."),
    out("comparison", "modelComparison", "Model comparison result."),
  ], [{ id: "models", label: "models", value: "deepseek,mock" }], ["model", "compare", "ab", "对比"]),
  primitive("primitive.ai.score-dimensions", "score", "Score Dimensions", "按多个维度计算 importance score", "ai", "transform", "logic", "Sigma", [
    inPort("items", "items[]", "Input items."),
    out("scored", "scoredItems[]", "Scored items."),
  ], [{ id: "dimensions", label: "dimensions", value: "market,policy,urgency" }], ["score", "rank", "importance", "打分"]),
  primitive("primitive.logic.condition", "condition", "Condition Gate", "计算布尔条件并输出 true/false 分支", "logic", "condition", "logic", "GitBranch", [
    inPort("items", "items[]", "Input items."),
    out("true", "items[]", "Matched items."),
    out("false", "items[]", "Unmatched items."),
  ], [{ id: "expr", label: "expr", value: "item.score >= 0.7" }], ["condition", "router", "threshold", "条件"]),
  primitive("primitive.logic.branch-label", "branch", "Branch Label", "把分支命名并绑定到下游端口", "logic", "condition", "logic", "Split", [
    inPort("items", "items[]", "Input branch items."),
    out("branch", "items[]", "Named branch items."),
  ], [{ id: "label", label: "label", value: "notify" }], ["branch", "port", "route", "分支"]),
  primitive("primitive.state.cache-window", "cache", "Cache Window", "给封包提供缓存/去重窗口", "state", "transform", "data", "Database", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Cached items."),
  ], [{ id: "ttl", label: "ttl", value: "24h" }], ["cache", "dedupe", "state", "缓存"]),
  primitive("primitive.state.inbox-write", "inbox-write", "Inbox Write", "写入人工复核队列", "state", "action", "data", "Inbox", [
    inPort("items", "items[]", "Review items."),
    out("stored", "storedItems[]", "Stored item refs."),
  ], [{ id: "queue", label: "queue", value: "macro-watch" }], ["inbox", "store", "archive", "保存"]),
  primitive("primitive.output.payload-format", "format", "Payload Format", "把 items 格式化成通知 payload", "output", "transform", "action", "Code", [
    inPort("items", "items[]", "Input items."),
    out("payload", "deliveryPayload", "Delivery payload."),
  ], [{ id: "template", label: "template", value: "brief" }], ["format", "payload", "template", "格式化"]),
  primitive("primitive.output.mock-send", "mock-send", "Mock Send", "模拟外部发送，保留 delivery 证据", "output", "action", "action", "Bell", [
    inPort("payload", "deliveryPayload", "Delivery payload."),
    out("delivery", "delivery", "Delivery result."),
  ], [{ id: "target", label: "target", value: "operator-preview" }], ["webhook", "notify", "mock", "send", "推送"]),
  primitive("primitive.verify.assert-schema", "assert-schema", "Assert Schema", "断言输出满足 schema/contract", "verify", "transform", "logic", "Circle", [
    inPort("value", "unknown", "Value under test."),
    out("pass", "assertion", "Assertion result."),
  ], [{ id: "assert", label: "assert", value: "matches contract" }], ["assert", "schema", "contract", "断言"]),
  primitive("primitive.verify.coverage-mark", "coverage", "Coverage Mark", "标记节点、事件或端口覆盖率", "verify", "transform", "logic", "Radio", [
    inPort("event", "traceEvent", "Observed event."),
    out("coverage", "coverage", "Coverage mark."),
  ], [{ id: "cover", label: "cover", value: "node/event/port" }], ["coverage", "waveform", "trace", "覆盖率"]),
  primitive("primitive.verify.trace-span", "trace-span", "Trace Span", "记录 prompt/model/tool 的 span 级观测信息", "verify", "transform", "logic", "Activity", [
    inPort("event", "traceEvent", "Observed event."),
    out("span", "traceSpan", "Span-level trace evidence."),
  ], [{ id: "spanType", label: "spanType", value: "model.call" }], ["trace", "span", "observability", "观测"]),
  primitive("primitive.verify.eval-dataset", "eval-dataset", "Eval Dataset", "声明评测数据集和 case 数", "verify", "transform", "data", "Database", [
    out("dataset", "evalDataset", "Evaluation dataset."),
  ], [{ id: "dataset", label: "dataset", value: "intelligence-fixture-regression" }], ["eval", "dataset", "评测", "数据集"]),
  primitive("primitive.verify.evaluator", "evaluator", "Evaluator", "执行 accuracy/relevance/compliance 等评测器", "verify", "transform", "logic", "BadgeCheck", [
    inPort("dataset", "evalDataset", "Evaluation dataset."),
    out("scores", "evalScores", "Evaluation scores."),
  ], [{ id: "metrics", label: "metrics", value: "accuracy,relevance,compliance,latency" }], ["evaluator", "judge", "score", "评测器"]),
  primitive("primitive.verify.experiment-run", "experiment", "Experiment Run", "记录一次 prompt/model 实验运行", "verify", "action", "logic", "Play", [
    inPort("scores", "evalScores", "Evaluation scores."),
    out("experiment", "experimentRun", "Experiment result."),
  ], [{ id: "variant", label: "variant", value: "baseline" }], ["experiment", "run", "ab", "实验"]),
  primitive("primitive.verify.scorecard", "scorecard", "Scorecard", "汇总评测分数和质量门禁", "verify", "transform", "logic", "Gauge", [
    inPort("experiment", "experimentRun", "Experiment result."),
    out("scorecard", "scorecard", "Quality scorecard."),
  ], [{ id: "threshold", label: "threshold", value: "0.85" }], ["scorecard", "quality", "评分卡"]),
  primitive("primitive.verify.regression-gate", "regression-gate", "Regression Gate", "检测 prompt/model 改动是否退化", "verify", "condition", "logic", "ShieldCheck", [
    inPort("scorecard", "scorecard", "Quality scorecard."),
    out("pass", "scorecard", "Accepted result."),
    out("fail", "scorecard", "Rejected result."),
  ], [{ id: "minOverall", label: "minOverall", value: "0.85" }], ["regression", "gate", "rollback", "回归"]),
  primitive("primitive.business.source-health", "source-health", "Source Health", "检查数据源延迟、空结果和错误率", "business", "transform", "data", "Radio", [
    inPort("payload", "payload", "Fetched provider payload."),
    out("health", "healthReport", "Source health report."),
  ], [{ id: "sla", label: "sla", value: "fresh<10m empty<3" }], ["source", "health", "latency", "empty", "数据源", "健康"]),
  primitive("primitive.business.freshness-gate", "freshness", "Freshness Gate", "按发布时间和抓取时间过滤过期情报", "business", "condition", "logic", "Clock", [
    inPort("items", "items[]", "Input items."),
    out("fresh", "items[]", "Fresh items."),
    out("stale", "items[]", "Stale items."),
  ], [{ id: "maxAge", label: "maxAge", value: "2h" }], ["fresh", "stale", "time", "过期", "时效"]),
  primitive("primitive.business.entity-extract", "entity", "Entity Extract", "提取公司、国家、品种、人物等实体", "business", "transform", "data", "Code", [
    inPort("items", "items[]", "Input items."),
    out("entities", "entities[]", "Extracted entities."),
  ], [{ id: "types", label: "types", value: "company,country,commodity,person" }], ["entity", "ner", "extract", "实体"]),
  primitive("primitive.business.topic-classify", "topic", "Topic Classify", "把情报归入宏观、外汇、商品、政策、风险主题", "business", "transform", "logic", "Filter", [
    inPort("items", "items[]", "Input items."),
    out("tagged", "items[]", "Tagged items."),
  ], [{ id: "taxonomy", label: "taxonomy", value: "macro,fx,commodity,policy,risk" }], ["topic", "tag", "taxonomy", "分类", "主题"]),
  primitive("primitive.business.sentiment-score", "sentiment", "Sentiment Score", "计算利多/利空/中性和置信度", "business", "transform", "logic", "Sigma", [
    inPort("items", "items[]", "Input items."),
    out("sentiment", "scoredItems[]", "Sentiment-scored items."),
  ], [{ id: "scale", label: "scale", value: "-1..1" }], ["sentiment", "bullish", "bearish", "情绪", "利多", "利空"]),
  primitive("primitive.business.impact-estimate", "impact", "Impact Estimate", "估计事件影响范围、市场关联和紧急度", "business", "transform", "logic", "Sigma", [
    inPort("items", "items[]", "Input items."),
    out("impact", "scoredItems[]", "Impact-scored items."),
  ], [{ id: "factors", label: "factors", value: "market,policy,urgency,scope" }], ["impact", "market", "urgency", "影响", "市场"]),
  primitive("primitive.business.evidence-pack", "evidence-pack", "Evidence Pack", "把来源、原文、摘要、评分组装成可审计证据包", "business", "transform", "data", "Database", [
    inPort("items", "items[]", "Input items."),
    out("evidence", "evidencePack[]", "Audit evidence packs."),
  ], [{ id: "include", label: "include", value: "source,raw,summary,score" }], ["evidence", "audit", "refs", "证据", "审计"]),
  primitive("primitive.business.digest-compose", "digest", "Digest Compose", "把多条情报整理成一条人工可读简报", "business", "action", "action", "Sparkles", [
    inPort("items", "items[]", "Input items."),
    out("digest", "summary[]", "Digest summaries."),
  ], [{ id: "format", label: "format", value: "3 bullets + risk note" }], ["digest", "brief", "summary", "简报"]),
  primitive("primitive.business.human-approval", "approval", "Human Approval", "需要人工确认后才允许进入发送或写入动作", "business", "condition", "logic", "GitBranch", [
    inPort("items", "items[]", "Input items."),
    out("approved", "items[]", "Approved items."),
    out("rejected", "items[]", "Rejected items."),
  ], [{ id: "role", label: "role", value: "operator" }], ["human", "approval", "review", "人工", "审核"]),
  primitive("primitive.business.delivery-rate-limit", "rate-limit", "Rate Limit", "控制通知频率，避免重复轰炸", "business", "transform", "action", "Hourglass", [
    inPort("payload", "deliveryPayload", "Delivery payload."),
    out("payload", "deliveryPayload", "Rate-limited payload."),
  ], [{ id: "limit", label: "limit", value: "3/hour/topic" }], ["rate", "limit", "notify", "频率", "限流"]),
  primitive("primitive.ops.trigger-manual", "manual-trigger", "Manual Trigger", "允许用户或 API 手动启动任务", "ops", "trigger", "logic", "Play", [
    out("event", "automationEvent", "Manual launch event."),
  ], [{ id: "enabled", label: "enabled", value: "true" }], ["manual", "trigger", "run", "api", "手动", "启动"]),
  primitive("primitive.ops.trigger-schedule", "schedule-trigger", "Schedule Trigger", "按 cron/日历规则触发任务", "ops", "trigger", "logic", "Clock", [
    out("event", "automationEvent", "Scheduled launch event."),
  ], [{ id: "cron", label: "cron", value: "*/5 * * * *" }, { id: "timezone", label: "timezone", value: "Asia/Shanghai" }], ["schedule", "cron", "calendar", "定时", "计划"]),
  primitive("primitive.ops.trigger-interval", "interval-trigger", "Interval Trigger", "按固定秒级间隔触发任务", "ops", "trigger", "logic", "Repeat", [
    out("event", "automationEvent", "Interval launch event."),
  ], [{ id: "duration", label: "duration", value: "300s" }], ["interval", "repeat", "cadence", "间隔", "周期"]),
  primitive("primitive.ops.trigger-single-shot", "single-shot", "Single Shot Trigger", "在指定时间点只触发一次", "ops", "trigger", "logic", "Clock", [
    out("event", "automationEvent", "One-time launch event."),
  ], [{ id: "epoch", label: "epoch", value: "{{timestamp}}" }], ["single", "once", "one-shot", "一次性"]),
  primitive("primitive.ops.trigger-webhook", "webhook-trigger", "Webhook Trigger", "通过带 token 的入站 webhook 启动任务", "ops", "http", "logic", "Globe", [
    out("request", "httpRequest", "Inbound webhook request."),
  ], [{ id: "token", label: "token", value: "{{secret.webhook_token}}" }], ["webhook", "magic link", "incoming", "入站"]),
  primitive("primitive.ops.trigger-startup", "startup-trigger", "Startup Trigger", "服务启动后触发初始化任务", "ops", "trigger", "logic", "Zap", [
    out("event", "automationEvent", "Startup launch event."),
  ], [{ id: "within", label: "within", value: "5m" }], ["startup", "boot", "init", "启动"]),
  primitive("primitive.ops.trigger-catch-up", "catch-up", "Catch-Up Cursor", "补跑暂停或停机期间错过的计划任务", "ops", "transform", "logic", "History", [
    inPort("event", "automationEvent", "Scheduled event."),
    out("events", "automationEvent[]", "Recovered launch events."),
  ], [{ id: "cursor", label: "cursor", value: "{{last_successful_tick}}" }], ["catchup", "cursor", "replay", "补跑", "游标"]),
  primitive("primitive.ops.trigger-range", "range-window", "Range Window", "只允许任务在指定时间窗内启动", "ops", "condition", "logic", "GitBranch", [
    inPort("event", "automationEvent", "Candidate event."),
    out("allowed", "automationEvent", "Allowed event."),
    out("blocked", "automationEvent", "Blocked event."),
  ], [{ id: "start", label: "start", value: "09:00" }, { id: "end", label: "end", value: "18:00" }], ["range", "window", "allow", "时间窗"]),
  primitive("primitive.ops.trigger-blackout", "blackout-window", "Blackout Window", "阻止维护窗口或假期期间的自动启动", "ops", "condition", "logic", "ShieldCheck", [
    inPort("event", "automationEvent", "Candidate event."),
    out("allowed", "automationEvent", "Allowed event."),
    out("blocked", "automationEvent", "Blackout-blocked event."),
  ], [{ id: "start", label: "start", value: "{{blackout.start}}" }, { id: "end", label: "end", value: "{{blackout.end}}" }], ["blackout", "holiday", "maintenance", "禁用窗口"]),
  primitive("primitive.ops.trigger-delay", "delay-start", "Delay Start", "给计划启动增加延迟", "ops", "transform", "logic", "Hourglass", [
    inPort("event", "automationEvent", "Launch event."),
    out("event", "automationEvent", "Delayed event."),
  ], [{ id: "duration", label: "duration", value: "30s" }], ["delay", "defer", "延迟"]),
  primitive("primitive.ops.trigger-precision", "precision-start", "Precision Start", "在分钟内按指定秒偏移启动", "ops", "transform", "logic", "Clock", [
    inPort("event", "automationEvent", "Scheduled event."),
    out("events", "automationEvent[]", "Second-precision events."),
  ], [{ id: "seconds", label: "seconds", value: "0,20,40" }], ["precision", "seconds", "sub-minute", "秒级"]),
  primitive("primitive.ops.limit-runtime", "limit-runtime", "Runtime Limit", "限制任务最大运行时间并产出超时证据", "ops", "condition", "logic", "Hourglass", [
    inPort("job", "automationJob", "Running job."),
    out("pass", "automationJob", "Job inside runtime limit."),
    out("exceeded", "limitFinding", "Runtime limit finding."),
  ], [{ id: "duration", label: "duration", value: "10m" }, { id: "abort", label: "abort", value: "true" }], ["runtime", "timeout", "limit", "超时"]),
  primitive("primitive.ops.limit-concurrency", "limit-concurrency", "Concurrency Limit", "限制同一事件或 workflow 的并发任务数", "ops", "condition", "logic", "GitMerge", [
    inPort("job", "automationJob", "Candidate job."),
    out("run", "automationJob", "Runnable job."),
    out("queued", "automationJob", "Queued job."),
  ], [{ id: "amount", label: "amount", value: "1" }], ["concurrency", "parallel", "queue", "并发"]),
  primitive("primitive.ops.limit-output-size", "limit-output", "Output Size Limit", "限制日志或输出字节数", "ops", "condition", "logic", "Gauge", [
    inPort("artifact", "runArtifact", "Run output artifact."),
    out("pass", "runArtifact", "Output inside limit."),
    out("exceeded", "limitFinding", "Output limit finding."),
  ], [{ id: "amount", label: "amount", value: "5mb" }], ["output", "log", "size", "日志", "大小"]),
  primitive("primitive.ops.limit-memory", "limit-memory", "Memory Limit", "检测持续超出内存阈值的任务", "ops", "condition", "logic", "Gauge", [
    inPort("metric", "metricSample", "Memory metric."),
    out("pass", "metricSample", "Memory inside limit."),
    out("exceeded", "limitFinding", "Memory limit finding."),
  ], [{ id: "amount", label: "amount", value: "512mb" }, { id: "duration", label: "duration", value: "60s" }], ["memory", "mem", "limit", "内存"]),
  primitive("primitive.ops.limit-cpu", "limit-cpu", "CPU Limit", "检测持续超出 CPU 阈值的任务", "ops", "condition", "logic", "Gauge", [
    inPort("metric", "metricSample", "CPU metric."),
    out("pass", "metricSample", "CPU inside limit."),
    out("exceeded", "limitFinding", "CPU limit finding."),
  ], [{ id: "amount", label: "amount", value: "200%" }, { id: "duration", label: "duration", value: "60s" }], ["cpu", "limit", "负载"]),
  primitive("primitive.ops.limit-retry", "retry-policy", "Retry Policy", "为失败任务配置最大重试次数和退避间隔", "ops", "transform", "logic", "Repeat", [
    inPort("failure", "jobFailure", "Failed job."),
    out("retry", "automationJob", "Retry job."),
    out("giveup", "jobFailure", "Final failure."),
  ], [{ id: "amount", label: "amount", value: "3" }, { id: "delay", label: "delay", value: "60s" }], ["retry", "backoff", "重试"]),
  primitive("primitive.ops.limit-queue", "queue-limit", "Queue Limit", "限制排队任务数量并决定是否拒绝", "ops", "condition", "logic", "GitBranch", [
    inPort("job", "automationJob", "Candidate job."),
    out("queued", "automationJob", "Accepted queued job."),
    out("rejected", "limitFinding", "Queue limit finding."),
  ], [{ id: "amount", label: "amount", value: "10" }], ["queue", "backpressure", "排队"]),
  primitive("primitive.ops.limit-file", "file-limit", "File Limit", "限制输入文件数量、大小和扩展名", "ops", "condition", "logic", "Filter", [
    inPort("files", "fileRef[]", "Input files."),
    out("accepted", "fileRef[]", "Accepted files."),
    out("rejected", "limitFinding", "File limit finding."),
  ], [{ id: "amount", label: "amount", value: "5" }, { id: "accept", label: "accept", value: ".json,.csv" }], ["file", "attachment", "limit", "文件"]),
  primitive("primitive.ops.limit-daily", "daily-limit", "Daily Limit", "限制每天某类结果或通知次数", "ops", "condition", "logic", "Calendar", [
    inPort("event", "automationEvent", "Candidate event."),
    out("allowed", "automationEvent", "Allowed event."),
    out("blocked", "limitFinding", "Daily limit finding."),
  ], [{ id: "condition", label: "condition", value: "complete" }, { id: "amount", label: "amount", value: "100" }], ["daily", "quota", "limit", "每日"]),
  primitive("primitive.ops.action-email", "email-action", "Email Action", "发送邮件通知并保留投递结果", "ops", "action", "action", "Mail", [
    inPort("payload", "deliveryPayload", "Email payload."),
    out("delivery", "delivery", "Email delivery result."),
  ], [{ id: "to", label: "to", value: "{{users.oncall}}" }], ["email", "mail", "notify", "邮件"]),
  primitive("primitive.ops.action-webhook", "webhook-action", "Webhook Action", "向外部系统发送 HTTP webhook", "ops", "http", "action", "Globe", [
    inPort("payload", "deliveryPayload", "Webhook payload."),
    out("response", "httpResponse", "Webhook response."),
  ], [{ id: "url", label: "url", value: "{{webhook.url}}" }], ["webhook", "http", "post", "通知"]),
  primitive("primitive.ops.action-run-event", "run-event-action", "Run Event Action", "从告警或节点结果启动另一个事件", "ops", "action", "action", "Play", [
    inPort("event", "automationEvent", "Source event."),
    out("job", "automationJob", "Launched job."),
  ], [{ id: "eventId", label: "eventId", value: "{{event.id}}" }], ["run event", "launch", "job", "启动事件"]),
  primitive("primitive.ops.action-channel", "channel-action", "Channel Action", "通过通知 channel 执行邮件、webhook 或 UI 通知", "ops", "action", "action", "MessageSquare", [
    inPort("payload", "deliveryPayload", "Channel payload."),
    out("delivery", "delivery", "Channel delivery result."),
  ], [{ id: "channelId", label: "channelId", value: "ops-primary" }], ["channel", "notify", "通知通道"]),
  primitive("primitive.ops.action-snapshot", "snapshot-action", "Snapshot Action", "采集服务器进程、负载和网络快照", "ops", "action", "data", "Database", [
    inPort("server", "serverRef", "Target server."),
    out("snapshot", "serverSnapshot", "Captured snapshot."),
  ], [{ id: "scope", label: "scope", value: "process,cpu,network" }], ["snapshot", "server", "process", "快照"]),
  primitive("primitive.ops.action-ticket", "ticket-action", "Ticket Action", "创建或更新 incident ticket", "ops", "action", "action", "MessageSquare", [
    inPort("finding", "limitFinding", "Finding or alert."),
    out("ticket", "ticketRef", "Incident ticket reference."),
  ], [{ id: "type", label: "type", value: "issue" }, { id: "assignees", label: "assignees", value: "oncall" }], ["ticket", "incident", "issue", "工单"]),
  primitive("primitive.ops.action-plugin", "plugin-action", "Plugin Action", "调用动作插件并记录插件输出", "ops", "action", "action", "Terminal", [
    inPort("payload", "object", "Plugin payload."),
    out("result", "pluginResult", "Plugin result."),
  ], [{ id: "pluginId", label: "pluginId", value: "{{plugin.id}}" }], ["plugin", "action", "插件"]),
  primitive("primitive.ops.action-suspend-job", "suspend-job", "Suspend Job", "暂停正在运行或排队的任务", "ops", "action", "action", "ShieldCheck", [
    inPort("job", "automationJob", "Target job."),
    out("result", "jobControlResult", "Suspend result."),
  ], [{ id: "reason", label: "reason", value: "operator request" }], ["suspend", "pause", "job", "暂停"]),
  primitive("primitive.ops.action-disable-event", "disable-event", "Disable Event", "禁用触发源或事件定义", "ops", "action", "action", "ShieldCheck", [
    inPort("event", "automationEvent", "Target event."),
    out("result", "eventControlResult", "Disable result."),
  ], [{ id: "reason", label: "reason", value: "safety gate" }], ["disable", "event", "kill switch", "禁用"]),
  primitive("primitive.ops.action-bucket-store", "bucket-store", "Bucket Store", "把运行数据或文件写入 bucket", "ops", "action", "data", "Database", [
    inPort("artifact", "runArtifact", "Data or files to store."),
    out("bucketRef", "bucketRef", "Stored bucket reference."),
  ], [{ id: "bucketId", label: "bucketId", value: "automation-artifacts" }, { id: "sync", label: "sync", value: "data_and_files" }], ["bucket", "store", "artifact", "存储"]),
  primitive("primitive.ops.action-bucket-fetch", "bucket-fetch", "Bucket Fetch", "从 bucket 读取运行数据或文件", "ops", "action", "data", "Database", [
    inPort("bucketRef", "bucketRef", "Bucket reference."),
    out("artifact", "runArtifact", "Fetched data or files."),
  ], [{ id: "bucketId", label: "bucketId", value: "automation-artifacts" }, { id: "glob", label: "glob", value: "*.json" }], ["bucket", "fetch", "artifact", "读取"]),
  primitive("primitive.ops.action-apply-tags", "apply-tags", "Apply Tags", "给任务、告警或工单打标签", "ops", "transform", "data", "Filter", [
    inPort("value", "object", "Object to tag."),
    out("value", "object", "Tagged object."),
  ], [{ id: "tags", label: "tags", value: "urgent,review" }], ["tag", "label", "metadata", "标签"]),
  primitive("primitive.ops.monitor-metric-expression", "metric-expression", "Metric Expression", "从实时监控数据中提取数值指标", "ops", "transform", "data", "Activity", [
    inPort("serverData", "serverMonitorData", "Server monitor data."),
    out("metric", "metricSample", "Numeric metric sample."),
  ], [{ id: "expr", label: "expr", value: "cpu.avgLoad" }, { id: "type", label: "type", value: "float" }], ["monitor", "metric", "expression", "指标"]),
  primitive("primitive.ops.monitor-data-match", "data-match", "Data Match", "用正则从文本监控输出中抽取数值", "ops", "transform", "data", "Filter", [
    inPort("text", "text", "Raw command output."),
    out("metric", "metricSample", "Extracted metric sample."),
  ], [{ id: "pattern", label: "pattern", value: "(\\d+(?:\\.\\d+)?)" }], ["regex", "data match", "extract", "正则"]),
  primitive("primitive.ops.monitor-delta", "delta-monitor", "Delta Monitor", "计算指标变化率或差分", "ops", "transform", "data", "Sigma", [
    inPort("metric", "metricSample", "Current metric sample."),
    out("delta", "metricSample", "Delta metric sample."),
  ], [{ id: "window", label: "window", value: "5m" }], ["delta", "rate", "monitor", "差分"]),
  primitive("primitive.ops.monitor-quick", "quick-monitor", "Quick Monitor", "秒级轻量监控采样，用于短期趋势", "ops", "transform", "data", "Activity", [
    out("metric", "metricSample", "Quick monitor sample."),
  ], [{ id: "interval", label: "interval", value: "1s" }, { id: "budget", label: "budget", value: "50ms" }], ["quickmon", "quick", "monitor", "秒级"]),
  primitive("primitive.ops.plugin-shell", "shell-plugin", "Shell Plugin", "以受控插件形式执行 shell 脚本", "ops", "action", "action", "Terminal", [
    inPort("stdin", "object", "Plugin input."),
    out("result", "pluginResult", "Shell plugin result."),
  ], [{ id: "script", label: "script", value: "#!/bin/bash\\necho ok" }], ["shell", "script", "bash", "powershell", "脚本"]),
  primitive("primitive.ops.plugin-http-request", "http-plugin", "HTTP Request Plugin", "发送 HTTP 请求并保留响应证据", "ops", "http", "action", "Globe", [
    inPort("request", "httpRequest", "HTTP request."),
    out("response", "httpResponse", "HTTP response."),
  ], [{ id: "method", label: "method", value: "POST" }, { id: "url", label: "url", value: "{{url}}" }], ["http", "request", "api", "请求"]),
  primitive("primitive.ops.plugin-docker", "docker-plugin", "Docker Plugin", "在容器边界内运行脚本或工具", "ops", "action", "action", "Terminal", [
    inPort("stdin", "object", "Plugin input."),
    out("result", "pluginResult", "Docker plugin result."),
  ], [{ id: "image", label: "image", value: "alpine:latest" }], ["docker", "container", "sandbox", "容器"]),
  primitive("primitive.ops.plugin-test-fixture", "test-plugin", "Test Fixture Plugin", "产生样本数据或样本文件用于测试 workflow", "ops", "action", "data", "FlaskConical", [
    out("sample", "object", "Fixture sample."),
    out("files", "fileRef[]", "Fixture files."),
  ], [{ id: "mode", label: "mode", value: "data_and_files" }], ["test", "fixture", "sample", "测试"]),
  primitive("primitive.ops.secret-ref", "secret-ref", "Secret Ref", "声明运行时注入的 secret 引用而不暴露明文", "ops", "transform", "data", "ShieldCheck", [
    out("secret", "secretRef", "Secret reference."),
  ], [{ id: "name", label: "name", value: "WEBHOOK_TOKEN" }], ["secret", "vault", "token", "密钥"]),
  primitive("primitive.core.manual-trigger", "n8n-manual", "Manual Trigger", "手动启动一次 workflow 调试运行", "core", "trigger", "logic", "Play", [
    out("items", "items[]", "Manually triggered items."),
  ], [{ id: "mode", label: "mode", value: "test" }], ["n8n", "manual", "trigger", "execute", "手动"]),
  primitive("primitive.core.schedule-trigger", "n8n-schedule", "Schedule Trigger", "按 n8n 风格日程启动 workflow", "core", "trigger", "logic", "Clock", [
    out("items", "items[]", "Scheduled trigger items."),
  ], [{ id: "rule", label: "rule", value: "every 5 minutes" }], ["n8n", "schedule", "cron", "定时"]),
  primitive("primitive.core.webhook-trigger", "n8n-webhook", "Webhook Trigger", "接收入站 HTTP 请求并启动 workflow", "core", "http", "logic", "Globe", [
    out("body", "object", "Webhook body."),
    out("headers", "object", "Webhook headers."),
  ], [{ id: "method", label: "method", value: "POST" }, { id: "path", label: "path", value: "/hook" }], ["n8n", "webhook", "trigger", "http", "入站"]),
  primitive("primitive.core.error-trigger", "n8n-error", "Error Trigger", "在 workflow 失败时启动错误处理链路", "core", "trigger", "logic", "ShieldCheck", [
    out("error", "workflowError", "Workflow error event."),
  ], [{ id: "scope", label: "scope", value: "workflow" }], ["n8n", "error", "trigger", "错误"]),
  primitive("primitive.core.edit-fields", "edit-fields", "Edit Fields", "设置、重命名、保留或移除 item 字段", "core", "transform", "data", "ArrowRightLeft", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Edited items."),
  ], [{ id: "operation", label: "operation", value: "set/rename/keep/remove" }], ["n8n", "set", "edit fields", "rename", "字段"]),
  primitive("primitive.core.code", "code", "Code", "用 JavaScript/Python 风格脚本处理 items", "core", "transform", "data", "Code", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Code result items."),
  ], [{ id: "language", label: "language", value: "javascript" }], ["n8n", "code", "function", "script", "代码"]),
  primitive("primitive.core.http-request", "http-request", "HTTP Request", "发送 HTTP/API 请求并返回响应", "core", "http", "action", "Globe", [
    inPort("request", "httpRequest", "HTTP request."),
    out("response", "httpResponse", "HTTP response."),
  ], [{ id: "method", label: "method", value: "GET" }, { id: "url", label: "url", value: "{{url}}" }], ["n8n", "http", "request", "api", "请求"]),
  primitive("primitive.core.respond-webhook", "respond-webhook", "Respond to Webhook", "把 workflow 结果作为 webhook 响应返回", "core", "action", "action", "MessageSquare", [
    inPort("payload", "object", "Response payload."),
    out("response", "httpResponse", "Webhook response."),
  ], [{ id: "statusCode", label: "statusCode", value: "200" }], ["n8n", "respond", "webhook", "response", "响应"]),
  primitive("primitive.core.if", "if", "IF", "按条件把 items 分成 true/false 分支", "core", "condition", "logic", "GitBranch", [
    inPort("items", "items[]", "Input items."),
    out("true", "items[]", "Matched items."),
    out("false", "items[]", "Unmatched items."),
  ], [{ id: "condition", label: "condition", value: "={{ $json.enabled === true }}" }], ["n8n", "if", "condition", "条件"]),
  primitive("primitive.core.switch", "switch", "Switch", "按表达式把 items 路由到多个分支", "core", "condition", "logic", "Split", [
    inPort("items", "items[]", "Input items."),
    out("case", "items[]", "Matched case items."),
    out("fallback", "items[]", "Fallback items."),
  ], [{ id: "rules", label: "rules", value: "case list" }], ["n8n", "switch", "router", "case", "分支"]),
  primitive("primitive.core.merge", "merge", "Merge", "合并两个输入流，可 append/combine/wait", "core", "transform", "logic", "GitMerge", [
    inPort("input1", "items[]", "First item stream."),
    inPort("input2", "items[]", "Second item stream."),
    out("items", "items[]", "Merged items."),
  ], [{ id: "mode", label: "mode", value: "append" }], ["n8n", "merge", "join", "combine", "合并"]),
  primitive("primitive.core.loop-over-items", "loop-items", "Loop Over Items", "按 batch size 循环处理 items", "core", "condition", "logic", "Repeat", [
    inPort("items", "items[]", "Input items."),
    out("loop", "items[]", "Current batch."),
    out("done", "items[]", "All processed items."),
  ], [{ id: "batchSize", label: "batchSize", value: "1" }], ["n8n", "split in batches", "loop", "batch", "循环"]),
  primitive("primitive.core.wait", "wait", "Wait", "暂停执行直到时间、条件或 webhook 恢复", "core", "delay", "logic", "Hourglass", [
    inPort("items", "items[]", "Items before wait."),
    out("items", "items[]", "Resumed items."),
  ], [{ id: "resume", label: "resume", value: "time/webhook" }], ["n8n", "wait", "resume", "delay", "等待"]),
  primitive("primitive.core.execute-workflow", "execute-workflow", "Execute Workflow", "调用另一个 workflow 并传递输入 items", "core", "action", "action", "Play", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Sub-workflow result items."),
  ], [{ id: "workflowId", label: "workflowId", value: "{{workflow.id}}" }], ["n8n", "execute workflow", "subflow", "子工作流"]),
  primitive("primitive.core.stop-and-error", "stop-error", "Stop and Error", "主动终止 workflow 并产出错误证据", "core", "action", "logic", "ShieldCheck", [
    inPort("items", "items[]", "Input items."),
    out("error", "workflowError", "Stopped workflow error."),
  ], [{ id: "message", label: "message", value: "guard failed" }], ["n8n", "stop", "error", "throw", "终止"]),
  primitive("primitive.core.filter", "n8n-filter", "Filter", "保留满足条件的 items", "core", "transform", "data", "Filter", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Filtered items."),
  ], [{ id: "condition", label: "condition", value: "={{ $json.status === 'ready' }}" }], ["n8n", "filter", "where", "过滤"]),
  primitive("primitive.core.remove-duplicates", "deduplicate", "Remove Duplicates", "按字段或全部内容去重 items", "core", "transform", "data", "Filter", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Deduplicated items."),
  ], [{ id: "key", label: "key", value: "id" }], ["n8n", "remove duplicates", "dedupe", "去重"]),
  primitive("primitive.core.sort", "sort", "Sort", "按字段或表达式排序 items", "core", "transform", "data", "ArrowRightLeft", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Sorted items."),
  ], [{ id: "by", label: "by", value: "createdAt desc" }], ["n8n", "sort", "order", "排序"]),
  primitive("primitive.core.limit", "n8n-limit", "Limit", "限制通过的 item 数量", "core", "transform", "data", "Hourglass", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Limited items."),
  ], [{ id: "maxItems", label: "maxItems", value: "10" }], ["n8n", "limit", "take", "限制"]),
  primitive("primitive.core.aggregate", "aggregate", "Aggregate", "把多个 items 聚合成统计或数组", "core", "transform", "data", "Sigma", [
    inPort("items", "items[]", "Input items."),
    out("aggregate", "object", "Aggregated result."),
  ], [{ id: "operation", label: "operation", value: "groupBy/count/sum" }], ["n8n", "aggregate", "group by", "聚合"]),
  primitive("primitive.core.split-out", "split-out", "Split Out", "把数组字段拆成多条 items", "core", "transform", "data", "Split", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Split-out items."),
  ], [{ id: "field", label: "field", value: "items" }], ["n8n", "split out", "explode", "拆分"]),
  primitive("primitive.core.date-time", "date-time", "Date & Time", "格式化、偏移或解析日期时间字段", "core", "transform", "data", "Calendar", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Date-normalized items."),
  ], [{ id: "operation", label: "operation", value: "format/add/parse" }], ["n8n", "date", "time", "timezone", "日期"]),
  primitive("primitive.core.no-op", "no-op", "No Operation", "占位、连接或调试用的空操作节点", "core", "transform", "logic", "Circle", [
    inPort("items", "items[]", "Input items."),
    out("items", "items[]", "Unchanged items."),
  ], [{ id: "note", label: "note", value: "passthrough" }], ["n8n", "noop", "passthrough", "占位"]),
  primitive("primitive.map.source-anchor", "source-anchor", "Source Anchor", "给节点绑定可回跳的来源定位信息", "map", "transform", "data", "Link2", [
    inPort("items", "items[]", "Input items or turns."),
    out("anchored", "anchoredItems[]", "Items with source anchors."),
  ], [{ id: "anchor", label: "anchor", value: "url/messageId/selector" }], ["turnmap", "source", "anchor", "jump", "来源", "回跳"]),
  primitive("primitive.map.jump-back", "jump-back", "Jump Back", "从图节点跳回原始消息、网页或证据位置", "map", "action", "action", "Link2", [
    inPort("anchor", "sourceAnchor", "Source anchor."),
    out("result", "navigationResult", "Jump result."),
  ], [{ id: "behavior", label: "behavior", value: "focus+highlight" }], ["turnmap", "jump", "source", "定位", "高亮"]),
  primitive("primitive.map.mini-map", "mini-map", "Mini Map", "把一个长节点展开成内部小图", "map", "transform", "data", "Network", [
    inPort("node", "workflowNode", "Source node."),
    out("map", "miniMap", "Embedded mini map."),
  ], [{ id: "mode", label: "mode", value: "title-only" }], ["turnmap", "mini", "mind map", "subgraph", "小图"]),
  primitive("primitive.map.topic-collapse", "topic-collapse", "Topic Collapse", "把多个相关节点折叠成可恢复主题组", "map", "transform", "logic", "Group", [
    inPort("nodes", "workflowNode[]", "Selected nodes."),
    out("topic", "topicGroup", "Restorable topic group."),
  ], [{ id: "strategy", label: "strategy", value: "selected nodes" }], ["turnmap", "topic", "collapse", "group", "主题", "折叠"]),
  primitive("primitive.map.semantic-link", "semantic-link", "Semantic Link", "建立带类型、理由和置信度的语义连线", "map", "transform", "logic", "GitMerge", [
    inPort("source", "workflowNode", "Source node."),
    inPort("target", "workflowNode", "Target node."),
    out("edge", "semanticEdge", "Semantic relationship edge."),
  ], [{ id: "relationship", label: "relationship", value: "related/depends-on/evidence" }], ["turnmap", "semantic", "link", "relationship", "语义", "关系"]),
  primitive("primitive.map.link-weight", "link-weight", "Link Weight", "给关系连线设置权重、重要性和显示强度", "map", "transform", "logic", "Gauge", [
    inPort("edge", "semanticEdge", "Relationship edge."),
    out("edge", "semanticEdge", "Weighted relationship edge."),
  ], [{ id: "weight", label: "weight", value: "0.75" }], ["turnmap", "weight", "edge", "importance", "权重"]),
  primitive("primitive.map.knowledge-export", "knowledge-export", "Knowledge Export", "导出 Canvas、OPML、Markdown、SVG 或 PNG 知识图", "map", "action", "data", "FileCode2", [
    inPort("graph", "workflowGraph", "Workflow graph."),
    out("artifact", "exportArtifact", "Knowledge export artifact."),
  ], [{ id: "formats", label: "formats", value: "canvas,opml,markdown" }], ["turnmap", "export", "obsidian", "opml", "markdown", "导出"]),
]

export function getWorkflowPrimitives(query = ""): WorkflowPrimitive[] {
  const q = query.trim().toLowerCase()
  if (!q) return WORKFLOW_PRIMITIVES
  return WORKFLOW_PRIMITIVES.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.category.includes(q as WorkflowPrimitiveCategory) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(q)),
  )
}

export function getPrimitiveByStepCapability(capability: string): WorkflowPrimitive {
  const mapped = CAPABILITY_TO_PRIMITIVE_ID[capability]
  if (mapped) {
    return WORKFLOW_PRIMITIVES.find((item) => item.id === mapped) ?? WORKFLOW_PRIMITIVES[0]
  }
  return (
    WORKFLOW_PRIMITIVES.find((item) => item.keywords.includes(capability) || item.id.endsWith(`.${capability}`)) ??
    WORKFLOW_PRIMITIVES.find((item) => item.id === "primitive.verify.assert-schema")!
  )
}

const CAPABILITY_TO_PRIMITIVE_ID: Record<string, string> = {
  trigger: "primitive.core.manual-trigger",
  fetch: "primitive.input.adapter-read",
  parse: "primitive.transform.parse-json",
  resolve: "primitive.transform.map-fields",
  filter: "primitive.transform.filter-items",
  cache: "primitive.state.cache-window",
  guard: "primitive.verify.assert-schema",
  validate: "primitive.verify.assert-schema",
  prompt: "primitive.ai.prompt-template",
  version: "primitive.ai.prompt-version",
  experiment: "primitive.verify.experiment-run",
  evaluator: "primitive.verify.evaluator",
  model: "primitive.ai.model-call",
  budget: "primitive.transform.limit-window",
  schema: "primitive.verify.assert-schema",
  fallback: "primitive.logic.branch-label",
  evidence: "primitive.verify.coverage-mark",
  audit: "primitive.business.evidence-pack",
  score: "primitive.ai.score-dimensions",
  weight: "primitive.ai.score-dimensions",
  threshold: "primitive.logic.condition",
  calibrate: "primitive.verify.coverage-mark",
  explain: "primitive.ai.model-call",
  confidence: "primitive.verify.assert-schema",
  route: "primitive.logic.condition",
  branch: "primitive.logic.branch-label",
  preview: "primitive.verify.coverage-mark",
  format: "primitive.output.payload-format",
  target: "primitive.output.payload-format",
  send: "primitive.output.mock-send",
  retry: "primitive.verify.assert-schema",
  timeout: "primitive.ops.limit-runtime",
  concurrency: "primitive.ops.limit-concurrency",
  queue: "primitive.ops.limit-queue",
  ticket: "primitive.ops.action-ticket",
  snapshot: "primitive.ops.action-snapshot",
  webhook: "primitive.ops.action-webhook",
  monitor: "primitive.ops.monitor-metric-expression",
  secret: "primitive.ops.secret-ref",
  classify: "primitive.business.topic-classify",
  sentiment: "primitive.business.sentiment-score",
  impact: "primitive.business.impact-estimate",
  set: "primitive.core.edit-fields",
  edit: "primitive.core.edit-fields",
  code: "primitive.core.code",
  http: "primitive.core.http-request",
  if: "primitive.core.if",
  switch: "primitive.core.switch",
  merge: "primitive.core.merge",
  loop: "primitive.core.loop-over-items",
  wait: "primitive.core.wait",
  execute: "primitive.core.execute-workflow",
  aggregate: "primitive.core.aggregate",
  anchor: "primitive.map.source-anchor",
  topic: "primitive.map.topic-collapse",
  semantic: "primitive.map.semantic-link",
}

export function primitiveToNodeData(
  primitiveItem: WorkflowPrimitive,
  runtimeCapability?: WorkflowRuntimeCapability,
): WorkflowNodeData {
  return {
    label: primitiveItem.label,
    description: primitiveItem.description,
    nodeType: primitiveItem.nodeType,
    category: primitiveItem.nodeCategory,
    icon: primitiveItem.icon,
    color: primitiveItem.color,
    status: "idle",
    fields: primitiveItem.fields,
    primitiveId: primitiveItem.id,
    primitiveCategory: primitiveItem.category,
    primitivePorts: primitiveItem.ports,
    runtimeCapability: runtimeCapability ?? designOnlyPrimitiveCapability(primitiveItem),
    internalDraft: true,
    ...mapPrimitiveDefaults(primitiveItem.id),
  }
}

function designOnlyPrimitiveCapability(primitiveItem: WorkflowPrimitive): WorkflowRuntimeCapability {
  return {
    id: primitiveItem.id,
    label: primitiveItem.label,
    surface: "primitive",
    status: "design_only",
    backendAvailable: false,
    reason: "Primitive is visible as import/design vocabulary until a real executor binding exists.",
    missing: ["primitive_executor_binding"],
    tags: ["primitive", primitiveItem.category],
  }
}

function mapPrimitiveDefaults(id: string): Partial<WorkflowNodeData> {
  switch (id) {
    case "primitive.map.source-anchor":
      return {
        sourceAnchor: {
          kind: "artifact",
          label: "Latest run artifact",
          artifactPath: "runs/{{runId}}/artifact.json",
          runId: "{{runId}}",
        },
        runArtifact: {
          runId: "{{runId}}",
          artifactPath: "runs/{{runId}}/artifact.json",
        },
        proposalState: "draft",
      }
    case "primitive.map.jump-back":
      return {
        sourceAnchor: {
          kind: "selector",
          label: "Jump target",
          selector: "{{source.selector}}",
        },
      }
    case "primitive.map.mini-map":
      return {
        miniNetwork: {
          nodes: 3,
          edges: 2,
          mode: "contract",
        },
      }
    case "primitive.map.topic-collapse":
      return {
        topicCollapse: {
          groupId: "{{selected.topic}}",
          nodeCount: 0,
          mode: "draft",
          packageInternal: true,
        },
        internalDraft: true,
        internalsUnlocked: true,
      }
    case "primitive.map.semantic-link":
      return {
        semantic: {
          relationship: "evidence",
          reason: "proposal pending human accept",
          confidence: 0.72,
        },
        proposalState: "proposed",
      }
    case "primitive.map.link-weight":
      return {
        semantic: {
          relationship: "implements",
          reason: "edge weight participates in contract validation",
          confidence: 0.8,
        },
        weight: 0.75,
        contractId: "edge.contract.semantic-weight",
      }
    default:
      return {}
  }
}

function primitive(
  id: string,
  idPrefix: string,
  label: string,
  description: string,
  category: WorkflowPrimitiveCategory,
  nodeType: WorkflowNodeType,
  nodeCategory: NodeCategory,
  icon: string,
  ports: WorkflowPrimitivePort[],
  fields: Array<{ id: string; label: string; value: string }>,
  keywords: string[],
): WorkflowPrimitive {
  const contract = primitiveCanonicalContract(id, nodeType)
  return {
    id,
    idPrefix,
    label,
    description,
    category,
    nodeType,
    nodeCategory,
    icon,
    color: "var(--chart-2)",
    ports,
    canonical: {
      ...contract,
      inputPorts: ports.filter((port) => port.direction === "input"),
      outputPorts: ports.filter((port) => port.direction === "output"),
    },
    fields,
    keywords,
  }
}

function primitiveCanonicalContract(
  id: string,
  nodeType: WorkflowNodeType,
): Pick<WorkflowPrimitive["canonical"], "kind" | "capability"> {
  if (id.includes("merge")) return { kind: "flow", capability: "merge" }
  if (id.includes("inbox")) return { kind: "inbox", capability: "store" }
  if (id.includes("score") || id.includes("impact")) return { kind: "agent", capability: "score" }
  if (id.includes("prompt") || id.includes("model") || id.includes("digest")) {
    return { kind: "agent", capability: "summarize" }
  }

  switch (nodeType) {
    case "trigger":
      return { kind: "schedule", capability: "trigger" }
    case "condition":
      return { kind: "router", capability: "route" }
    case "delay":
      return { kind: "control", capability: "accept" }
    case "action":
    case "http":
      return { kind: "action", capability: "store" }
    default:
      return { kind: "agent", capability: "normalize" }
  }
}

function inPort(id: string, type: string, description: string): WorkflowPrimitivePort {
  return { id, direction: "input", type, description }
}

function out(id: string, type: string, description: string): WorkflowPrimitivePort {
  return { id, direction: "output", type, description }
}
