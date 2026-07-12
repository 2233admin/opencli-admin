/**
 * OpenCLI 采集/发送管线 — 按组件库规范组装。
 *
 * 规则：
 * 1. 目录里有的节点一律用 WORKFLOW_NODE_CATALOG + createWorkflowNodeFromCatalog 实例化。
 * 2. 目录缺失的节点（RSS/HTTP 通用源、Telegram/邮件发送、Postgres 存档）
 *    从 n8n 节点库导出 JSON，经官方 translateN8nWorkflowToWorkflowProject 翻译引入，
 *    绝不手搓节点结构。
 * 3. 封装（package）条目注册在 node-catalog.ts，internals 锁定，模板驱动。
 */
import { WORKFLOW_NODE_CATALOG, createWorkflowNodeFromCatalog, type WorkflowNodeCatalogItem } from "./node-catalog"
import { translateN8nWorkflowToWorkflowProject } from "./n8n-translator"
import { parseWorkflowProject, workflowNodeSchema, type WorkflowProject, type WorkflowProjectEdge, type WorkflowProjectNode } from "./schema"
import n8nMissingNodes from "./n8n/collection-missing-nodes.json"

const COLUMN = { trigger: 60, source: 380, process: 700, decide: 1020, deliver: 1340 } as const
const ROW_GAP = 190
const TOP = 80

function catalogItem(id: string): WorkflowNodeCatalogItem {
  const item = WORKFLOW_NODE_CATALOG.find((entry) => entry.id === id)
  if (!item) throw new Error(`[collection-pipeline] catalog item missing: ${id}`)
  return item
}

function at(column: keyof typeof COLUMN, row: number): { x: number; y: number } {
  return { x: COLUMN[column], y: TOP + row * ROW_GAP }
}

/** 从 n8n 导出翻译缺失节点，返回节点与其 adapters。 */
function translateMissingNodes(): { nodes: WorkflowProjectNode[]; adapters: WorkflowProject["adapters"] } {
  const result = translateN8nWorkflowToWorkflowProject(n8nMissingNodes)
  if (!result.ok) throw new Error(`[collection-pipeline] n8n translation failed: ${result.error}`)
  const nodes = result.project.nodes.flatMap((node) =>
    node.internals?.nodes.map((internal) => workflowNodeSchema.parse(internal)) ?? [node],
  )
  return { nodes, adapters: result.project.adapters }
}

/** 把 n8n 翻译节点重新布点到我们管线的泳道。 */
function repositionN8nNode(node: WorkflowProjectNode, position: { x: number; y: number }): WorkflowProjectNode {
  return { ...node, ui: { ...node.ui, position } }
}

function edge(id: string, source: string, target: string, label?: string): WorkflowProjectEdge {
  return { id, source, target, label }
}

