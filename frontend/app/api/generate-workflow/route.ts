import { generateObject } from "ai"
import { z } from "zod"

import { analyzeGeneratedWorkflowReadiness } from "@/lib/flow/local-generate"
import type { GeneratedWorkflowSpec } from "@/lib/flow/types"

export const maxDuration = 30

const missingPromptError = {
  error: "MISSING_PROMPT",
  message: "Missing prompt. Send a JSON body like { \"prompt\": \"Summarize JIN10 flash news and route important items.\" }.",
  example: {
    prompt: "Summarize JIN10 flash news and route important items.",
  },
}

const nodeSchema = z.object({
  id: z.string().describe("唯一的短 id，例如 n1、n2"),
  type: z
    .enum([
      "manual-trigger",
      "schedule-trigger",
      "api-agent",
      "opencli-agent",
      "governed-tool-agent",
      "llm-transform-agent",
      "router",
      "merge",
      "records-output",
      "email-output",
      "webhook-output",
    ])
    .describe("节点类型"),
  label: z.string().describe("简短的中文标题"),
  description: z.string().describe("一句话中文说明"),
  config: z.string().optional().describe("主要参数值，例如 URL、事件名、条件表达式或时长"),
  params: z.record(z.string(), z.unknown()).optional().describe("结构化节点参数；不得包含凭据或 secret"),
  definitionRef: z.object({
    kind: z.enum(["api", "opencli", "governed-tool", "llm-transform"]),
    id: z.string(),
    version: z.string(),
  }).optional().describe("Agent 节点引用的画布外版本化定义"),
  inputMode: z.enum(["single", "batch"]).optional(),
  outputMode: z.enum(["single", "batch"]).optional(),
  retryPolicy: z.object({
    maxAttempts: z.number().int().min(1).max(10),
    backoff: z.enum(["none", "fixed", "exponential"]),
  }).optional().describe("重试是节点配置，不生成 Retry 控制节点"),
  readiness: z.enum(["ready", "incomplete", "blocked"]).optional(),
  capabilityGapIds: z.array(z.string()).optional(),
  recentStatus: z.enum(["idle", "running", "success", "partial_success", "error"]).optional(),
  outputStatus: z.enum(["idle", "running", "success", "partial_success", "error"]).optional(),
})

const edgeMappingSchema = z.object({
  mode: z.enum(["auto", "override"]),
  fields: z.array(z.object({ source: z.string(), target: z.string(), transform: z.string().optional() })),
  preserveRaw: z.literal(true),
  compatible: z.boolean(),
  conflicts: z.array(z.string()),
})

const capabilityGapSchema = z.object({
  id: z.string(),
  nodeId: z.string().optional(),
  capability: z.enum(["configuration", "connection", "mapping", "agent-definition"]),
  title: z.string(),
  detail: z.string(),
  blockingActions: z.array(z.enum(["publish", "run"])),
})

const workflowSchema = z.object({
  version: z.literal(1),
  title: z.string().describe("工作流标题"),
  intent: z.object({
    mode: z.enum(["one_time", "scheduled", "hybrid"]),
    execution: z.literal("batch"),
    acyclic: z.literal(true),
  }),
  executionPolicy: z.object({
    crossRunState: z.literal("none"),
    branchFailure: z.literal("isolate-descendants"),
    outputFailureStatus: z.literal("partial_success"),
  }),
  envelope: z.object({
    contract: z.literal("typed-envelope.v1"),
    fields: z.tuple([
      z.literal("data"),
      z.literal("schema"),
      z.literal("metadata"),
      z.literal("provenance"),
      z.literal("trace"),
    ]),
    rawPath: z.literal("data.raw"),
    execution: z.literal("batch"),
  }),
  nodes: z.array(nodeSchema).min(2).max(20),
  edges: z
    .array(
      z.object({
        source: z.string(),
        target: z.string(),
        label: z.string().optional().describe("分支标签，例如 是 / 否"),
        sourcePort: z.string().optional(),
        targetPort: z.string().optional(),
        mapping: edgeMappingSchema,
      }),
    )
    .describe("节点之间的连接，必须形成 DAG；每条边保存字段映射"),
  capabilityGaps: z.array(capabilityGapSchema),
  readiness: z.object({
    status: z.enum(["ready", "incomplete", "blocked"]),
    canSave: z.literal(true),
    canPublish: z.boolean(),
    canRun: z.boolean(),
    blockingGapIds: z.array(z.string()),
  }),
})

