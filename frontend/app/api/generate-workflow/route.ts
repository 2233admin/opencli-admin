import { generateObject } from "ai"
import { z } from "zod"

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
    .enum(["trigger", "http", "action", "condition", "transform", "delay", "note"])
    .describe("节点类型"),
  label: z.string().describe("简短的中文标题"),
  description: z.string().describe("一句话中文说明"),
  config: z.string().optional().describe("主要参数值，例如 URL、事件名、条件表达式或时长"),
})

const workflowSchema = z.object({
  title: z.string().describe("工作流标题"),
  nodes: z.array(nodeSchema).min(2).max(14),
  edges: z
    .array(
      z.object({
        source: z.string(),
        target: z.string(),
        label: z.string().optional().describe("分支标签，例如 是 / 否"),
      }),
    )
    .describe("节点之间的连接，形成有向流程"),
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
        "你是一个工作流自动化设计专家。根据用户的需求描述，设计一个清晰、合理的自动化工作流。" +
        "工作流必须从一个 trigger 节点开始。使用 condition 节点表示分支判断，并为其引出的边加上“是/否”标签。" +
        "http 用于调用外部接口，action 用于发送通知/邮件等副作用，transform 用于处理数据，delay 用于等待。" +
        "节点数量保持精炼，连接要形成合理的有向流程，不要产生孤立节点。所有文案使用简体中文。",
      prompt,
    })

    return Response.json(object)
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