export function buildCollectionWorkflowProject(): WorkflowProject {
  // ── 目录节点（组件库自有）──────────────────────────────
  const collectionNeed = createWorkflowNodeFromCatalog(catalogItem("intelligence.input.collection-need"), "collection-need", at("trigger", 0))
  const schedule = createWorkflowNodeFromCatalog(catalogItem("intelligence.schedule.cron"), "schedule-cron", at("trigger", 1))
  const jin10 = createWorkflowNodeFromCatalog(catalogItem("intelligence.source.jin10"), "source-jin10", at("source", 0))
  const normalize = createWorkflowNodeFromCatalog(catalogItem("intelligence.processing.normalize"), "normalize-items", at("process", 0))
  const dedupe = createWorkflowNodeFromCatalog(catalogItem("intelligence.processing.dedupe"), "dedupe-items", at("process", 1))
  const summary = createWorkflowNodeFromCatalog(catalogItem("intelligence.agent.summary"), "llm-summary", at("process", 2))
  const score = createWorkflowNodeFromCatalog(catalogItem("intelligence.agent.score"), "importance-score", at("process", 3))
  const tag = createWorkflowNodeFromCatalog(catalogItem("intelligence.agent.tag"), "auto-tag", at("process", 4))
  const router = createWorkflowNodeFromCatalog(catalogItem("intelligence.router.importance"), "importance-router", at("decide", 2))
  const inbox = createWorkflowNodeFromCatalog(catalogItem("intelligence.output.inbox"), "inbox-review", at("decide", 4))
  const webhook = createWorkflowNodeFromCatalog(catalogItem("intelligence.output.webhook"), "webhook-notify", at("deliver", 0))
  const opencliHda = createWorkflowNodeFromCatalog(catalogItem("package.opencli.multi-source-hda"), "multi-source-opencli", at("source", 3))

  // ── n8n 引入节点（目录缺失，官方翻译器导入）──────────────
  const { nodes: n8nNodes, adapters: n8nAdapters } = translateMissingNodes()
  const byLabel = new Map(n8nNodes.map((node) => [node.ui?.label ?? node.id, node]))
  const pick = (label: string): WorkflowProjectNode => {
    const node = byLabel.get(label)
    if (!node) throw new Error(`[collection-pipeline] translated n8n node missing: ${label}`)
    return node
  }
  const rss = repositionN8nNode(pick("RSS Feed Read"), at("source", 1))
  const httpApi = repositionN8nNode(pick("HTTP API Source"), at("source", 2))
  const telegram = repositionN8nNode(pick("Telegram Send"), at("deliver", 1))
  const email = repositionN8nNode(pick("Email Send"), at("deliver", 2))
  const postgres = repositionN8nNode(pick("Postgres Archive"), at("deliver", 4))

  // ── 采集 → 处理 → 决策 → 发送 wiring ─────────────────────
  const edges: WorkflowProjectEdge[] = [
    edge("e-schedule-jin10", schedule.id, jin10.id),
    edge("e-schedule-rss", schedule.id, rss.id),
    edge("e-schedule-http", schedule.id, httpApi.id),
    edge("e-need-opencli-hda", collectionNeed.id, opencliHda.id),
    edge("e-jin10-normalize", jin10.id, normalize.id),
    edge("e-rss-normalize", rss.id, normalize.id),
    edge("e-http-normalize", httpApi.id, normalize.id),
    edge("e-opencli-hda-normalize", opencliHda.id, normalize.id),
    edge("e-normalize-dedupe", normalize.id, dedupe.id),
    edge("e-dedupe-summary", dedupe.id, summary.id),
    edge("e-summary-score", summary.id, score.id),
    edge("e-score-tag", score.id, tag.id),
    edge("e-tag-router", tag.id, router.id),
    edge("e-router-webhook", router.id, webhook.id, "notify"),
    edge("e-router-telegram", router.id, telegram.id, "notify"),
    edge("e-router-email", router.id, email.id, "notify"),
    edge("e-router-inbox", router.id, inbox.id, "review"),
    edge("e-inbox-postgres", inbox.id, postgres.id, "archive"),
  ]

  // ── 合并 adapters（目录 requiredAdapters + n8n 翻译产物）──
  const catalogAdapters = [
    ...(catalogItem("intelligence.source.jin10").requiredAdapters ?? []),
    ...(catalogItem("intelligence.output.webhook").requiredAdapters ?? []),
    ...(catalogItem("package.opencli.multi-source-hda").requiredAdapters ?? []),
  ]
  const adapterById = new Map([...catalogAdapters, ...n8nAdapters].map((adapter) => [adapter.id, adapter]))

  return parseWorkflowProject({
    id: "workflow-collection-dispatch",
    name: "采集 · 发送管线",
    profile: "intelligence",
    version: 1,
    nodes: [collectionNeed, schedule, jin10, rss, httpApi, opencliHda, normalize, dedupe, summary, score, tag, router, inbox, webhook, telegram, email, postgres],
    edges,
    adapters: Array.from(adapterById.values()),
    settings: {
      timezone: "Asia/Shanghai",
      deterministicSimulation: true,
      maxItemsPerRun: 50,
    },
    agentPermissions: {
      canFetchNetwork: true,
      canSendNotifications: false,
      canWriteInbox: true,
      allowedDomains: ["jin10.com", "bilibili.com", "xiaohongshu.com"],
    },
  })
}

export const COLLECTION_WORKFLOW_PROJECT = buildCollectionWorkflowProject()