export async function POST(req: Request) {
  try {
    let body: { prompt?: unknown }
    try {
      body = (await req.json()) as { prompt?: unknown }
    } catch {
      return Response.json(
        {
          error: "INVALID_JSON",
          message: "Request body must be valid JSON. Send { \"prompt\": \"...\" }.",
          example: missingPromptError.example,
        },
        { status: 400 },
      )
    }

    const prompt = typeof body.prompt === "string" ? body.prompt : ""
    if (!prompt || prompt.trim().length === 0) {
      return Response.json(missingPromptError, { status: 400 })
    }

    const { object } = await generateObject({
      model: "openai/gpt-5.4-mini",
      schema: workflowSchema,
      system:
        "你是 Agent Builder 的工作流设计专家。生成可编辑的 P0 DAG，不得生成循环、Loop、Retry、Store 或 Inbox 节点。" +
        "无频率时使用 manual-trigger；有频率时使用 schedule-trigger；两者都要求时建立两个入口，并通过显式 merge 汇入共享路径。" +
        "API、OpenCLI、Governed Tool、LLM Transform 必须是不同 Agent 节点；Agent 引用画布外版本化 definitionRef，retryPolicy 写在节点配置。" +
        "输出只使用 records-output、email-output、webhook-output；没有指定输出时默认 Records；多个输出从同一上游并行扇出。" +
        "每条边必须提供 mapping 并保留 data.raw；字段不兼容时 mapping.compatible=false，并创建阻止 publish/run 的 Capability Gap。" +
        "缺少 endpoint、收件人、Webhook URL、Tool 绑定等配置时仍允许保存 Draft，但 readiness 必须阻止 publish/run。" +
        "统一 envelope 固定为 typed-envelope.v1；只支持 batch；跨 Run 状态固定 none；分支失败只停止后代，输出失败状态为 partial_success。" +
        "节点数量保持精炼，不产生孤立节点，不把凭据或 secret 放入图中。所有文案使用简体中文。",
      prompt,
    })

    const generated = object as GeneratedWorkflowSpec
    assertGeneratedWorkflowDag(generated)
    return Response.json({ ...generated, readiness: analyzeGeneratedWorkflowReadiness(generated) })
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.log("[v0] generate-workflow error:", msg)
    return Response.json(
      {
        error: "WORKFLOW_GENERATION_FAILED",
        message: "Workflow generation failed. Retry with a shorter prompt or use the local fallback in the command palette.",
        detail: msg,
      },
      { status: 500 },
    )
  }
}

function assertGeneratedWorkflowDag(spec: GeneratedWorkflowSpec) {
  const nodeById = new Map(spec.nodes.map((node) => [node.id, node]))
  if (nodeById.size !== spec.nodes.length) throw new Error("Generated workflow contains duplicate node ids")
  if (!spec.nodes.some((node) => node.type === "manual-trigger" || node.type === "schedule-trigger")) {
    throw new Error("Generated workflow is missing a trigger")
  }
  if (!spec.nodes.some((node) => node.type.endsWith("-output"))) {
    throw new Error("Generated workflow is missing an output")
  }
  if (!spec.nodes.some((node) => node.type.endsWith("-agent"))) {
    throw new Error("Generated workflow is missing an Agent node")
  }

  const indegree = new Map(spec.nodes.map((node) => [node.id, 0]))
  const adjacency = new Map(spec.nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of spec.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      throw new Error(`Generated edge references an unknown node: ${edge.source} -> ${edge.target}`)
    }
    adjacency.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  for (const [nodeId, degree] of indegree) {
    if (degree > 1 && nodeById.get(nodeId)?.type !== "merge") {
      throw new Error(`Generated node with multiple inputs must be a visible Merge: ${nodeId}`)
    }
  }

  const queue = Array.from(indegree, ([nodeId, degree]) => degree === 0 ? nodeId : null)
    .filter((nodeId): nodeId is string => nodeId !== null)
  let visited = 0
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    visited += 1
    for (const target of adjacency.get(nodeId) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) queue.push(target)
    }
  }
  if (visited !== spec.nodes.length) throw new Error("Generated workflow contains a cycle")
}
